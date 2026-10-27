#!/usr/bin/env python3
"""Deploys the Apps Script projects listed in deploy/projects.json from GitHub (the single source of truth).

    python3 deploy/deploy.py --check     # only compare: is anything live different from GitHub?
    python3 deploy/deploy.py             # deploy everything (asks before overwriting edits made in the editor)
    python3 deploy/deploy.py --yes       # deploy without asking

What a deploy does:
  1. refuses unless the working tree is clean and HEAD is exactly origin/main (i.e. what is on GitHub)
  2. runs the tests (node tests/run.js, python3 tests/crosscheck_scheduler.py)
  3. per project: downloads the live code and compares it with the repo; edits made in the Apps Script
     editor are shown and saved to backups/drift/ before being overwritten
  4. uploads the complete project through the Apps Script API (files that are not in the repo are removed),
     each code file starting with a "deployed from GitHub, do not edit here" header naming the commit
  5. checks the upload, and moves the web app (tea page) deployment to a new version

Credentials: the clasp login of the bot account (~/.clasprc.json, user from projects.json). Nothing secret is
read from or written to the repo. Standard library only.
"""
import argparse, difflib, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = json.load(open(os.path.join(ROOT, 'deploy', 'projects.json')))
API = 'https://script.googleapis.com/v1/projects/'
MARK = 'Deployed from GitHub'


def git(*args):
    exe = '/opt/homebrew/bin/git' if os.path.exists('/opt/homebrew/bin/git') else shutil.which('git')
    return subprocess.run([exe, '-C', ROOT] + list(args), capture_output=True, text=True, check=True).stdout.strip()


