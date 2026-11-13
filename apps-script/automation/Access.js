// Who may use the Gatsby Rotas site besides the rota members, and in which role:
//  - Reader: reads everything members read (schedule, people, guides), changes nothing. For people who are not on
//    any rota, e.g. a colleague who puts the talks into a newsletter.
//  - Unit admin: unit staff who look after the rotas' people and slots: switches on any slot, newcomers,
//    leavers, who is on which rota, their emails, and this list. Not the guide pages or the rota rules.
//
// The list is the "Site access" tab of the rota data sheet, one row per person, kept on the site by the tsars and
// the unit admins. A row about a rota member (matched by their registered email, or else by their exact name)
// only adds the role: they keep signing in as themselves. Anyone else signs in with the row's own code (column
// Token), which the sign-in link and the welcome email hand out; removing the row ends their access.

const ACCESS_TAB = 'Site access';
const ACCESS_HEADER = ['Id', 'Name', 'Email', 'Role', 'Person', 'Token', 'Added', 'Added by'];
const ACCESS_ROLES = ['Reader', 'Unit admin'];
const ACCESS_CACHE_KEY = 'access:v1';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var access_cache = null;

function access_sheet(){
  var ss = store_spreadsheet();
  if (!ss) throw new Error('The rota data sheet is missing (Script Property STORE_SHEET_ID).');
  var sheet = ss.getSheetByName(ACCESS_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(ACCESS_TAB, ss.getSheets().length);
  sheet.getRange(1, 1, 1, ACCESS_HEADER.length).setValues([ACCESS_HEADER]);
  sheet.setFrozenRows(1);
  guard_sheet(sheet);
  return sheet;
}

// [{row, id, name, email, role, person, token, added, by}]: read once per run, and kept for ten minutes, as every
// visit to the site asks (site_rights)
function access_entries(){
  if (access_cache) return access_cache;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(ACCESS_CACHE_KEY);
  if (cached) return (access_cache = JSON.parse(cached));
  var ss = store_spreadsheet();
  var sheet = ss ? ss.getSheetByName(ACCESS_TAB) : null;
  var last = sheet ? sheet.getLastRow() : 0;
  var values = last > 1 ? sheet.getRange(2, 1, last - 1, ACCESS_HEADER.length).getValues() : [];
  access_cache = values.map(function(r, i){
    var s = function(k){ return String(r[k] == null ? '' : r[k]).trim(); };
    return {row: i + 2, id: s(0), name: s(1), email: s(2), role: s(3), person: s(4), token: s(5), added: s(6), by: s(7)};
  }).filter(function(e){ return /^[0-9a-f]{32}$/.test(e.id) && ACCESS_ROLES.indexOf(e.role) >= 0; });
  try { cache.put(ACCESS_CACHE_KEY, JSON.stringify(access_cache), 600); } catch (e) { /* read again next time */ }
  return access_cache;
}

function access_forget(){
  access_cache = null;
  CacheService.getScriptCache().remove(ACCESS_CACHE_KEY);
}

// the roles this person (or code holder) has: rows about them by id, or with their email
function access_roles(id, email){
  email = String(email || '').toLowerCase();
  return access_entries().filter(function(e){
    return (id && (e.person === id || e.id === id)) || (email && e.email.toLowerCase() === email);
  }).map(function(e){ return e.role; });
}

// someone not on the rotas, by the code they sign in with
function access_for_token(token){
  token = String(token || '');
  if (!/^[0-9a-f]{40}$/.test(token)) return null;
  return access_entries().filter(function(e){ return !e.person && e.token === token; })[0] || null;
}

function access_entry(id){
  return access_entries().filter(function(e){ return e.id === id; })[0] || null;
}

// The active rota member a row is about: the one with this registered email, or else the only one with exactly
// this name (their registered address may be another one).
function access_member(name, email, constants){
  var people = load_people(constants);
  var active = Object.keys(people).map(function(id){ return people[id]; }).filter(function(p){ return p.active; });
  var e = String(email || '').toLowerCase();
  var by_email = active.filter(function(p){ return p.email && p.email.toLowerCase() === e; });
  if (by_email.length) return by_email[0];
  var n = normalise_name(name);
  var by_name = active.filter(function(p){ return normalise_name(p.name) === n; });
  return by_name.length === 1 ? by_name[0] : null;
}

// a browser session for someone not on the rotas: their own code, never the unit key, so removing their row
// signs them out
function access_session(entry){
  if (!entry || entry.person) return null;
  if (!entry.token){
    entry.token = new_token();
    access_sheet().getRange(entry.row, 6).setNumberFormat('@').setValue(entry.token);
    access_forget();
  }
  return {key: '', token: entry.token, person: entry.id, name: entry.name, member: false};
}

// the sign-in link, by email (same limits as the members' links)
function send_access_link(entry, subject, make_blocks){
  link_quota(entry.id)();
  send_mail(entry.email, subject, make_blocks(), get_global_constants(), {no_leave: true});
  return 'Sent to ' + mask_email(entry.email) + '. Check your inbox (and spam).';
}

// ---- keeping the list (tsars and unit admins, on the site) ----

function access_editor(token){
  var ed = site_editor(token);
  if (!ed.rights.access) throw new Error('Only the tsars and the unit admins can change who may use the site.');
  return ed;
}

// the list as the site shows it: rota members by their current name
function access_list(constants){
  var people = load_people(constants);
  return access_entries().map(function(e){
    var p = e.person ? people[e.person] : null;
    return {id: e.id, name: p ? p.name : e.name, email: e.email, role: e.role, person: e.person, added: e.added, by: e.by};
  }).sort(function(a, b){ return ACCESS_ROLES.indexOf(b.role) - ACCESS_ROLES.indexOf(a.role) || a.name.localeCompare(b.name); });
}

function api_site_access(token){
  var ed = access_editor(token);
  return access_list(ed.constants);
}

// Adds someone ({name, email, role, notify}) or changes their row ({id, …}). notify: email them how to sign in
// (only when added). Returns the list.
function api_site_save_access(token, input){
  var ed = access_editor(token);
  var constants = ed.constants;
  input = input || {};
  var role = String(input.role || '');
  if (ACCESS_ROLES.indexOf(role) < 0) throw new Error('Please pick Reader or Unit admin.');
  var email = String(input.email || '').trim();
  if (!EMAIL_RE.test(email)) throw new Error('That does not look like an email address.');
  var name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new Error('Please give their name.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var added = null, member = null;
  try {
    access_forget();
    var entries = access_entries();
    var current = input.id ? entries.filter(function(e){ return e.id === String(input.id); })[0] : null;
    if (input.id && !current) throw new Error('This entry is not on the list any more. Please reload the page.');
    var others = entries.filter(function(e){ return !current || e.id !== current.id; });
    var clash = others.filter(function(e){ return e.email.toLowerCase() === email.toLowerCase(); })[0];
    if (clash) throw new Error(email + ' is on the list already (' + clash.name + ').');
    member = access_member(name, email, constants);
    if (member && role === 'Reader') throw new Error(member.name + ' is on the rotas, so they can read the site already.');
    if (member && others.some(function(e){ return e.person === member.id; })) throw new Error(member.name + ' is on the list already.');
    var row = [
      current ? current.id : Utilities.getUuid().replace(/-/g, ''),
      member ? member.name : name, email, role, member ? member.id : '',
      member ? '' : (current && !current.person && current.token) || new_token(),
      current ? current.added : fmt_iso_date(new Date()), current ? current.by : site_name(ed)
    ];
    var sheet = access_sheet();
    var at = current ? current.row : sheet.getLastRow() + 1;
    sheet.getRange(at, 1, 1, ACCESS_HEADER.length).setNumberFormat('@').setValues([row]);
    access_forget();
    if (!current) added = access_entry(row[0]);
    log_site_edit(ed, (current ? 'site access changed: ' : 'site access added: ') + row[1] + ' (' + role + ')');
  } finally {
    lock.releaseLock();
  }
  if (added && input.notify){
    try { access_welcome(added, member, ed); }
    catch (err) { Logger.log('access welcome: ' + err); throw new Error('Added, but the email to ' + email + ' could not be sent (' + err.message + ').'); }
  }
  return access_list(constants);
}

function api_site_remove_access(token, id){
  var ed = access_editor(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    access_forget();
    var e = access_entry(String(id || ''));
    if (e){
      if (e.id === ed.rights.person || e.person === ed.rights.person) throw new Error('You can\'t take yourself off the list. Ask a tsar.');
      access_sheet().deleteRow(e.row);
      access_forget();
      log_site_edit(ed, 'site access removed: ' + e.name + ' (' + e.role + ')');
    }
  } finally {
    lock.releaseLock();
  }
  return access_list(ed.constants);
}

// The welcome email: what they can do now, with a link that signs them in (their own code; for rota members their
// personal code). Replies go to whoever added them.
function access_welcome(entry, member, ed){
  var constants = ed.constants, settings = get_settings();
  var people = load_people(constants);
  var by = people[ed.rights.person] || access_entry(ed.rights.person) || {};
  var by_name = by.name || 'A tsar';
  var to = member ? member.email || entry.email : entry.email;
  var token = entry.token;
  if (member){
    var mine = identity_rows(constants).rows.filter(function(r){ return r.id === member.id; })[0];
    if (mine && mine.email && !mine.token){ ensure_tokens(constants); mine = identity_rows(constants).rows.filter(function(r){ return r.id === member.id; })[0]; }
    token = mine ? mine.token : '';
  }
  var url = site_url(settings) + (token ? '?t=' + token : '');
  var first = String(entry.name).split(' ')[0];
  var open = {link: 'Open the Gatsby Rotas', url: url};
  var after = token
    ? 'This link signs you in, and your browser then remembers you for six months. On another device, open ' + site_url(settings) + ' and pick your name: the bot emails you a new link.'
    : 'Open it and pick your name: the bot emails you a sign-in link.';
  var blocks;
  if (entry.role === 'Unit admin'){
    blocks = [
      'Hi ' + first + ',',
      by_name + ' has made you a unit admin on the Gatsby Rotas, so you can make these changes yourself now:',
      {items: [
        '**Switches:** on the Rotas page, the ✎ next to any slot changes who presents or does tea. For an intern or a guest, type their name in "Speaker not on the rotas".',
        '**Newcomers:** People → "＋ Add a person": name, position, joined date and their email.',
        '**Leavers:** ✎ on their card, untick "On the rotas". The site then lists the slots they still hold, to hand over.',
        '**Who is on which rota:** ✎ on a card, or "＋ Put people on a rota" for several at once.',
        '**Who may read the site:** People → "Site access".'
      ]},
      open, after,
      'The calendar follows each change within the hour. Every change is logged under your name.'
    ];
    if (settings.HANDBOOK_URL) blocks.push('More in the [organiser handbook](' + settings.HANDBOOK_URL + ').');
  } else {
    blocks = [
      'Hi ' + first + ',',
      by_name + ' has given you access to the Gatsby Rotas: the schedule of the Gatsby Unit\'s talks, journal clubs, tea and coffee, and the guides to them.',
      open, after
    ];
  }
  var reply = by.email || '';
  send_mail(to, entry.role === 'Unit admin' ? 'You can now make changes on the Gatsby Rotas' : 'You can now read the Gatsby Rotas',
            blocks, constants, {no_leave: !member, reply_to: reply || undefined});
}
