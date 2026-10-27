"""Runs Kevin's original scheduling algorithm (github.com/KevHH/gatsby_tea_scheduling, script.py) and the
Apps Script port (apps-script/automation/Scheduler.js, via node) on the same random inputs and checks that
they make exactly the same assignments.  Run: python3 tests/crosscheck_scheduler.py [n_cases]"""
import json, os, random, subprocess, sys, urllib.request, importlib.util
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache'); os.makedirs(CACHE, exist_ok=True)
REF = os.path.join(CACHE, 'script.py')
if not os.path.exists(REF):
    urllib.request.urlretrieve('https://raw.githubusercontent.com/KevHH/gatsby_tea_scheduling/main/script.py', REF)
spec = importlib.util.spec_from_file_location('kevin', REF); kevin = importlib.util.module_from_spec(spec); spec.loader.exec_module(kevin)

TYPES = ['Research Talk', 'Tea Talk', 'Just Tea', 'Leaving Tea', 'External Seminar', 'TNJC', 'MLJC', 'Coffee Cleaning']
def d(s): return datetime.strptime(s, '%Y-%m-%d')
def s(x): return x.strftime('%Y-%m-%d')

def case(rng):
    query = rng.choice(['ResearchTeaTalks', 'TNJC', 'MLJC', 'Coffee Cleaning'])
    n_people = rng.randint(2, 14)
    people = []
    for i in range(n_people):
        k = rng.randint(0, 3); af, au = [], []
        for _ in range(k):
            a = datetime(2026, 9, 1) + timedelta(days=rng.randint(0, 150)); b = a + timedelta(days=rng.randint(0, 20))
            af.append(s(a)); au.append(s(b))
        people.append({'id': 'p%d' % i, 'away_from': af, 'away_until': au,
                       'tea_excluded': rng.random() < .2, 'tt_excluded': rng.random() < .2, 'rt_excluded': rng.random() < .3})
    ids = [p['id'] for p in people]
    past = []
    for j in range(rng.randint(0, 40)):
        t = rng.choice(TYPES); day = datetime(2025, 11, 1) + timedelta(days=rng.randint(0, 420))
        talk = {'id': 'h%d' % j, 'date': s(day), 'type': t,
                'presenter': rng.sample(ids, rng.randint(0, min(2, len(ids)))), 'tea': rng.sample(ids, rng.randint(0, min(1, len(ids))))}
        if t == 'Coffee Cleaning': talk['date_end'] = s(day + timedelta(days=4))
        past.append(talk)
    fill_types = {'ResearchTeaTalks': ['Research Talk', 'Tea Talk'], 'TNJC': ['TNJC'], 'MLJC': ['MLJC'], 'Coffee Cleaning': ['Coffee Cleaning']}[query]
    to_fill = []
    for j in range(rng.randint(1, 12)):
        t = rng.choice(fill_types); day = datetime(2026, 11, 2) + timedelta(days=rng.randint(0, 70))
        talk = {'id': 'f%d' % j, 'date': s(day), 'type': t, 'presenter': [], 'tea': []}
        if t == 'Coffee Cleaning': talk['date_end'] = s(day + timedelta(days=4))
        to_fill.append(talk)
    return {'query': query, 'people': people, 'past': past, 'to_fill': to_fill}

def run_python(c):
    conv = lambda t: dict(t, date=d(t['date']), **({'date_end': d(t['date_end'])} if 'date_end' in t else {}))
    people = [dict(p, away_from=[d(x) for x in p['away_from']], away_until=[d(x) for x in p['away_until']]) for p in c['people']]
    out = kevin.main([conv(t) for t in c['to_fill']], [conv(t) for t in c['past']], people, c['query'])
    return sorted([(t['id'], t['type'], list(t.get('presenter', [])), list(t.get('tea', []))) for t in out])

NODE = r'''
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = cases.map(c => vm.runInContext('sched_main', ctx)(c.to_fill, c.past, c.people, c.query)
  .map(t => [t.id, t.type, t.presenter, t.tea]).sort());
process.stdout.write(JSON.stringify(out));
'''

def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    rng = random.Random(int(os.environ.get("SEED", "42")))
    cases = [case(rng) for _ in range(n)]
    js = json.loads(subprocess.run(['node', '-e', NODE, os.path.join(HERE, '..', 'apps-script', 'automation', 'Scheduler.js')],
                                   input=json.dumps(cases), capture_output=True, text=True, check=True).stdout)
    bad = 0
    for i, c in enumerate(cases):
        py = [list(x) for x in run_python(c)]
        if py != js[i]:
            bad += 1
            if bad <= 3: print('MISMATCH case', i, c['query'], '\n python:', py, '\n port:  ', js[i])
    print('%d/%d cases identical' % (n - bad, n))
    sys.exit(1 if bad else 0)

main()