def git_fetch():
    # Prefer the GitHub CLI's login: the default macOS keychain helper pops up a password dialog.
    try:
        if shutil.which('gh'):
            git('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '-q', 'origin')
        else:
            git('fetch', '-q', 'origin')
    except subprocess.CalledProcessError as e:
        sys.exit('Could not fetch from GitHub: ' + (e.stderr or '').strip() + ' (log in with `gh auth login`, or run `gh auth setup-git`)')


def access_token():
    tokens = json.load(open(os.path.expanduser('~/.clasprc.json')))['tokens'][CONFIG['clasp_user']]
    body = urllib.parse.urlencode({'client_id': tokens['client_id'], 'client_secret': tokens['client_secret'],
                                   'refresh_token': tokens['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    return json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', body))['access_token']


def api(method, path, token, body=None):
    req = urllib.request.Request(API + path, method=method, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        sys.exit('Apps Script API %s %s failed (%s): %s' % (method, path, e.code, e.read().decode()[:500]))


# ---- files <-> Apps Script content ----

def local_files(project):
    """{name: (type, source)} as the Apps Script API names them, from the repo directory."""
    out = {}
    d = os.path.join(ROOT, project['dir'])
    for f in sorted(os.listdir(d)):
        path = os.path.join(d, f)
        if f.startswith('.') or not os.path.isfile(path):
            continue
        base, ext = os.path.splitext(f)
        kind = {'.js': 'SERVER_JS', '.gs': 'SERVER_JS', '.html': 'HTML', '.json': 'JSON'}.get(ext)
        if not kind or (kind == 'JSON' and base != 'appsscript'):
            continue
        if base in out:
            sys.exit('%s: "%s" exists twice (Apps Script names files without their extension); rename one.' % (project['dir'], base))
        out[base] = (kind, open(path, encoding='utf-8').read().replace('\r\n', '\n'))
    return out


def header(kind, project, name, sha):
    ext = {'SERVER_JS': '.js', 'HTML': '.html'}[kind]
    src = '%s/blob/%s/%s/%s%s' % (CONFIG['repo_url'], sha[:12], project['dir'], name, ext)
    text = ['%s (%s), %s. Do not edit here: the next deploy overwrites changes made in this editor.' % (MARK, sha[:12], time.strftime('%Y-%m-%d')),
            'Source: ' + src]
    if kind == 'SERVER_JS':
        return ''.join('// %s\n' % t for t in text)
    return '<!-- %s -->\n' % ' | '.join(text)


def with_header(kind, source, head):
    if kind == 'JSON':
        return source
    if kind == 'HTML' and source.lower().startswith('<!doctype'):
        first, _, rest = source.partition('\n')   # a comment before the doctype would put browsers in quirks mode
        return first + '\n' + head + rest
    return head + source


def strip_header(kind, source):
    source = source.replace('\r\n', '\n')
    lines = source.split('\n')
    if kind == 'SERVER_JS':
        while lines and lines[0].startswith('// ') and (MARK in lines[0] or lines[0].startswith('// Source: https://github.com/')):
            lines.pop(0)
    elif kind == 'HTML':
        lines = [l for i, l in enumerate(lines) if not (i <= 1 and l.startswith('<!-- ' + MARK))]
    return '\n'.join(lines)


def remote_files(project, token):
    """live files without headers, plus the commit they say they were deployed from (None if unknown)"""
    content = api('GET', project['script_id'] + '/content', token)
    files, shas = {}, []
    for f in content.get('files', []):
        src = f.get('source', '')
        m = re.search(re.escape(MARK) + r' \(([0-9a-f]{12})\)', src[:400])
        if m: shas.append(m.group(1))
        files[f['name']] = (f['type'], strip_header(f['type'], src))
    deployed = max(set(shas), key=shas.count) if shas else None
    return files, deployed


def files_at(project, short_sha):
    """the repo files of a project as they were at an earlier commit (None if that commit is unknown)"""
    try:
        sha = git('rev-parse', short_sha + '^{commit}')
        names = git('ls-tree', '--name-only', sha, project['dir'] + '/').split('\n')
    except subprocess.CalledProcessError:
        return None
    out = {}
    for path in names:
        f = os.path.basename(path)
        base, ext = os.path.splitext(f)
        kind = {'.js': 'SERVER_JS', '.gs': 'SERVER_JS', '.html': 'HTML', '.json': 'JSON'}.get(ext)
        if not kind or f.startswith('.') or (kind == 'JSON' and base != 'appsscript'):
            continue
        out[base] = (kind, git('show', sha + ':' + path).replace('\r\n', '\n') + '\n')
    return out


def norm(s):
    return s.rstrip('\n') + '\n'


def drift(local, remote):
    """differences between repo and live code (headers ignored)"""
    diffs = []
    for name in sorted(set(local) | set(remote)):
        if name not in remote:
            diffs.append((name, 'only in GitHub (would be added)', None))
        elif name not in local:
            diffs.append((name, 'only live (edited in the editor? would be removed)', remote[name][1]))
        elif norm(local[name][1]) != norm(remote[name][1]):
            d = ''.join(difflib.unified_diff(norm(local[name][1]).splitlines(True), norm(remote[name][1]).splitlines(True), 'github/' + name, 'live/' + name, n=1))
            diffs.append((name, 'differs', d))
    return diffs


# ---- main ----

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true', help='only report differences between GitHub and the live projects')
    ap.add_argument('--yes', action='store_true', help='overwrite live edits without asking')
    ap.add_argument('--skip-tests', action='store_true')
    ap.add_argument('--restamp', action='store_true', help='redeploy unchanged projects too (e.g. to refresh the headers after the repo moved)')
    ap.add_argument('only', nargs='*', help='project dirs or names (default: all)')
    args = ap.parse_args()

    projects = [p for p in CONFIG['projects'] if not args.only or p['dir'] in args.only or p['name'] in args.only]
    token = access_token()

    if not args.check:
        if git('status', '--porcelain'):
            sys.exit('Refusing to deploy: uncommitted changes. Commit and push first (GitHub is the source of truth).')
        git_fetch()
        head, main_ = git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main')
        if head != main_:
            sys.exit('Refusing to deploy: HEAD (%s) is not origin/main (%s). Push or pull first.' % (head[:12], main_[:12]))
        if not args.skip_tests:
            subprocess.run(['node', os.path.join(ROOT, 'tests', 'run.js')], check=True, stdout=subprocess.DEVNULL)
            subprocess.run([sys.executable, os.path.join(ROOT, 'tests', 'crosscheck_scheduler.py'), '300'], check=True, stdout=subprocess.DEVNULL)
            print('tests passed')
    sha = git('rev-parse', 'HEAD')

    exit_code = 0
    for p in projects:
        local = local_files(p)
        remote, deployed = remote_files(p, token)
        pending = drift(local, remote)
        # edits made in the editor = live code that differs from GitHub at the commit it was deployed from
        base = files_at(p, deployed) if deployed else None
        live_edits = [d for d in drift(base, remote) if d[1] != 'only in GitHub (would be added)'] if base is not None else \
                     [d for d in pending if d[1] != 'only in GitHub (would be added)']
        print('\n== %s (%s), live: %s' % (p['name'], p['dir'], ('GitHub ' + deployed) if deployed else 'not deployed by this script yet'))
        if not pending:
            print('   live code matches GitHub')
        elif base is not None:
            print('   new on GitHub since the last deploy: ' + ', '.join(n for n, _, _ in drift(local, base)) if drift(local, base) else '   nothing new on GitHub')
        if live_edits:
            print('   edited in the Apps Script editor' + ('' if base is not None else ' (or not yet deployed from GitHub)') + ':')
            for name, what, detail in live_edits:
                print('   %s: %s' % (name, what))
                if detail and what == 'differs':
                    print('\n'.join('     ' + l for l in detail.splitlines()[:40]))
        if args.check:
            exit_code |= 1 if live_edits else 0
            continue
        if not pending and deployed and not args.restamp:
            update_webapp(p, deployed, token)   # in case an earlier run stopped before this step
            continue   # identical, and already stamped with a commit

        if live_edits:
            keep = os.path.join(ROOT, 'backups', 'drift', '%s-%s' % (os.path.basename(p['dir']), time.strftime('%Y%m%d-%H%M%S')))
            os.makedirs(keep, exist_ok=True)
            for name, (kind, src) in remote.items():
                open(os.path.join(keep, name + {'SERVER_JS': '.js', 'HTML': '.html', 'JSON': '.json'}[kind]), 'w').write(src)
            print('   live version saved to %s' % os.path.relpath(keep, ROOT))
            if not args.yes and input('   Overwrite the live edits with GitHub? [y/N] ').strip().lower() != 'y':
                print('   skipped'); continue

        files = [{'name': n, 'type': k, 'source': with_header(k, s, header(k, p, n, sha) if k != 'JSON' else '')} for n, (k, s) in local.items()]
        api('PUT', p['script_id'] + '/content', token, {'files': files})
        after_files, after_sha = remote_files(p, token)
        after = drift(local, after_files)
        if after or after_sha != sha[:12]:
            sys.exit('   upload check failed: ' + (', '.join(n for n, _, _ in after) or 'headers not stamped'))
        print('   deployed %s (%d files)' % (sha[:12], len(files)))
        update_webapp(p, sha[:12], token)
    sys.exit(exit_code)


def update_webapp(project, short_sha, token):
    """points the web app deployment (tea page) at a version of exactly this commit"""
    if not project.get('webapp_deployment_id'):
        return
    label = 'GitHub ' + short_sha
    current = api('GET', project['script_id'] + '/deployments/' + project['webapp_deployment_id'], token)
    if current.get('deploymentConfig', {}).get('description') == label:
        return
    v = api('POST', project['script_id'] + '/versions', token, {'description': label})['versionNumber']
    api('PUT', project['script_id'] + '/deployments/' + project['webapp_deployment_id'], token,
        {'deploymentConfig': {'versionNumber': v, 'manifestFileName': 'appsscript', 'description': label}})
    print('   tea page now serves version %d (%s)' % (v, label))


if __name__ == '__main__':
    main()
