// Local tests for the pure logic of apps-script/automation (Google services stubbed).
// Run: node tests/run.js
process.env.TZ = 'Europe/London';   // the Apps Script project's time zone (appsscript.json)
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const dir = path.join(__dirname, '..', 'apps-script', 'automation');
const src = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

const stubs = `
var __props = {};
var PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in __props ? __props[k] : null), setProperty: (k, v) => { __props[k] = String(v); },
  getProperties: () => Object.assign({}, __props), deleteProperty: k => { delete __props[k]; } }) };
var Logger = { log: () => {} };
var SpreadsheetApp = { openById: () => ({ getSheetByName: () => null }) };
var UrlFetchApp = null;
function UrlFetchApp_stub(fn){ UrlFetchApp = {fetch: fn}; }
var Calendar = null;
var LockService = null;
var ScriptApp = { getService: () => ({ getUrl: () => 'https://page' }) };
var CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };
var Utilities = {
  formatDate: (d, tz, fmt) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'}).formatToParts(d).map(x => [x.type, x.value]));
    const mon = new Intl.DateTimeFormat('en-GB', {timeZone: tz, month: 'short'}).format(d);
    if (fmt === 'yyyy-MM-dd') return p.year + '-' + p.month + '-' + p.day;
    if (fmt === 'EEE d MMM yyyy') return p.weekday + ' ' + Number(p.day) + ' ' + mon + ' ' + p.year;
    if (fmt === 'HH:mm') return new Intl.DateTimeFormat('en-GB', {timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false}).format(d);
    if (fmt === "yyyy-MM-dd'T'HH:mm:ssXXX") {
      const q = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'longOffset'}).formatToParts(d).map(x => [x.type, x.value]));
      const off = q.timeZoneName.replace('GMT', '') || '+00:00';
      return q.year + '-' + q.month + '-' + q.day + 'T' + q.hour + ':' + q.minute + ':' + q.second + off;
    }
    throw new Error('fmt ' + fmt);
  },
  computeDigest: (a, s) => Array.from(require_crypto.createHash('md5').update(s).digest()),
  base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
  DigestAlgorithm: { MD5: 'md5' }
};
`;
const tests = `
var results = [];
var real_notion_request = notion_request;
function t(name, fn){ try { fn(); results.push('ok   ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message); } }

var people = {
  a: {id: 'a', name: 'Lena Weber', active: true, email: 'lena@x'},
  b: {id: 'b', name: 'Nikolai Petrov', active: true, email: 'nikolai@x'},
  c: {id: 'c', name: 'Zoé Martin', active: true, email: ''},
  d: {id: 'd', name: 'Sam Old', active: false, email: 'old@x'},
  e: {id: 'e', name: 'Sam Old', active: true, email: 'new@x'}
};
people.f = {id: 'f', name: 'Lena Novak', active: false, email: ''};
people.g = {id: 'g', name: 'Alex Brennan Moss', active: true, email: ''};
function row(o){ return Object.assign({id: 'r1', url: 'https://notion/r1', type: 'TNJC', title: '', start: new Date('2026-11-10T13:30:00Z'), presenter_ids: ['b'], tea_ids: [], csnjc: false, gcal_id: 'ev1', guest: ''}, o); }

t('format TNJC', () => assert.strictEqual(format_title(row({}), people), 'TNJC: Nikolai Petrov'));
t('format TNJC CSNJC', () => assert.strictEqual(format_title(row({csnjc: true}), people), 'TNJC (CSNJC): Nikolai Petrov'));
t('format guest', () => assert.strictEqual(format_title(row({guest: 'Alex Rivers'}), people), 'TNJC: Alex Rivers'));
t('format research', () => assert.strictEqual(format_title(row({type: 'Research Talk', tea_ids: ['a']}), people), 'RESEARCH TALK: Nikolai Petrov TEA: Lena Weber'));
t('format coffee', () => assert.strictEqual(format_title(row({type: 'Coffee Cleaning', tea_ids: ['a']}), people), 'Coffee Duty This Week: Lena Weber'));
t('parse plain', () => assert.deepStrictEqual(JSON.parse(JSON.stringify(parse_title('TNJC: Lena Weber', 'TNJC'))), {csnjc: false, roles: {Presenter: ['Lena Weber']}}));
t('parse csnjc + two', () => assert.deepStrictEqual(parse_title('TNJC (CSNJC): A B, C D', 'TNJC').roles.Presenter, ['A B', 'C D']));
t('parse guest prefix', () => assert.deepStrictEqual(parse_title('TNJC - Guest speaker: Alex Rivers', 'TNJC').roles.Presenter, ['Alex Rivers']));
t('parse research talk', () => assert.deepStrictEqual(JSON.parse(JSON.stringify(parse_title('RESEARCH TALK: A B TEA: C D, E F', 'Research Talk').roles)), {Presenter: ['A B'], Tea: ['C D', 'E F']}));
t('parse just tea, finalizing format', () => assert.deepStrictEqual(parse_title('JUST TEA: C D', 'Just Tea').roles.Tea, ['C D']));
t('parse just tea, old swap-form format', () => assert.deepStrictEqual(parse_title('JUST TEA. TEA: C D', 'Just Tea').roles.Tea, ['C D']));
t('parse leaving tea, both formats', () => { assert.deepStrictEqual(parse_title('LEAVING TEA:  TEA: C D', 'Leaving Tea').roles.Tea, ['C D']); assert.deepStrictEqual(parse_title('LEAVING TEA. TEA: C D', 'Leaving Tea').roles.Tea, ['C D']); });
t('format just tea', () => assert.strictEqual(format_title(row({type: 'Just Tea', presenter_ids: [], tea_ids: ['a']}), people), 'JUST TEA: Lena Weber'));
t('old swap-form variant agrees, no rewrite', () => assert.ok(titles_agree(parse_title('JUST TEA. TEA: Lena Weber', 'Just Tea'), row({type: 'Just Tea', presenter_ids: [], tea_ids: ['a']}), people)));
t('TNJC without (CSNJC) agrees', () => assert.ok(titles_agree(parse_title('TNJC: Nikolai Petrov', 'TNJC'), row({csnjc: true}), people)));
t('parse wrong type', () => assert.strictEqual(parse_title('MLJC: X', 'TNJC'), null));
t('parse free text', () => assert.strictEqual(parse_title('Cancelled', 'TNJC'), null));
function m(n){ var r = match_name(n, people); return r.status + (r.person ? ':' + r.person.id : ''); }
t('exact', () => assert.strictEqual(m('Lena Weber'), 'match:a'));
t('accents', () => assert.strictEqual(m('zoe martin'), 'match:c'));
t('typo surname', () => assert.strictEqual(m('Lena Webr'), 'match:a'));
t('typo first name', () => assert.strictEqual(m('Nicolai Petrov'), 'match:b'));
t('first name only, unique among active', () => assert.strictEqual(m('Nikolai'), 'match:b'));
t('first name only, inactive namesake ignored', () => assert.strictEqual(m('Lena'), 'match:a'));
t('initial + surname', () => assert.strictEqual(m('L. Weber'), 'match:a'));
t('same name twice prefers active', () => assert.strictEqual(m('Sam Old'), 'match:e'));
t('guest with member first name', () => assert.strictEqual(m('Alex Rivers'), 'none'));
t('guest', () => assert.strictEqual(m('Andrew Hollis'), 'none'));
t('guest sharing a surname: ask, do not match', () => assert.strictEqual(m('Luca Weber'), 'uncertain'));
t('first name shared by two active people', () => { people.i = {id: 'i', name: 'Sam Smith', active: true}; var r = m('Sam'); delete people.i; assert.strictEqual(r, 'uncertain'); });
t('ambiguous surname', () => { people.h = {id: 'h', name: 'Tom Old', active: true}; var r = m('Tim Old'); delete people.h; assert.strictEqual(r, 'uncertain'); });
t('notion url id', () => assert.strictEqual(id_from_notion_url('https://www.notion.so/Abe-Fade-0123456789abcdef0123456789abcdef?pvs=4'), '0123456789abcdef0123456789abcdef'));
t('strip links', () => assert.strictEqual(strip_links('Title: x\\nZoom Link: z\\n\\n🫖 Can\\'t make it? Swap: u\\n✏️ edit: v'), 'Title: x\\nZoom Link: z'));
t('strip links none', () => assert.strictEqual(strip_links('Title: x  \\n'), 'Title: x'));
t('text email', () => { var s = blocks_to_text(['Hello there', {table: [['Slot', 'Tue'], ['Before', 'X']]}, {link: 'Open', url: 'https://u'}]); assert.ok(s.includes('Slot    Tue') && s.includes('Open:\\n  https://u'), s); });
t('inline link, text', () => assert.ok(blocks_to_text(['Swap [here](https://u/x?a=1&b=2) now']).startsWith('Swap here <https://u/x?a=1&b=2> now')));
t('inline link, html', () => assert.ok(blocks_to_html([{items: ['Swap [here](https://u/x?a=1&b=2)']}]).includes('<a href="https://u/x?a=1&amp;b=2" style="color:#1a73e8;">here</a>')));
t('html email escapes', () => assert.ok(blocks_to_html(['<b>&']).includes('&lt;b&gt;&amp;')));
t('defaults without tabs', () => { var st = get_settings(); assert.strictEqual(st.dry_run, true); assert.deepStrictEqual(st.sync_types, ['TNJC']); assert.strictEqual(st.links_in_events, true); assert.deepStrictEqual(st.date_reminders, []); });
t('old form link', () => assert.ok(swap_link(row({}), {settings: get_settings()}).endsWith('entry.1526923741=2026-11-10&entry.129875296=TNJC&entry.918272115=Presenter')));

// reconciler cases
var patched = [], mailed = [], logged = [];
notion_patch_page = function(id, props){ patched.push(JSON.parse(JSON.stringify(props))); };
send_mail = function(to, subject){ mailed.push(to + ' | ' + subject); };
function ctx(dry){ patched = []; mailed = []; logged = [];
  return {settings: Object.assign(get_settings(), {dry_run: dry, live_types: ['TNJC', 'MLJC', 'Coffee Cleaning', 'Research Talk']}), people: people, has_guest_prop: true,
    constants: {tnjc_admin_email: 'org@x', admin_email: 'tsar@x'},
    log: {getSheetByName: () => ({appendRow: r => logged.push(r[5] + ': ' + r[6])})}}; }
function ev(title){ return {title: title, loc: '', getTitle(){ return this.title; }, setTitle(x){ this.title = x; }, getLocation(){ return this.loc; }, setLocation(x){ this.loc = x; }}; }
function run(r, title, prev, dry, future){
  var c = ctx(dry), e = ev(title), exp = format_title(r, people);
  return {res: classify_difference(r, e, title, exp, parse_title(title, r.type), prev, notion_fingerprint(r), c, future !== false), e: e};
}
var fpB = notion_fingerprint(row({}));
t('first seen swap: report only', () => { var o = run(row({}), 'TNJC: Lena Weber', null, false); assert.strictEqual(o.res.finding.kind, 'swap_suggested'); assert.strictEqual(patched.length, 0); });
t('manual calendar swap, dry run', () => { var o = run(row({}), 'TNJC: Lena Weber', {t: 'TNJC: Nikolai Petrov', n: fpB}, true); assert.strictEqual(o.res.finding.kind, 'swap_from_calendar'); assert.strictEqual(o.res.finding.done, false); assert.strictEqual(patched.length, 0); assert.ok(logged[0].startsWith('would swap_from_calendar')); });
t('manual calendar swap, live', () => { var o = run(row({}), 'TNJC: Lena Weber', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(o.res.finding, undefined); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'a'); assert.ok(mailed[0].startsWith('lena@x,nikolai@x') || mailed[0].startsWith('nikolai@x,lena@x'), mailed[0]); assert.strictEqual(o.res.mismatch, null); });
t('guest, live', () => { var o = run(row({}), 'TNJC: Alex Rivers', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(o.res.finding, undefined); assert.strictEqual(o.res.mismatch, null); assert.strictEqual(patched[0]['Guest speaker'].rich_text[0].text.content, 'Alex Rivers'); assert.deepStrictEqual(patched[0].Presenter.relation, []); assert.ok(mailed[0].startsWith('nikolai@x')); });
t('notion edited -> calendar updated, nobody emailed', () => { var r = row({presenter_ids: ['a']}); var o = run(r, 'TNJC: Nikolai Petrov', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(o.res.finding, undefined); assert.strictEqual(o.e.title, 'TNJC: Lena Weber'); assert.strictEqual(mailed.length, 0); });
t('notion edited, past slot: no calendar write', () => { var r = row({presenter_ids: ['a']}); var o = run(r, 'TNJC: Nikolai Petrov', {t: 'TNJC: Nikolai Petrov', n: fpB}, false, false); assert.strictEqual(o.e.title, 'TNJC: Nikolai Petrov'); });
t('both edited -> conflict', () => { var r = row({presenter_ids: ['a']}); var o = run(r, 'TNJC: Zoé Martin', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(o.res.finding.kind, 'conflict'); assert.strictEqual(patched.length, 0); });
t('unchanged known mismatch: silent', () => { var o = run(row({}), 'TNJC: Lena Weber', {t: 'TNJC: Lena Weber', n: fpB}, false); assert.strictEqual(o.res.finding, undefined); assert.ok(o.res.mismatch); });
t('unrecognised title', () => { var o = run(row({}), 'Cancelled', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(o.res.finding.kind, 'unrecognised'); assert.strictEqual(patched.length, 0); });
t('mixed names', () => { var o = run(row({}), 'TNJC: Lena Weber, Alex Rivers', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(o.res.finding.kind, 'unknown_person'); assert.strictEqual(patched.length, 0); });
t('fuzzy swap records the person', () => { var o = run(row({}), 'TNJC: Lena Webr', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'a'); assert.strictEqual(mailed.length, 1); });
t('uncertain: no change, alert tsar', () => { people.h = {id: 'h', name: 'Tom Old', active: true}; var o = run(row({}), 'TNJC: Tim Old', {t: 'TNJC: Nikolai Petrov', n: fpB}, false); delete people.h; assert.strictEqual(o.res.finding.kind, 'uncertain_match'); assert.strictEqual(o.res.finding.alert_tsar, true); assert.strictEqual(patched.length, 0); });
t('research talk: only the tea person changed by hand', () => { var r = row({type: 'Research Talk', presenter_ids: ['b'], tea_ids: ['c']}); var fp = notion_fingerprint(r); var o = run(r, 'RESEARCH TALK: Nikolai Petrov TEA: Lena Weber', {t: 'RESEARCH TALK: Nikolai Petrov TEA: Zoé Martin', n: fp}, false); assert.deepStrictEqual(Object.keys(patched[0]), ['Tea']); assert.strictEqual(patched[0].Tea.relation[0].id.replace(/-/g, ''), 'a'); });
t('watched-only rota is report-only even when live', () => { var r = row({type: 'MLJC'}); var c = ctx(false); c.settings.live_types = ['TNJC']; var e = ev('MLJC: Lena Weber'); var res = classify_difference(r, e, 'MLJC: Lena Weber', format_title(r, people), parse_title('MLJC: Lena Weber', 'MLJC'), {t: 'MLJC: Nikolai Petrov', n: notion_fingerprint(r)}, notion_fingerprint(r), c, true); assert.strictEqual(res.finding.done, false); assert.strictEqual(patched.length, 0); assert.ok(logged[0].startsWith('would '), logged[0]); });
t('parse coffee', () => assert.deepStrictEqual(parse_title('Coffee Duty This Week: Lena Weber', 'Coffee Cleaning').roles.Tea, ['Lena Weber']));
t('coffee hand edit swaps Tea, not Presenter', () => { var r = row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['b']}); var fp = notion_fingerprint(r); var o = run(r, 'Coffee Duty This Week: Lena Weber', {t: 'Coffee Duty This Week: Nikolai Petrov', n: fp}, false); assert.strictEqual(o.res.finding, undefined); assert.ok(patched[0].Tea && !patched[0].Presenter, JSON.stringify(patched[0])); assert.strictEqual(patched[0].Tea.relation[0].id.replace(/-/g, ''), 'a'); });
t('coffee unknown name is not a guest', () => { var r = row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['b']}); var fp = notion_fingerprint(r); var o = run(r, 'Coffee Duty This Week: Andrew Hollis', {t: 'Coffee Duty This Week: Nikolai Petrov', n: fp}, false); assert.strictEqual(o.res.finding.kind, 'unknown_person'); assert.strictEqual(patched.length, 0); });
// sync_row: first look and event creation
var created = [];
function cal_stub(){ return { getEventById: () => null, createEvent: (t, s, e, o) => { created.push(t + (o.location ? ' @' + o.location : '')); return {getId: () => 'new1', getDescription: () => o.description, setDescription: function(){}, getTitle: () => t}; }, createAllDayEvent: (t) => { created.push('allday:' + t); return {getId: () => 'new2', getDescription: () => '', setDescription: function(){}}; } }; }
t('first look: slot without event is left alone', () => { var c = ctx(false); c.baseline = true; c.no_event = []; c.cal = cal_stub(); created = []; var out = sync_row(row({gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(out.no_event, true); assert.strictEqual(created.length, 0); assert.strictEqual(patched.length, 0); });
t('known slot without event stays alone', () => { var c = ctx(false); c.baseline = false; c.no_event = ['r1']; c.cal = cal_stub(); created = []; var out = sync_row(row({gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(created.length, 0); assert.strictEqual(out.no_event, true); });
t('newly confirmed slot gets an event', () => { var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = cal_stub(); c.constants.gatsby_zoom_link = 'z'; created = []; var out = sync_row(row({gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.deepStrictEqual(created, ['TNJC: Nikolai Petrov @z']); assert.strictEqual(patched[0]['GCal ID'].rich_text[0].text.content, 'new1'); assert.strictEqual(mailed.length, 0); });
t('coffee events are all-day', () => { var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = cal_stub(); created = []; sync_row(row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['a'], gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.deepStrictEqual(created, ['allday:Coffee Duty This Week: Lena Weber']); });
t('tentative slots are skipped', () => { var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = cal_stub(); created = []; sync_row(row({title: '[TNJC Tentative]', gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(created.length, 0); });
t('event description matches the finalizing script', () => assert.strictEqual(event_description(row({title: 'Neurons', description: 'paper'}), {constants: {gatsby_zoom_link: 'Z'}}), 'Title: Neurons\\nZoom Link: Z\\nDescription: paper'));
function text_event(desc){ var e = ev('TNJC: Nikolai Petrov'); e.desc = desc; e.getDescription = function(){ return this.desc; }; e.setDescription = function(x){ this.desc = x; }; return e; }
function text_ctx(e){ var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = {getEventById: () => e}; c.constants.gatsby_zoom_link = 'Z'; c.settings.links_in_events = false; return c; }
var soon = new Date(Date.now() + 5 * 864e5);
t('first look records the Notion text, leaves the description', () => { __props = {}; var e = text_event('typed by hand'); var r = row({start: soon, title: 'Neurons'}); sync_row(r, text_ctx(e), start_of_today()); assert.strictEqual(e.desc, 'typed by hand'); assert.strictEqual(JSON.parse(__props['state:ev1']).x, notion_text_fingerprint(r)); });
t('title edited in Notion -> event description rewritten', () => { __props = {}; var e = text_event('Title: Old\\nZoom Link: Z'); var r = row({start: soon, title: 'Old'}); sync_row(r, text_ctx(e), start_of_today()); r.title = 'New'; r.description = 'Host: Lena Weber'; var out = sync_row(r, text_ctx(e), start_of_today()); assert.strictEqual(e.desc, 'Title: New\\nZoom Link: Z\\nDescription: Host: Lena Weber'); assert.strictEqual(out.text_updated, true); });
t('Notion text unchanged -> hand-typed description kept', () => { __props = {}; var e = text_event('typed by hand'); var r = row({start: soon, title: 'Old'}); sync_row(r, text_ctx(e), start_of_today()); sync_row(r, text_ctx(e), start_of_today()); assert.strictEqual(e.desc, 'typed by hand'); });
t('Notion text changed but event already matches (tea page) -> no write', () => { __props = {}; var e = text_event('Title: Old\\nZoom Link: Z'); var r = row({start: soon, title: 'Old'}); sync_row(r, text_ctx(e), start_of_today()); r.title = 'New'; e.desc = 'Title: New\\nZoom Link: Z'; var out = sync_row(r, text_ctx(e), start_of_today()); assert.strictEqual(out.text_updated, undefined); });
t('past slot: Notion text change not pushed', () => { __props = {}; var e = text_event('Title: Old\\nZoom Link: Z'); var r = row({start: new Date(Date.now() - 5 * 864e5), title: 'Old'}); sync_row(r, text_ctx(e), start_of_today()); r.title = 'New'; sync_row(r, text_ctx(e), start_of_today()); assert.strictEqual(e.desc, 'Title: Old\\nZoom Link: Z'); });
t('upcoming talk gets the Zoom link as location; a room typed by hand stays', () => { __props = {}; var e = text_event('x'); sync_row(row({start: soon}), text_ctx(e), start_of_today()); assert.strictEqual(e.loc, 'Z'); var e2 = text_event('x'); e2.loc = 'Room 4.01'; sync_row(row({start: soon}), text_ctx(e2), start_of_today()); assert.strictEqual(e2.loc, 'Room 4.01'); });
t('coffee duty gets no Zoom location', () => { __props = {}; var e = text_event('x'); sync_row(row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['a'], start: soon}), text_ctx(e), start_of_today()); assert.strictEqual(e.loc, ''); });
// apply_swap
t('swap: Notion, calendar title, one email to both', () => { var c = ctx(false); var e = ev('TNJC: Nikolai Petrov'); c.cal = {getEventById: () => e}; var r = row({}); var msg = apply_swap(r, 'presenter', 'b', 'a', c); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'a'); assert.strictEqual(e.title, 'TNJC: Lena Weber'); assert.strictEqual(mailed.length, 1); assert.ok(mailed[0].startsWith('nikolai@x,lena@x'), mailed[0]); assert.ok(msg.startsWith('Done')); });
t('swap refused for a slot that is not theirs', () => { var c = ctx(false); assert.throws(() => apply_swap(row({}), 'presenter', 'a', 'c', c), /changed/); assert.strictEqual(patched.length, 0); });
t('swap refused for tentative', () => { var c = ctx(false); assert.throws(() => apply_swap(row({title: '[TNJC Tentative]'}), 'presenter', 'b', 'a', c), /tentative/); });
t('label kept when names are rewritten', () => assert.strictEqual(keep_label('UPGRADE TALK: Nikolai Petrov TEA: Lena Weber', 'RESEARCH TALK: Nikolai Petrov TEA: Zoé Martin', 'Research Talk'), 'UPGRADE TALK: Nikolai Petrov TEA: Zoé Martin'));
t('label: journal clubs, tea-only and cancelled titles untouched', () => { assert.strictEqual(keep_label('TNJC (CSNJC): A', 'TNJC: B', 'TNJC'), 'TNJC: B'); assert.strictEqual(keep_label('TEA: A', 'TEA TALK: B TEA: C', 'Tea Talk'), 'TEA TALK: B TEA: C'); assert.strictEqual(keep_label('Cancelled: x', 'RESEARCH TALK: B TEA: C', 'Research Talk'), 'RESEARCH TALK: B TEA: C'); });
t('notion edit keeps an upgrade-talk label', () => { var before = row({type: 'Research Talk', presenter_ids: ['b'], tea_ids: ['a']}); var r = row({type: 'Research Talk', presenter_ids: ['b'], tea_ids: ['c']}); var o = run(r, 'UPGRADE TALK: Nikolai Petrov TEA: Lena Weber', {t: 'UPGRADE TALK: Nikolai Petrov TEA: Lena Weber', n: notion_fingerprint(before)}, false); assert.strictEqual(o.e.title, 'UPGRADE TALK: Nikolai Petrov TEA: Zoé Martin'); assert.strictEqual(o.res.actual_after, 'UPGRADE TALK: Nikolai Petrov TEA: Zoé Martin'); });
t('tea-page swap keeps an upgrade-talk label', () => { var c = ctx(false); var e = ev('UPGRADE TALK: Nikolai Petrov TEA: Lena Weber'); c.cal = {getEventById: () => e}; apply_swap(row({type: 'Research Talk', presenter_ids: ['b'], tea_ids: ['a']}), 'tea', 'a', 'c', c); assert.strictEqual(e.title, 'UPGRADE TALK: Nikolai Petrov TEA: Zoé Martin'); });
t('relabelled talk agrees', () => assert.ok(titles_agree(parse_title('UPGRADE TALK: Nikolai Petrov TEA: Lena Weber', 'Research Talk'), row({type: 'Research Talk', presenter_ids: ['b'], tea_ids: ['a']}), people)));
t('rotation talk agrees', () => assert.ok(titles_agree(parse_title('ROTATION TALK: Nikolai Petrov TEA: Lena Weber', 'Tea Talk'), row({type: 'Tea Talk', presenter_ids: ['b'], tea_ids: ['a']}), people)));
t('tea-only title compares tea only', () => assert.ok(titles_agree(parse_title('TEA: Lena Weber', 'Tea Talk'), row({type: 'Tea Talk', presenter_ids: ['b'], tea_ids: ['a']}), people)));
t('cancellations recognised', () => { ['No MLJC — CANCELLED', 'TEA TALK: CANCELLED TEA: X', 'TEA TALK: Cancelled TEA: Y', 'TNJC cancelled', 'No TNJC this week'].forEach(x => assert.ok(is_cancelled_title(x), x)); ['TNJC: Lena Weber', 'RESEARCH TALK: Cancela TEA: X'].forEach(x => assert.ok(!is_cancelled_title(x), x)); });
t('cancelled event seen for the first time: no change, no finding', () => { __props = {}; var c = ctx(false); c.baseline = false; c.no_event = []; var e = ev('No TNJC — CANCELLED'); c.cal = {getEventById: () => Object.assign(e, {getDescription: () => '', setDescription: function(){}})}; var out = sync_row(row({start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(out.finding, undefined); assert.strictEqual(e.title, 'No TNJC — CANCELLED'); assert.strictEqual(patched.length, 0); });
t('masked email', () => { assert.strictEqual(mask_email('ada.lovelace@ucl.ac.uk'), 'ad•••e@u•••.ac.uk'); assert.strictEqual(mask_email('ab@gmail.com'), 'a•••@g•••.com'); assert.strictEqual(mask_email('anna@x.org'), 'an•••@x•••.org'); });
// swap requests
Utilities.getUuid = () => '12345678-1234-1234-1234-123456789abc';
function swap_ctx(){ var c = ctx(false); c.settings.PAGE_URL = 'https://page'; c.cal = {getEventById: () => null}; return c; }
t('swap less than a day ahead goes through straight away', () => { __props = {}; var c = swap_ctx(); var msg = request_swap(row({start: new Date(Date.now() + 5 * 3600e3)}), 'presenter', 'b', 'a', c); assert.strictEqual(patched.length, 1); assert.ok(/straight away/.test(msg)); assert.ok(/Swap done/.test(mailed[0])); assert.strictEqual(swap_requests().length, 0); });
t('swap further ahead waits for the other person', () => { __props = {}; var c = swap_ctx(); var msg = request_swap(row({start: soon}), 'presenter', 'b', 'a', c); assert.strictEqual(patched.length, 0); assert.ok(/^lena@x \| Nikolai Petrov asks you to take over/.test(mailed[0])); assert.strictEqual(swap_requests().length, 1); assert.ok(/Nothing changes/.test(msg)); });
t('a new request for the same slot replaces the old one', () => { __props = {}; var c = swap_ctx(); request_swap(row({start: soon}), 'presenter', 'b', 'a', c); Utilities.getUuid = () => 'aaaaaaaa-1234-1234-1234-123456789abc'; request_swap(row({start: soon}), 'presenter', 'b', 'e', c); Utilities.getUuid = () => '12345678-1234-1234-1234-123456789abc'; var all = swap_requests(); assert.strictEqual(all.length, 1); assert.strictEqual(all[0].to, 'e'); });
t('accepting applies the swap; declining tells the requester', () => { __props = {}; var c = swap_ctx(); var r = row({start: soon}); request_swap(r, 'presenter', 'b', 'a', c); var saved = [to_row, notion_get_page]; notion_get_page = () => ({}); to_row = () => row({start: soon}); try { var code = swap_requests()[0].code; c = swap_ctx(); var res = answer_swap(code, true, c); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'a'); assert.ok(/yours now/.test(res)); assert.strictEqual(swap_requests().length, 0); request_swap(row({start: soon}), 'presenter', 'b', 'a', c); c = swap_ctx(); answer_swap(swap_requests()[0].code, false, c); assert.strictEqual(patched.length, 0); assert.ok(/^nikolai@x \| Lena Weber can't take over/.test(mailed[0])); assert.throws(() => answer_swap('12345678123412341234123456789abc', true, c), /already been answered/); } finally { to_row = saved[0]; notion_get_page = saved[1]; } });
t('no answer after a day: one reminder; past requests lapse', () => { __props = {}; var saved = identity_rows; identity_rows = () => ({rows: []}); try { save_swap_request({code: 'c1', row_id: 'r1', duty: 'presenter', from: 'b', to: 'a', created: Date.now() - 25 * 3600e3, start: soon.getTime(), type: 'TNJC', reminded: false}); save_swap_request({code: 'c2', row_id: 'r2', duty: 'presenter', from: 'b', to: 'a', created: Date.now() - 3 * 864e5, start: Date.now() - 3600e3, type: 'TNJC', reminded: false}); var c = swap_ctx(); remind_swap_requests(c); assert.strictEqual(mailed.length, 1); assert.ok(/^nikolai@x \| Lena Weber has not answered/.test(mailed[0])); assert.deepStrictEqual(swap_requests().map(x => x.code), ['c1']); remind_swap_requests(c); assert.strictEqual(mailed.length, 1); } finally { identity_rows = saved; } });
// cancelling
function cev(title){ var e = ev(title); e.desc = ''; e.getDescription = function(){ return this.desc; }; e.setDescription = function(x){ this.desc = x; }; return e; }
function cctx(e){ var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = {getEventById: () => e}; c.constants.gatsby_zoom_link = 'Z'; c.settings.links_in_events = false; return c; }
t('cancelled titles', () => { assert.strictEqual(cancelled_title(row({}), people), 'No TNJC — CANCELLED'); assert.strictEqual(cancelled_title(row({type: 'Tea Talk', tea_ids: ['a']}), people), 'TEA TALK: CANCELLED TEA: Lena Weber'); assert.ok(is_cancelled_title(cancelled_title(row({type: 'Research Talk'}), people))); });
t('cancel on the page: Notion, calendar, one email', () => { __props = {}; var e = cev('TEA TALK: Nikolai Petrov TEA: Lena Weber'); var c = cctx(e); var r = row({type: 'Tea Talk', tea_ids: ['a'], start: soon}); cancel_slot(r, c, {source: 'page', by: 'Nikolai Petrov', reason: 'ill, asked three people'}); assert.strictEqual(patched[0].Title.title[0].text.content, 'Cancelled'); assert.deepStrictEqual(patched[0].Presenter.relation, []); assert.strictEqual(e.title, 'TEA TALK: CANCELLED TEA: Lena Weber'); assert.ok(e.desc.indexOf('Title: Cancelled') === 0); assert.strictEqual(mailed.length, 1); assert.ok(/nikolai@x/.test(mailed[0]) && /lena@x/.test(mailed[0]) && /Cancelled: Tea Talk/.test(mailed[0])); });
t('deleted event: cancelled only if still gone an hour later', () => { __props = {}; var r = row({start: soon}); save_state('ev1', {t: 'TNJC: Nikolai Petrov', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); var c = cctx(null); sync_row(r, c, start_of_today()); assert.strictEqual(patched.length, 0); assert.ok(JSON.parse(__props['state:ev1']).gone); c = cctx(null); var out = sync_row(row({start: soon}), c, start_of_today()); assert.strictEqual(patched[0].Title.title[0].text.content, 'Cancelled'); assert.strictEqual(mailed.length, 1); assert.strictEqual(out.finding, undefined); });
t('deleted event that comes back is not cancelled', () => { __props = {}; var r = row({start: soon}); save_state('ev1', {t: 'TNJC: Nikolai Petrov', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); sync_row(r, cctx(null), start_of_today()); var e = cev('TNJC: Nikolai Petrov'); sync_row(row({start: soon}), cctx(e), start_of_today()); assert.strictEqual(JSON.parse(__props['state:ev1']).gone, undefined); sync_row(row({start: soon}), cctx(null), start_of_today()); assert.strictEqual(patched.length, 0); });
t('event listed as deleted by the Calendar API counts as gone', () => { __props = {}; var r = row({start: soon}); save_state('ev1', {t: 'TNJC: Nikolai Petrov', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r), gone: 1}); var e = cev('TNJC: Nikolai Petrov'); var c = cctx(e); c.deleted_events = {ev1: true}; sync_row(r, c, start_of_today()); assert.strictEqual(patched[0].Title.title[0].text.content, 'Cancelled'); });
t('deleted event never seen before: reported, not cancelled', () => { __props = {}; var out = sync_row(row({start: soon}), cctx(null), start_of_today()); assert.strictEqual(out.finding.kind, 'missing_event'); assert.strictEqual(patched.length, 0); });
t('renamed to cancelled by hand: recorded, title kept', () => { __props = {}; var r = row({start: soon}); save_state('ev1', {t: 'TNJC: Nikolai Petrov', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); var e = cev('No TNJC this week'); sync_row(r, cctx(e), start_of_today()); assert.strictEqual(patched[0].Title.title[0].text.content, 'Cancelled'); assert.strictEqual(e.title, 'No TNJC this week'); assert.strictEqual(mailed.length, 1); });
t('slot cancelled in Notion is left alone (no new event)', () => { __props = {}; var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = cal_stub(); created = []; sync_row(row({title: 'Cancelled', gcal_id: '', start: soon}), c, start_of_today()); assert.strictEqual(created.length, 0); });
t('page offers cancel only for a single presenter of an upcoming confirmed talk', () => { var c = ctx(false); assert.ok(can_cancel(row({start: soon}), c)); assert.ok(!can_cancel(row({start: soon, presenter_ids: ['a', 'b']}), c)); assert.ok(!can_cancel(row({start: soon, title: '[TNJC Tentative]'}), c)); assert.ok(!can_cancel(row({start: soon, type: 'Coffee Cleaning'}), c)); assert.ok(!can_cancel(row({start: new Date(Date.now() - 864e5)}), c)); });
// calendar invitations
var guests_ev = {};
function cal_api(attendees){ guests_ev = {attendees: attendees, patches: []}; Calendar = {Events: {get: () => ({attendees: guests_ev.attendees.map(a => Object.assign({}, a))}), patch: (body, cal, id, opt) => { guests_ev.patches.push({emails: body.attendees.map(a => a.email).sort(), send: opt.sendUpdates}); guests_ev.attendees = body.attendees; }}}; }
function ictx(types){ var c = ctx(false); c.settings.invite_types = types || ['TNJC', 'Research Talk', 'Leaving Tea']; c.settings.live_types.push('Leaving Tea', 'Just Tea'); c.settings.PAGE_URL = 'https://page'; c.tokens = {b: 'tok'}; return c; }
function att(list){ return list.map(x => ({email: x[0], status: x[1]})); }
t('invites: presenter and tea person get invited, with Google notifying them', () => { __props = {}; cal_api([]); var c = ictx(); var r = row({type: 'Research Talk', tea_ids: ['a'], start: soon}); sync_invites(r, c, []); assert.deepStrictEqual(guests_ev.patches, [{emails: ['lena@x', 'nikolai@x'], send: 'all'}]); assert.strictEqual(mailed.length, 0); });
t('invites: nothing to do when the guests are right', () => { __props = {}; cal_api([]); var c = ictx(); var r = row({start: soon}); save_invite_state('ev1', {d: 1, g: ['nikolai@x'], no: []}); sync_invites(r, c, att([['nikolai@x', 'accepted']])); assert.strictEqual(guests_ev.patches.length, 0); });
t('invites: leaving person not invited, tea person is', () => { __props = {}; cal_api([]); sync_invites(row({type: 'Leaving Tea', tea_ids: ['a'], start: soon}), ictx(), []); assert.deepStrictEqual(guests_ev.patches[0].emails, ['lena@x']); });
t('invites: after a swap the old person is removed, hand-added guests stay', () => { __props = {}; save_invite_state('ev1', {d: 1, g: ['nikolai@x'], no: []}); cal_api(att([['nikolai@x', 'accepted'], ['speaker@y', 'accepted']])); sync_invites(row({presenter_ids: ['a'], start: soon}), ictx(), att([['nikolai@x', 'accepted'], ['speaker@y', 'accepted']])); assert.deepStrictEqual(guests_ev.patches[0].emails, ['lena@x', 'speaker@y']); assert.deepStrictEqual(load_invite_state('ev1').g, ['lena@x']); });
t('invites: off for rotas not listed, and in dry run', () => { __props = {}; cal_api([]); sync_invites(row({type: 'MLJC', start: soon}), ictx(), []); var c = ictx(); c.settings.dry_run = true; sync_invites(row({start: soon}), c, []); assert.strictEqual(guests_ev.patches.length, 0); });
t('decline: one email, slot unchanged, not repeated', () => { __props = {}; cal_api([]); var r = row({start: new Date(Date.now() + 20 * 864e5)}); save_invite_state('ev1', {d: 1, g: ['nikolai@x'], no: []}); var c = ictx(); sync_invites(r, c, att([['nikolai@x', 'declined']])); assert.strictEqual(patched.length, 0); assert.strictEqual(guests_ev.patches.length, 0); assert.strictEqual(mailed.length, 1); assert.ok(/^nikolai@x \| Your TNJC talk on .* is still yours/.test(mailed[0]), mailed[0]); c = ictx(); sync_invites(r, c, att([['nikolai@x', 'declined']])); assert.strictEqual(mailed.length, 0); });
function decline_mail(start){ var m = []; var saved = send_mail; send_mail = function(to, subj, blocks, k, o){ m.push({to: to, o: o, blocks: blocks}); }; try { cal_api([]); __props = {}; save_invite_state('ev1', {d: 1, g: ['nikolai@x'], no: []}); sync_invites(row({start: start}), ictx(), att([['nikolai@x', 'declined']])); } finally { send_mail = saved; } return m[0]; }
t('decline close to the slot: organiser in cc, so no personal link', () => { var m = decline_mail(soon); assert.strictEqual(m.o.cc, 'org@x'); assert.ok(m.blocks.some(b => b.url === 'https://page')); assert.ok(!JSON.stringify(m.blocks).includes('tok')); assert.ok(m.blocks.some(b => typeof b === 'string' && /Nobody can take over/.test(b))); });
t('decline further ahead: personal link, gentle wording', () => { var m = decline_mail(new Date(Date.now() + 20 * 864e5)); assert.strictEqual(m.o.cc, undefined); assert.ok(m.blocks.some(b => b.url === 'https://page?t=tok')); assert.ok(/happens by itself/.test(m.blocks[0]) && /still yours/.test(m.blocks[0]) && /accident/.test(m.blocks[0]), m.blocks[0]); });
t('sync_row uses the attendee listing and survives an API error', () => { __props = {}; cal_api([]); var e = cev('TNJC: Nikolai Petrov'); var c = cctx(e); c.settings.invite_types = ['TNJC']; c.attendees = {ev1: []}; var r = row({start: soon}); sync_row(r, c, start_of_today()); assert.deepStrictEqual(guests_ev.patches[0].emails, ['nikolai@x']); Calendar.Events.get = () => { throw new Error('boom'); }; __props = {}; c = cctx(e); c.settings.invite_types = ['TNJC']; c.attendees = {ev1: []}; sync_row(r, c, start_of_today()); assert.ok(logged.some(l => /invitations failed/.test(l)), logged.join('; ')); });
t('tea-page swap updates the guests straight away', () => { __props = {}; save_invite_state('ev1', {d: 1, g: ['nikolai@x'], no: []}); cal_api(att([['nikolai@x', 'accepted']])); var c = ictx(); var e = ev('TNJC: Nikolai Petrov'); c.cal = {getEventById: () => e}; apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); assert.deepStrictEqual(guests_ev.patches[0].emails, ['lena@x']); });
t('cancelling a talk uninvites the presenter, the tea person stays', () => { __props = {}; save_invite_state('ev1', {d: 1, g: ['lena@x', 'nikolai@x'], no: []}); cal_api(att([['lena@x', 'accepted'], ['nikolai@x', 'accepted']])); var e = cev('TEA TALK: Nikolai Petrov TEA: Lena Weber'); var c = cctx(e); c.settings.invite_types = ['Tea Talk']; c.settings.live_types.push('Tea Talk'); cancel_slot(row({type: 'Tea Talk', tea_ids: ['a'], start: soon}), c, {source: 'page', by: 'Nikolai Petrov', reason: 'ill, asked three people'}); assert.deepStrictEqual(guests_ev.patches[0].emails, ['lena@x']); });
t('cap: at most 10 invitations to one person a day; the rest held back, the tea tsar alerted once', () => {
  __props = {}; cal_api([]); var m = []; var saved = send_mail; send_mail = function(to, subj, b, k, o){ m.push(to + ' | ' + subj + ' | ' + ((o || {}).cc || '')); };
  try {
    for (var i = 0; i < 12; i++) sync_invites(row({gcal_id: 'ev' + i, start: soon}), ictx(), []);
    assert.strictEqual(guests_ev.patches.length, 10);
    assert.deepStrictEqual(m, ['tsar@x | Calendar invitations to Nikolai Petrov stopped | ']);
    assert.deepStrictEqual(load_invite_state('ev11').g, []);
    assert.deepStrictEqual(load_invite_state('ev3').g, ['nikolai@x']);
    sync_invites(row({gcal_id: 'ev11', start: soon}), ictx(), []);
    assert.strictEqual(guests_ev.patches.length, 10); assert.strictEqual(m.length, 1);
    __props['invcount:nikolai@x'] = JSON.stringify(JSON.parse(__props['invcount:nikolai@x']).map(t => t - 864e5 - 1));
    sync_invites(row({gcal_id: 'ev11', start: soon}), ictx(), []);
    assert.strictEqual(guests_ev.patches.length, 11);
  } finally { send_mail = saved; }
});
t('badges: the tsar gets the crowned teapot, organisers their crowned duty, everyone else nothing', () => { Utilities.base64Encode = x => Buffer.from(x).toString('base64'); Utilities.Charset = {UTF_8: 'utf8'}; var c = ctx(false); c.constants = {admin_email: 'tsar@x', tnjc_admin_email: 'org@x', mljc_admin_email: 'ml@x', coffee_admin_email: 'cof@x'}; var who = e => { c.me_identity = {email: e}; var b = royal_badge(c); return b && b.label; }; assert.strictEqual(who('Tsar@x'), 'Tea Tsar'); assert.strictEqual(who('org@x'), 'TNJC Tsar'); assert.strictEqual(who('cof@x'), 'Coffee Tsar'); assert.strictEqual(who('lena@x'), null); assert.strictEqual(who(''), null); c.me_identity = {email: 'tsar@x'}; assert.ok(royal_badge(c).src.startsWith('data:image/svg+xml;base64,')); });
// just tea cancelled in the calendar
t('just tea renamed to cancelled: tea person cleared, keeps their turn', () => { __props = {}; Calendar = null; var r = row({type: 'Just Tea', presenter_ids: [], tea_ids: ['a'], start: soon}); save_state('ev1', {t: 'JUST TEA: Lena Weber', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); var e = cev('JUST TEA: CANCELLED'); var c = cctx(e); c.settings.live_types.push('Just Tea'); sync_row(r, c, start_of_today()); assert.strictEqual(patched[0].Title.title[0].text.content, 'Cancelled'); assert.deepStrictEqual(patched[0].Tea.relation, []); assert.strictEqual(patched[0].Presenter, undefined); assert.ok(/^lena@x \| Cancelled: Just Tea/.test(mailed[0]), mailed[0]); });
t('just tea deleted: cancelled an hour later', () => { __props = {}; var r = row({type: 'Just Tea', presenter_ids: [], tea_ids: ['a'], start: soon}); save_state('ev1', {t: 'JUST TEA: Lena Weber', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); var c = cctx(null); c.settings.live_types.push('Just Tea'); sync_row(r, c, start_of_today()); assert.strictEqual(patched.length, 0); c = cctx(null); c.settings.live_types.push('Just Tea'); sync_row(row({type: 'Just Tea', presenter_ids: [], tea_ids: ['a'], start: soon}), c, start_of_today()); assert.deepStrictEqual(patched[0].Tea.relation, []); });
t('coffee event deleted: reported, not cancelled', () => { __props = {}; var r = row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['a'], start: soon}); save_state('ev1', {t: 'x', n: notion_fingerprint(r), d: soon.getTime()}); var out = sync_row(r, cctx(null), start_of_today()); assert.strictEqual(out.finding.kind, 'missing_event'); assert.strictEqual(patched.length, 0); });
// leaving the tea system
t('leave link: personal for one registered recipient, general otherwise', () => { var saved = identity_rows; identity_rows = () => ({rows: [{id: 'b', email: 'Nikolai@x', token: 'tok'}]}); identity_token_cache = null; try { var base = page_url(get_settings()); assert.strictEqual(leave_url('nikolai@x', {}, {}), base + '?t=tok&leave=1'); assert.strictEqual(leave_url('nikolai@x', {cc: 'org@x'}, {}), base + '?leave=1'); assert.strictEqual(leave_url('nikolai@x,lena@x', {}, {}), base + '?leave=1'); assert.strictEqual(leave_url('list@x', {}, {}), base + '?leave=1'); } finally { identity_rows = saved; identity_token_cache = null; } });
t('tea-page links: the general one carries the unit key, links with a personal code do not', () => { var s = {PAGE_URL: 'https://page', PAGE_KEY: 'unitkey1'}; assert.strictEqual(page_link(s), 'https://page?k=unitkey1'); assert.strictEqual(page_link(s, {leave: 1}), 'https://page?k=unitkey1&leave=1'); assert.strictEqual(personal_link('tok', s), 'https://page?t=tok'); assert.strictEqual(page_link(s, {t: 'tok', leave: 1}), 'https://page?t=tok&leave=1'); assert.strictEqual(page_link(s, {swap: 'c1'}), 'https://page?swap=c1'); assert.strictEqual(page_link({PAGE_URL: 'https://page'}, {leave: 1}), 'https://page?leave=1'); });
t('general page: no names, links or leaving without the unit key', () => { settings_cache = Object.assign({}, get_settings(), {PAGE_KEY: 'unitkey1'}); try { assert.throws(() => api_link_people(''), /calendar event/); assert.throws(() => api_link_people('wrongkey'), /calendar event/); assert.throws(() => api_request_link('', '0123456789abcdef0123456789abcdef'), /calendar event/); assert.throws(() => api_leave_by_name('wrongkey', '0123456789abcdef0123456789abcdef'), /calendar event/); } finally { settings_cache = null; } });
t('link by email: sent only to an active registered address, the same answer either way', () => {
  var m = [], store = {}; var saved = [identity_rows, send_mail, load_people, get_global_constants, CacheService];
  get_global_constants = () => ({});
  load_people = () => ({'0123456789abcdef0123456789abcdef': {active: true, name: 'Nikolai Petrov'}, 'fedcba9876543210fedcba9876543210': {active: false, name: 'Lena Weber'}});
  identity_rows = () => ({rows: [{id: '0123456789abcdef0123456789abcdef', email: 'Nikolai@x.org', token: 'a'.repeat(40)}, {id: 'fedcba9876543210fedcba9876543210', email: 'lena@x.org', token: 'b'.repeat(40)}]});
  send_mail = function(to){ m.push(to); };
  CacheService = {getScriptCache: () => ({get: k => store[k] || null, put: (k, v) => { store[k] = v; }, remove: () => {}})};
  try {
    var a = api_request_link_by_email(' nikolai@X.org ');
    assert.strictEqual(api_request_link_by_email('nobody@x.org'), a);
    assert.strictEqual(api_request_link_by_email('lena@x.org'), a);
    assert.deepStrictEqual(m, ['Nikolai@x.org']);
    api_request_link_by_email('nikolai@x.org'); api_request_link_by_email('nikolai@x.org');
    assert.strictEqual(api_request_link_by_email('nikolai@x.org'), a); assert.strictEqual(m.length, 3);
    assert.throws(() => api_request_link_by_email('not an email'), /does not look like/);
  } finally { identity_rows = saved[0]; send_mail = saved[1]; load_people = saved[2]; get_global_constants = saved[3]; CacheService = saved[4]; }
});
t('leaving: inactive in Notion, email and code cleared, requests dropped, organiser told about slots', () => {
  __props = {}; var m = [], cleared = [];
  var saved = [identity_rows, upcoming_rows_of, send_mail];
  identity_rows = () => ({sheet: {getRange: (r, c, nr, nc) => ({setValues: v => cleared.push([r, c, nc, v])})}, rows: [{row: 5, id: 'b', email: 'nikolai@x', token: 'tok'}]});
  upcoming_rows_of = () => [row({start: soon, url: 'https://notion/r1'}), row({id: 'r2', type: 'Research Talk', presenter_ids: ['a'], tea_ids: ['b'], start: soon})];
  send_mail = function(to, subj, blocks, k, o){ m.push({to: to, subj: subj, o: o || {}, text: JSON.stringify(blocks)}); };
  try {
    save_swap_request({code: 'c1', row_id: 'r1', duty: 'presenter', from: 'b', to: 'a', created: Date.now(), start: soon.getTime(), type: 'TNJC', reminded: false});
    save_swap_request({code: 'c2', row_id: 'r9', duty: 'tea', from: 'a', to: 'e', created: Date.now(), start: soon.getTime(), type: 'TNJC', reminded: false});
    var c = ctx(false); c.me = people.b; c.me_identity = {email: 'nikolai@x'};
    leave_tea_system(c, 'own link');
    assert.deepStrictEqual(patched[0], {Active: {checkbox: false}});
    assert.deepStrictEqual(swap_requests().map(x => x.code), ['c2']);
    assert.deepStrictEqual(cleared, [[5, 3, 2, [['', '']]]]);
    assert.strictEqual(m[0].to, 'nikolai@x'); assert.ok(/left the Gatsby tea system/.test(m[0].subj));
    assert.strictEqual(m.length, 2);
    var tsar = m[1];
    assert.strictEqual(tsar.to, 'tsar@x'); assert.strictEqual(tsar.o.cc, 'org@x');
    assert.ok(/TNJC talk/.test(tsar.text) && /tea duty/.test(tsar.text) && /no longer a member of the Unit/.test(tsar.text) && /personal link/.test(tsar.text), tsar.text);
  } finally { identity_rows = saved[0]; upcoming_rows_of = saved[1]; send_mail = saved[2]; }
});
t('leaving by picking a name: one click, the tea tsar is warned anyone could have done it; rate-limited', () => {
  var m = [], store = {}; var saved = [identity_rows, upcoming_rows_of, send_mail, make_context, CacheService, LockService, get_global_constants];
  get_global_constants = () => ({});
  people['0123456789abcdef0123456789abcdef'] = Object.assign({}, people.b, {id: '0123456789abcdef0123456789abcdef'}); people['fedcba9876543210fedcba9876543210'] = Object.assign({}, people.d, {id: 'fedcba9876543210fedcba9876543210'});
  identity_rows = () => ({sheet: {getRange: () => ({setValues: () => {}})}, rows: [{row: 5, id: '0123456789abcdef0123456789abcdef', email: 'nikolai@x', token: 'tok'}]}); upcoming_rows_of = () => [];
  send_mail = function(to, subj, blocks){ m.push(to + ' | ' + subj + ' | ' + JSON.stringify(blocks)); };
  make_context = () => { var c = ctx(false); return c; };
  CacheService = {getScriptCache: () => ({get: k => store[k] || null, put: (k, v) => { store[k] = v; }, remove: () => {}})};
  LockService = {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})};
  try {
    assert.ok(/left the Gatsby tea system/.test(api_leave_by_name('', '0123456789abcdef0123456789abcdef')));
    assert.deepStrictEqual(patched[0], {Active: {checkbox: false}});
    assert.ok(/^nikolai@x \| You have left/.test(m[0])); assert.ok(/^tsar@x \| Nikolai Petrov has left/.test(m[1]) && /anyone could do/.test(m[1]), m[1]);
    assert.throws(() => api_leave_by_name('', 'fedcba9876543210fedcba9876543210'), /not in the tea system/);
    store['leave:all'] = '5'; assert.throws(() => api_leave_by_name('', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), /try again later/);
  } finally { identity_rows = saved[0]; upcoming_rows_of = saved[1]; send_mail = saved[2]; make_context = saved[3]; CacheService = saved[4]; LockService = saved[5]; get_global_constants = saved[6]; delete people['0123456789abcdef0123456789abcdef']; delete people['fedcba9876543210fedcba9876543210']; }
});
t('leaving without upcoming slots: the tea tsar is told', () => { var m = []; var saved = [identity_rows, upcoming_rows_of, send_mail]; identity_rows = () => ({sheet: {getRange: () => ({setValues: () => {}})}, rows: []}); upcoming_rows_of = () => []; send_mail = function(to, subj){ m.push(to + ' | ' + subj); }; try { var c = ctx(false); c.me = people.b; c.me_identity = {email: ''}; leave_tea_system(c, 'own link'); } finally { identity_rows = saved[0]; upcoming_rows_of = saved[1]; send_mail = saved[2]; } assert.deepStrictEqual(m, ['tsar@x | Nikolai Petrov has left the tea system']); });
t('rota overview: same rules as scheduling', () => { var saved = notion_query; notion_query = () => []; try { var c = ctx(false); c.me_identity = {email: 'tsar@x'}; c.people = {p: {id: 'p', name: 'Pat Kim', active: true, tnjc: true, csnjc: false, mljc: true, coffee: false, position: 'PhD student', rt_excluded: true, tt_excluded: false, tea_excluded: false, email: 'p@x'}, q: {id: 'q', name: 'Old One', active: false}}; var r = rota_overview(c); assert.deepStrictEqual(r.people[0].on, {tnjc: true, csnjc: false, mljc: true, research: false, teatalk: true, tea: true, coffee: false}); assert.strictEqual(r.inactive, 1); assert.strictEqual(r.people.length, 1); } finally { notion_query = saved; } });
t('rota overview: an organiser sees only their own rota', () => {
  var saved = notion_query;
  notion_query = () => [{start: '2026-11-03T13:30:00Z', type: 'TNJC', presenter: 'p'}, {start: '2026-11-02T13:30:00Z', type: 'MLJC', presenter: 'p'}, {start: '2026-11-02T13:30:00Z', type: 'MLJC', presenter: 'm'}].map(o => row({start: new Date(o.start), type: o.type, presenter_ids: [o.presenter], tea_ids: [], title: ''}));
  var saved_to_row = to_row; to_row = r => r;
  try {
    var c = ctx(false); c.me_identity = {email: 'org@x'};
    c.people = {p: {id: 'p', name: 'Pat Kim', active: true, tnjc: true, csnjc: false, mljc: true, coffee: false, position: 'PhD student', email: 'p@x'},
                m: {id: 'm', name: 'Mo Only', active: true, tnjc: false, csnjc: false, mljc: true, coffee: true, position: 'PhD student', email: 'm@x'},
                q: {id: 'q', name: 'Old One', active: false, tnjc: true}, z: {id: 'z', name: 'Old Coffee', active: false, coffee: true}};
    var r = rota_overview(c);
    assert.deepStrictEqual(r.columns.map(x => x.key), ['tnjc', 'csnjc']);
    assert.deepStrictEqual(r.people.map(p => p.name), ['Pat Kim']);
    assert.deepStrictEqual(r.people[0].on, {tnjc: true, csnjc: false});
    assert.strictEqual(r.people[0].upcoming, 1); assert.ok(/TNJC/.test(r.people[0].next) && !/MLJC/.test(r.people[0].next), r.people[0].next);
    assert.strictEqual(r.inactive, 1);
    c.me_identity = {email: 'someone@x'}; assert.deepStrictEqual(rota_overview(c).columns, []);
  } finally { notion_query = saved; to_row = saved_to_row; }
});
// slot creation (as the notebooks did it)
t('london time, winter and summer', () => { assert.strictEqual(london_iso('2026-11-03', [13, 30]), '2026-11-03T13:30:00+00:00'); assert.strictEqual(london_iso('2027-05-04', [13, 30]), '2027-05-04T13:30:00+01:00'); });
t('weekday', () => { assert.strictEqual(iso_weekday('2026-11-03'), 2); assert.strictEqual(iso_weekday('2026-11-02'), 1); });
var made = [];
function slot_ctx(existing_rows, coffee_rows){ made = []; notion_request = function(m, path, body){ made.push(body.properties); return {}; }; load_rows = function(type){ return type === 'Coffee Cleaning' ? (coffee_rows || []) : (existing_rows || []).filter(r => r.type === type); }; var c = ctx(false); c.constants.notion_talk_db_id = 'db'; return c; }
t('TNJC slots match the September run (9 Tuesdays, CSNJC on the last Tuesday)', () => { var c = slot_ctx(); var r = create_slots('TNJC', {from: '2026-11-01', to: '2026-12-31'}, c); assert.strictEqual(r.created.length, 9); var cs = made.filter(p => p.CSNJC.checkbox).map(p => p.Date.date.start.slice(0, 10)); assert.deepStrictEqual(cs, ['2026-11-24', '2026-12-29']); assert.strictEqual(made[0].Title.title[0].text.content, '[TNJC Tentative]'); assert.strictEqual(made[0].Date.date.end, '2026-11-03T14:30:00+00:00'); });
t('existing slots are not duplicated', () => { var c = slot_ctx([{type: 'TNJC', start: new Date('2026-11-10T13:30:00Z')}]); var r = create_slots('TNJC', {from: '2026-11-01', to: '2026-11-30'}, c); assert.strictEqual(r.created.length, 3); assert.deepStrictEqual(r.skipped, ['2026-11-10 TNJC']); });
t('talks: research Mondays, tea talks Tue + Thu', () => { var c = slot_ctx(); create_slots('talks', {research_from: '2026-12-01', research_to: '2026-12-14', tea_from: '2026-11-02', tea_to: '2026-11-08'}, c); var kinds = made.map(p => p.Type.select.name + ' ' + p.Date.date.start.slice(0, 16)); assert.deepStrictEqual(kinds, ['Tea Talk 2026-11-03T15:30', 'Tea Talk 2026-11-05T15:30', 'Research Talk 2026-12-07T15:00', 'Research Talk 2026-12-14T15:00']); assert.ok(made.every(p => p.Title.title[0].text.content === '[Tentative]')); });
t('MLJC on Mondays', () => { var c = slot_ctx(); create_slots('MLJC', {from: '2026-11-01', to: '2026-11-15'}, c); assert.deepStrictEqual(made.map(p => p.Date.date.start.slice(0, 10)), ['2026-11-02', '2026-11-09']); });
t('coffee: Mon-Fri weeks, water filter continues the 4-week cycle, texts copied', () => { var c = slot_ctx([], [{type: 'Coffee Cleaning', start: new Date(2026, 9, 19), water_filter: true, description: 'FILTER'}, {type: 'Coffee Cleaning', start: new Date(2026, 9, 26), water_filter: false, description: 'STD'}]); create_slots('Coffee Cleaning', {from: '2026-11-02', to: '2026-11-29'}, c); assert.deepStrictEqual(made.map(p => [p.Date.date.start, p.Date.date.end, p['Water filter (coffee only)'].checkbox, p.Description.rich_text[0].text.content]), [['2026-11-02', '2026-11-06', false, 'STD'], ['2026-11-09', '2026-11-13', false, 'STD'], ['2026-11-16', '2026-11-20', true, 'FILTER'], ['2026-11-23', '2026-11-27', false, 'STD']]); });
t('bank holidays are skipped when creating slots', () => { var c = slot_ctx(); UrlFetchApp_stub(() => ({getResponseCode: () => 200, getContentText: () => JSON.stringify({'england-and-wales': {events: [{date: '2026-11-09', title: 'Test Day'}]}})})); var r = create_slots('MLJC', {from: '2026-11-01', to: '2026-11-15'}, c); UrlFetchApp = null; assert.deepStrictEqual(made.map(p => p.Date.date.start.slice(0, 10)), ['2026-11-02']); assert.deepStrictEqual(r.holidays, ['2026-11-09 (Test Day)']); });
t('swap list: who usually does a duty', () => { var p = {active: true, name: 'X', tnjc: true, csnjc: false, mljc: false, coffee: false, position: 'PhD student', rt_excluded: true, tt_excluded: false, tea_excluded: false}; assert.ok(can_do_duty(p, row({}), 'presenter')); assert.ok(!can_do_duty(p, row({csnjc: true}), 'presenter')); assert.ok(!can_do_duty(p, row({type: 'Research Talk'}), 'presenter')); assert.ok(can_do_duty(p, row({type: 'Research Talk'}), 'tea')); assert.ok(!can_do_duty(Object.assign({}, p, {position: 'Included only for JCs / coffee'}), row({type: 'Tea Talk'}), 'presenter')); assert.ok(!can_do_duty(Object.assign({}, p, {active: false}), row({}), 'presenter')); });
// network blips
t('Notion call retries after a network exception', () => { var calls = 0; var saved = UrlFetchApp_stub(() => { calls++; if (calls < 3) throw new Error('Address unavailable'); return {getResponseCode: () => 200, getContentText: () => '{"ok":1}'}; }); Utilities.sleep = function(){}; var r = real_notion_request('get', 'x', null, {notion_token: 't'}); assert.strictEqual(r.ok, 1); assert.strictEqual(calls, 3); });
t('hourly sync emails only after 3 failures in a row', () => { var m = []; send_mail = function(to, subj){ m.push(subj); }; clear_failures('Calendar sync'); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 0); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 1); clear_failures('Calendar sync'); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 1); });
t('other jobs email on the first failure', () => { var m = []; send_mail = function(to, subj){ m.push(subj); }; notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'a'}); assert.strictEqual(m.length, 1); });
// error mails
t('errors go to the TNJC organiser with the tea tsar in cc', () => { var m = []; send_mail = function(to, subj, b, c, o){ m.push([to, o && o.cc]); }; notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'lena@x', admin_email: 'tsar@x'}); assert.deepStrictEqual(m[0], ['lena@x', 'tsar@x']); });
// the Gatsby Rotas site (Site.js)
var SITE_PAGE = '2444835e8eab46fa9a7c792877e09620';
function site_page(){ return {id: SITE_PAGE, slug: 'tea-system', title: 'Tea', blocks: [
  {id: 'b1', type: 'p', rt: [{text: 'one'}]},
  {id: 't1', type: 'toggle', rt: [{text: 'FAQ'}], children: [{id: 'c1', type: 'p', rt: [{text: 'inside'}]}]},
  {id: 'tb', type: 'table', rows: [{id: 'r1', cells: [[{text: 'x'}]]}]},
  {id: 'v1', type: 'view', view: 'schedule'}]}; }
t('site: rich text keeps only what the site writes (no script links, no odd fields)', () => {
  var rt = clean_site_rich([{text: 'a', b: true, onclick: 'x'}, {text: 'b', href: 'javascript:alert(1)'}, {text: 'c', href: '/2444835e8eab46fa9a7c792877e09620#b336808b691c4e25b407103950f50d6d'},
                            {text: 'd', page: 'not-an-id'}, {text: ''}, {text: 'e', color: 'red; background:url(x)'}, {text: 'f', color: 'blue_background'}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rt)), [{text: 'a', b: true}, {text: 'b'}, {text: 'c', href: '/2444835e8eab46fa9a7c792877e09620#b336808b691c4e25b407103950f50d6d'},
                                                          {text: 'd'}, {text: 'e'}, {text: 'f', color: 'blue_background'}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(clean_site_rich([{text: 'g', href: '/p/674394b3dd0d4e1aa44b36ea49bf5aaa?pvs=25'}, {text: 'h', color: 'teal'}]))),
                         [{text: 'g', href: '/674394b3dd0d4e1aa44b36ea49bf5aaa'}, {text: 'h', color: 'green'}]);
});
t('site: page edits apply in order; new blocks follow new blocks or go first', () => {
  var n = 0, page = site_page();
  apply_site_ops(page, [
    {op: 'update', id: 'b1', rt: [{text: 'ONE', b: true}]},
    {op: 'insert', tmp: 'new1', parent: SITE_PAGE, after: 'b1', type: 'ul', rt: [{text: 'li 1'}]},
    {op: 'insert', tmp: 'new2', parent: SITE_PAGE, after: 'new1', type: 'ul', rt: [{text: 'li 2'}]},
    {op: 'insert', tmp: 'new3', parent: 't1', after: null, type: 'p', rt: [{text: 'first inside'}]},
    {op: 'insert', tmp: 'new4', parent: SITE_PAGE, after: '', type: 'h1', rt: [{text: 'Top'}]},
    {op: 'cells', id: 'r1', cells: [[{text: 'y'}]]},
    {op: 'title', title: 'Tea, again'},
    {op: 'delete', id: 'c1'}
  ], () => 'id' + (++n));
  assert.deepStrictEqual(page.blocks.map(b => b.id), ['id4', 'b1', 'id1', 'id2', 't1', 'tb', 'v1']);
  assert.strictEqual(page.blocks[1].rt[0].b, true);
  assert.deepStrictEqual(page.blocks[4].children.map(b => b.id), ['id3']);
  assert.strictEqual(page.blocks[5].rows[0].cells[0][0].text, 'y');
  assert.strictEqual(page.title, 'Tea, again');
});
t('site: edits to what is gone, views or unknown kinds are refused', () => {
  assert.throws(() => apply_site_ops(site_page(), [{op: 'delete', id: 'c1'}, {op: 'update', id: 'c1', rt: []}], () => 'x'), /changed or gone/);
  assert.throws(() => apply_site_ops(site_page(), [{op: 'update', id: 'v1', rt: []}], () => 'x'), /cannot be edited/);
  assert.throws(() => apply_site_ops(site_page(), [{op: 'insert', tmp: 'n', parent: SITE_PAGE, type: 'image'}], () => 'x'), /Unknown kind/);
  assert.throws(() => apply_site_ops(site_page(), [{op: 'insert', tmp: 'n', parent: 'v1', type: 'p'}], () => 'x'), /cannot go there/);
  assert.throws(() => apply_site_ops(site_page(), [{op: 'title', title: '  '}], () => 'x'), /title/);
});
t('site: imported pages keep only known blocks and safe addresses', () => {
  var saved = Utilities.getUuid; Utilities.getUuid = () => '0000-1111';
  try {
    var out = clean_site_blocks([
      {id: 'a', type: 'p', rt: [{text: 'hi'}], extra: 1},
      {id: 'b', type: 'image', url: 'javascript:x'}, {id: 'c', type: 'image', url: 'img/timer.png', caption: []},
      {id: 'd', type: 'view', view: 'coffee-duties'}, {id: 'e', type: 'script'},
      {id: 'f', type: 'toggle', toggle: true, rt: [], children: [{id: 'g', type: 'p', rt: []}]}]);
    assert.deepStrictEqual(out.map(b => b.id), ['a', 'c', 'f']);
    assert.strictEqual('extra' in out[0], false);
    assert.strictEqual(out[2].children[0].id, 'g');
  } finally { Utilities.getUuid = saved; }
});
var site_saved = {};
function site_stubs(email){
  site_saved = {gc: get_global_constants, idt: identity_for_token, nr: notion_request, np: notion_patch_page, gp: notion_get_page, lp: load_people, ls: ensure_log_sheet, pe: site_person};
  get_global_constants = () => ({admin_email: 'tsar@x', tnjc_admin_email: 'tnjc@x', mljc_admin_email: 'mljc@x', coffee_admin_email: 'coffee@x', notion_talk_db_id: 'db', notion_people_db_id: 'pdb'});
  identity_for_token = (tok) => (tok === 'tok' ? {id: 'p1', email: email} : null);
  load_people = () => ({p1: {id: 'p1', name: 'Lena Weber', active: true}, b: {id: 'b', name: 'Nikolai Petrov', active: true}});
  ensure_log_sheet = () => { throw new Error('no sheet in tests'); };
}
function site_restore(){
  get_global_constants = site_saved.gc; identity_for_token = site_saved.idt; notion_request = site_saved.nr;
  notion_patch_page = site_saved.np; notion_get_page = site_saved.gp; load_people = site_saved.lp; ensure_log_sheet = site_saved.ls; site_person = site_saved.pe;
}
t('site: who may edit what', () => {
  site_stubs('Tsar@x');
  try {
    var c = get_global_constants();
    var tea = site_rights('tok', c);
    assert.ok(tea.pages && tea.rules && tea.add_people && tea.tea_tsar && tea.people[0] === 'all' && tea.slots.length === ALL_TYPES.length);
    identity_for_token = () => ({id: 'p1', email: 'tnjc@x'});
    var tnjc = site_rights('tok', c);
    assert.deepStrictEqual(JSON.parse(JSON.stringify([tnjc.pages, tnjc.rules, tnjc.slots, tnjc.people])), [true, false, ['TNJC'], ['TNJC', 'CSNJC']]);
    identity_for_token = () => ({id: 'p1', email: 'someone@x'});
    var none = site_rights('tok', c);
    assert.ok(!none.pages && !none.slots.length && !none.people.length);
    assert.strictEqual(site_rights('', c).person, '');
  } finally { site_restore(); }
});
t('site: a rota tsar can only tick their own rota on people, and only edit their own slots', () => {
  site_stubs('tnjc@x');
  var patched = null;
  try {
    notion_patch_page = function(id, props){ patched = props; return {id: id, properties: {}}; };
    site_person = function(page){ return page; };
    api_site_save_person('tok', {id: 'p2', name: 'X', rotas: ['TNJC', 'MLJC'], active: false, excluded: ['tea']});
    assert.deepStrictEqual(Object.keys(patched).sort(), ['CSNJC', 'TNJC']);
    assert.strictEqual(patched.TNJC.checkbox, true);
    assert.throws(() => api_site_save_person('tok', {name: 'New'}), /tea tsar/);
    assert.throws(() => api_site_save_slot('tok', {type: 'MLJC', start: '2026-11-02'}), /MLJC tsar/);
    notion_get_page = function(){ return {id: 's1', properties: {Type: {select: {name: 'MLJC'}}}}; };
    assert.throws(() => api_site_save_slot('tok', {id: 's1', type: 'TNJC', start: '2026-11-02'}), /MLJC tsar/);
  } finally { site_restore(); }
});
t('site: the pages are imported once; only the tea tsar may replace them', () => {
  site_stubs('tnjc@x');
  var saved_lock = LockService, saved_sheet = site_pages_sheet, saved_pages = site_pages, saved_save = save_site_page, written = [];
  LockService = {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})};
  site_pages_sheet = () => ({});
  save_site_page = (sheet, page) => written.push(page.slug);
  try {
    site_pages = () => ({});
    api_site_import_pages('tok', {home: {id: 'h', title: 'Home', blocks: []}, nonsense: {blocks: []}});
    assert.deepStrictEqual(written, ['home']);
    site_pages = () => ({home: {}});
    assert.throws(() => api_site_import_pages('tok', {home: {blocks: []}}, true), /only the tea tsar/);
    identity_for_token = () => ({id: 'p1', email: 'tsar@x'});
    api_site_import_pages('tok', {home: {blocks: []}}, true);
    assert.deepStrictEqual(written, ['home', 'home']);
  } finally {
    LockService = saved_lock; site_pages_sheet = saved_sheet; site_pages = saved_pages; save_site_page = saved_save; site_restore();
  }
});
t('site: dates for Notion', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(site_notion_date('2026-11-02', '2026-11-06'))), {start: '2026-11-02', end: '2026-11-06'});
  assert.throws(() => site_notion_date('', null), /date/);
  assert.throws(() => site_notion_date('2026-11-02', 'soon'), /end time/);
});
t('site: big values go into the cache in pieces, ASCII only', () => {
  var store = {};
  var saved = CacheService;
  CacheService = {getScriptCache: () => ({putAll: (o) => Object.assign(store, o), get: (k) => store[k] || null, getAll: (ks) => { var o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); return o; }})};
  try {
    var v = {s: new Array(200001).join('é')};
    cache_put_big('k', v, 60);
    assert.strictEqual(store.k, '14');
    assert.ok(Object.keys(store).every(k => k === 'k' || /^[\x00-\x7f]*$/.test(store[k])));
    assert.deepStrictEqual(cache_get_big('k'), v);
  } finally { CacheService = saved; }
});
results.join('\\n');
`;
// SECURITY: a web page can call every top-level function of its project, so the page project may only
// contain doGet, token-checked api_* wrappers and authorize
const pageSrc = fs.readdirSync(path.join(__dirname, '..', 'apps-script', 'page')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'page', f), 'utf8')).join('\n');
const pageFns = [...pageSrc.matchAll(/^\s*function\s+(\w+)/gm)].map(m => m[1]);
const extra = pageFns.filter(n => !(n === 'doGet' || n === 'doPost' || n === 'authorize' || /^api_/.test(n)));
const autoApis = [...src.matchAll(/^function (api_\w+)\(/gm)].map(m => m[1]);
const missing = autoApis.filter(n => pageFns.indexOf(n) < 0);
console.log((extra.length || missing.length ? 'FAIL' : 'ok  ') + ' page project exposes only doGet, doPost, api_* and authorize' + (extra.length ? ' (extra: ' + extra + ')' : '') + (missing.length ? ' (missing wrappers: ' + missing + ')' : ''));
if (extra.length || missing.length) process.exitCode = 1;
const ctx = vm.createContext({console, Buffer, assert, require_crypto: require('crypto'), Intl});
const out = vm.runInContext(stubs + src + tests, ctx);
console.log(out);
process.exit(out.includes('FAIL') ? 1 : 0);
