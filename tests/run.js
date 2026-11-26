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
  DigestAlgorithm: { MD5: 'md5' },
  getUuid: () => require_crypto.randomUUID()
};
`;
const tests = `
var results = [];
// the real Notion helpers, before tests below replace some of them
var REAL = {notion_request: notion_request, notion_patch_page: notion_patch_page, notion_get_page: notion_get_page, notion_query: notion_query, to_row: to_row, send_mail: send_mail};
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
t('coffee gets no calendar event', () => { var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = cal_stub(); created = []; var out = sync_row(row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['a'], gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.deepStrictEqual(created, []); assert.strictEqual(out.finding, undefined); });
t('finalising coffee clears the tentative title without an event', () => { var c = ctx(false); c.cal = cal_stub(); created = []; var r = row({type: 'Coffee Cleaning', title: '[Coffee Cleaning Tentative]', presenter_ids: [], tea_ids: ['a'], gcal_id: ''}); finalise_rows([r], c); assert.deepStrictEqual(created, []); assert.deepStrictEqual(patched, [{Title: {title: [{text: {content: ''}}]}}]); var t = row({title: '[TNJC Tentative]', gcal_id: ''}); finalise_rows([t], c); assert.strictEqual(created.length, 1); });
t('upcoming coffee events are removed, past ones kept', () => { __props = {}; var c = ctx(false); var removed = []; var saved = [load_rows, site_delete_event]; site_delete_event = (id) => { removed.push(id); return 'deleted'; }; var day = 864e5, now = Date.now(); load_rows = (type) => type !== 'Coffee Cleaning' ? [] : [row({id: 'past', type: 'Coffee Cleaning', gcal_id: 'e0', start: new Date(now - 10 * day), end: new Date(now - 6 * day)}), row({id: 'this', type: 'Coffee Cleaning', gcal_id: 'e1', start: new Date(now - 2 * day), end: new Date(now + 2 * day)}), row({id: 'next', type: 'Coffee Cleaning', gcal_id: 'e2', start: new Date(now + 5 * day)}), row({id: 'none', type: 'Coffee Cleaning', gcal_id: '', start: new Date(now + 12 * day)})]; try { assert.strictEqual(remove_off_calendar_events(c, start_of_today()), 2); assert.deepStrictEqual(removed, ['e1', 'e2']); assert.deepStrictEqual(patched[0], {'GCal ID': {rich_text: []}}); c = ctx(true); removed = []; remove_off_calendar_events(c, start_of_today()); assert.deepStrictEqual(removed, []); } finally { load_rows = saved[0]; site_delete_event = saved[1]; } });
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
t('cancellations recognised, also misspelt or in other words', () => { ['CANCELED', 'TNJC: cancelld', 'canclled', 'Cancled', 'Cancellled', 'cacelled', 'Cancellation', 'cancelation', 'Talk called off', 'No research talk', 'No JC this week', 'No seminar today', '[Cancelled]'].forEach(x => assert.ok(is_cancelled_title(x), x)); ['Cancer genomics', 'Cancellieri on RL', 'No-regret learning', 'Off-policy RL', 'Canal flows', 'Notes on tea'].forEach(x => assert.ok(!is_cancelled_title(x), x)); });
t('cancelled event seen for the first time: no change, no finding', () => { __props = {}; var c = ctx(false); c.baseline = false; c.no_event = []; var e = ev('No TNJC — CANCELLED'); c.cal = {getEventById: () => Object.assign(e, {getDescription: () => '', setDescription: function(){}})}; var out = sync_row(row({start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(out.finding, undefined); assert.strictEqual(e.title, 'No TNJC — CANCELLED'); assert.strictEqual(patched.length, 0); });
t('masked email', () => { assert.strictEqual(mask_email('ada.lovelace@ucl.ac.uk'), 'ad•••e@u•••.ac.uk'); assert.strictEqual(mask_email('ab@gmail.com'), 'a•••@g•••.com'); assert.strictEqual(mask_email('anna@x.org'), 'an•••@x•••.org'); });
// swap requests
Utilities.getUuid = () => '12345678-1234-1234-1234-123456789abc';
function swap_ctx(){ var c = ctx(false); c.settings.PAGE_URL = 'https://page'; c.cal = {getEventById: () => null}; return c; }
t('a swap goes through straight away, also weeks ahead; one email to both with an undo link', () => { __props = {}; var c = swap_ctx(); var msg = request_swap(row({start: soon}), 'presenter', 'b', 'a', c); assert.strictEqual(patched.length, 1); assert.ok(/^nikolai@x,lena@x \| Swap done/.test(mailed[0]), mailed[0]); assert.ok(/undo/.test(msg)); assert.strictEqual(swap_requests().length, 0); assert.strictEqual(swap_undos().length, 1); assert.deepStrictEqual([swap_undos()[0].from, swap_undos()[0].to], ['b', 'a']); });
t('a swap drops an old open request for the same duty', () => { __props = {}; save_swap_request({code: 'c1', row_id: 'r1', duty: 'presenter', from: 'b', to: 'e', created: Date.now(), start: soon.getTime(), type: 'TNJC', reminded: false}); var c = swap_ctx(); request_swap(row({start: soon}), 'presenter', 'b', 'a', c); assert.strictEqual(swap_requests().length, 0); });
t('swap email: undo link to the page, and how the turns count', () => { var saved = send_mail; var got = []; send_mail = function(to, subject, blocks){ got.push(blocks); }; try { __props = {}; var c = swap_ctx(); apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); var code = swap_undos()[0].code; var text = JSON.stringify(got[0]); assert.ok(text.indexOf('https://page?undo=' + code) >= 0, text); assert.ok(/Lena is not on this rota, so it counts as nobody's turn. Nikolai keeps their turn/.test(text), text); __props = {}; var p2 = Object.assign({}, people); p2.a = Object.assign({}, people.a, {tnjc: true}); c = swap_ctx(); c.people = p2; got = []; apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); assert.ok(/It counts as Lena's turn on the rota. Nikolai keeps their turn/.test(JSON.stringify(got[0]))); } finally { send_mail = saved; } });
t('undo: the slot goes back, both emailed, the link works once', () => { __props = {}; var c = swap_ctx(); apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); var code = swap_undos()[0].code; var saved = [to_row, notion_get_page]; notion_get_page = () => ({}); to_row = () => row({start: soon, presenter_ids: ['a']}); try { c = swap_ctx(); var info = swap_undo_info(code, c); assert.deepStrictEqual([info.from, info.to], ['Nikolai Petrov', 'Lena Weber']); var res = undo_swap(code, c); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'b'); assert.ok(/^nikolai@x,lena@x \| Swap undone/.test(mailed[0]), mailed[0]); assert.ok(/back with Nikolai Petrov/.test(res)); assert.strictEqual(swap_undos().length, 0); assert.throws(() => undo_swap(code, c), /already been undone/); } finally { to_row = saved[0]; notion_get_page = saved[1]; } });
t('undo refused once the slot changed or is over', () => { var saved = [to_row, notion_get_page]; notion_get_page = () => ({}); try { __props = {}; var c = swap_ctx(); apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); var code = swap_undos()[0].code; to_row = () => row({start: soon, presenter_ids: ['e']}); c = swap_ctx(); assert.throws(() => undo_swap(code, c), /changed since/); assert.strictEqual(patched.length, 0); assert.strictEqual(swap_undos().length, 0); __props = {}; apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); code = swap_undos()[0].code; to_row = () => row({start: new Date(Date.now() - 3600e3), presenter_ids: ['a']}); assert.throws(() => undo_swap(code, c), /already been undone, or its slot is over/); } finally { to_row = saved[0]; notion_get_page = saved[1]; } });
function take_ctx(me, p){ var c = swap_ctx(); c.people = p || people; c.me = c.people[me]; c.constants.notion_talk_db_id = 'db'; return c; }
t('take over: a colleagues slot is mine at once, both emailed with an undo link that gives it back', () => { var saved = send_mail; var got = []; send_mail = function(to, subject, blocks){ got.push(to + ' | ' + subject + ' | ' + JSON.stringify(blocks)); }; try { __props = {}; var c = take_ctx('a'); var res = take_over(row({start: soon}), 'presenter', 'b', c); assert.ok(/is yours now/.test(res), res); assert.ok(/^nikolai@x,lena@x \\| Swap done/.test(got[0]), got[0]); assert.ok(/Lena Weber has taken over this presenter from Nikolai Petrov on their tea page/.test(got[0]), got[0]); assert.ok(/Not agreed, or a mistake\\? Either of you can undo/.test(got[0]), got[0]); var u = swap_undos()[0]; assert.deepStrictEqual([u.from, u.to], ['b', 'a']); assert.ok(logged.some(l => /^taken over/.test(l)), logged); } finally { send_mail = saved; } });
t('take over refused when already on the slot, or for a tentative or cancelled slot', () => { __props = {}; var c = take_ctx('a'); assert.throws(() => take_over(row({start: soon, tea_ids: ['a']}), 'presenter', 'b', c), /already on this slot/); assert.throws(() => take_over(row({start: soon, title: '[TNJC Tentative]'}), 'presenter', 'b', c), /tentative/); assert.throws(() => take_over(row({start: soon, title: 'Cancelled'}), 'presenter', 'b', c), /cancelled/); assert.throws(() => take_over(row({start: soon}), 'presenter', 'e', c), /changed/); assert.strictEqual(patched.length, 0); });
t('slots to take over: confirmed, upcoming, duties I could do, not my own', () => { var saved = [notion_query, to_row]; var p2 = Object.assign({}, people); p2.a = Object.assign({}, people.a, {tnjc: true, csnjc: false, mljc: false}); var rows = [row({id: 'ok', start: soon}), row({id: 'mine', start: soon, presenter_ids: ['a']}), row({id: 'tent', start: soon, title: '[TNJC Tentative]'}), row({id: 'canc', start: soon, title: 'Cancelled'}), row({id: 'cs', start: soon, csnjc: true}), row({id: 'ml', type: 'MLJC', start: soon}), row({id: 'past', start: new Date(Date.now() - 3600e3)})]; notion_query = () => rows; to_row = (r) => r; try { var c = take_ctx('a', p2); var out = takeable_slots(c); assert.deepStrictEqual(out.map(x => x.row_id + ':' + x.duty + ':' + x.from), ['ok:presenter:b']); assert.strictEqual(out[0].from_name, 'Nikolai Petrov'); } finally { notion_query = saved[0]; to_row = saved[1]; } });
t('undo links of past slots lapse in the hourly run', () => { __props = {}; var saved = identity_rows; identity_rows = () => ({rows: []}); try { var c = swap_ctx(); apply_swap(row({start: soon}), 'presenter', 'b', 'a', c); __props['swapundo:old'] = JSON.stringify({code: 'old', start: Date.now() - 1000}); remind_swap_requests(c); assert.deepStrictEqual(swap_undos().length, 1); assert.ok(!__props['swapundo:old']); } finally { identity_rows = saved; } });
t('old requests: accepting applies the swap; declining tells the requester', () => { __props = {}; var c = swap_ctx(); var mk = () => save_swap_request({code: require_crypto.randomUUID().replace(/-/g, ''), row_id: 'r1', duty: 'presenter', from: 'b', to: 'a', created: Date.now(), start: soon.getTime(), type: 'TNJC', reminded: false}); mk(); var saved = [to_row, notion_get_page]; notion_get_page = () => ({}); to_row = () => row({start: soon}); try { var code = swap_requests()[0].code; c = swap_ctx(); var res = answer_swap(code, true, c); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'a'); assert.ok(/yours now/.test(res)); assert.strictEqual(swap_requests().length, 0); mk(); c = swap_ctx(); answer_swap(swap_requests()[0].code, false, c); assert.strictEqual(patched.length, 0); assert.ok(/^nikolai@x \| Lena Weber can't take over/.test(mailed[0])); assert.throws(() => answer_swap('12345678123412341234123456789abc', true, c), /already been answered/); } finally { to_row = saved[0]; notion_get_page = saved[1]; } });
t('no answer after a day: one reminder; past requests lapse', () => { __props = {}; var saved = identity_rows; identity_rows = () => ({rows: []}); try { save_swap_request({code: 'c1', row_id: 'r1', duty: 'presenter', from: 'b', to: 'a', created: Date.now() - 25 * 3600e3, start: soon.getTime(), type: 'TNJC', reminded: false}); save_swap_request({code: 'c2', row_id: 'r2', duty: 'presenter', from: 'b', to: 'a', created: Date.now() - 3 * 864e5, start: Date.now() - 3600e3, type: 'TNJC', reminded: false}); var c = swap_ctx(); remind_swap_requests(c); assert.strictEqual(mailed.length, 1); assert.ok(/^nikolai@x \| Lena Weber has not answered/.test(mailed[0])); assert.deepStrictEqual(swap_requests().map(x => x.code), ['c1']); remind_swap_requests(c); assert.strictEqual(mailed.length, 1); } finally { identity_rows = saved; } });
// cancelling
function cev(title){ var e = ev(title); e.desc = ''; e.getDescription = function(){ return this.desc; }; e.setDescription = function(x){ this.desc = x; }; return e; }
function cctx(e){ var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = {getEventById: () => e}; c.constants.gatsby_zoom_link = 'Z'; c.settings.links_in_events = false; return c; }
t('cancelled titles', () => { assert.strictEqual(cancelled_title(row({}), people), 'No TNJC — CANCELLED'); assert.strictEqual(cancelled_title(row({type: 'Tea Talk', tea_ids: ['a']}), people), 'TEA TALK: CANCELLED TEA: Lena Weber'); assert.ok(is_cancelled_title(cancelled_title(row({type: 'Research Talk'}), people))); });
t('strip links keeps text typed below the links', () => { assert.strictEqual(strip_links('Title: x\\nZoom Link: z\\n\\n🫖 Swap your slot: u\\n\\nSpeaker:\\nAda'), 'Title: x\\nZoom Link: z\\n\\nSpeaker:\\nAda'); assert.strictEqual(strip_links('Title: x<br><br>🫖 <a href="u">Swap</a><br><br>Speaker: Ada<br>'), 'Title: x<br><br>Speaker: Ada'); assert.strictEqual(strip_links('🫖 Swap: u\\n✏️ edit: v\\nhand'), 'hand'); });
t('links footer moves below text typed after it, then stays put', () => { var e = cev('x'); e.desc = 'Title: x\\n\\n🫖 old: u\\n\\nAbstract'; var c = cctx(e); c.settings.links_in_events = true; c.settings.PAGE_URL = 'https://page'; var r = row({start: soon}); ensure_links(e, r, c); assert.ok(/^Title: x\\n\\nAbstract\\n\\n🫖 /.test(e.desc), e.desc); var d = e.desc; assert.strictEqual(ensure_links(e, r, c), false); assert.strictEqual(e.desc, d); });
var cancelled_tt = () => row({type: 'Tea Talk', title: 'Cancelled', presenter_ids: [], tea_ids: ['a'], start: soon});
var hand_desc = 'Title: Cancelled\\nZoom Link: Z\\n\\n🫖 Swap your slot: u\\n\\nSpeaker:\\nRajesh Ranganath\\n\\nAbstract:\\nCausality.';
t('cancelled talk renamed back by hand: guest recorded, typed text kept, organiser told', () => { __props = {}; var r = cancelled_tt(); save_state('ev1', {t: 'TEA TALK: CANCELLED TEA: Lena Weber', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); var e = cev('TEA TALK: Rajesh Ranganath TEA: Lena Weber'); e.desc = hand_desc; var c = cctx(e); c.settings.live_types.push('Tea Talk'); var out = sync_row(r, c, start_of_today()); assert.strictEqual(out.finding, undefined); assert.deepStrictEqual(patched[0].Title.title, []); assert.strictEqual(patched[0]['Guest speaker'].rich_text[0].text.content, 'Rajesh Ranganath'); assert.strictEqual(patched[0].Description.rich_text[0].text.content, 'Speaker:\\nRajesh Ranganath\\n\\nAbstract:\\nCausality.'); assert.strictEqual(e.desc, 'Title: \\nZoom Link: Z\\nDescription: Speaker:\\nRajesh Ranganath\\n\\nAbstract:\\nCausality.'); assert.ok(/^tsar@x \| Tea Talk back on/.test(mailed[0]), mailed[0]); var st = JSON.parse(__props['state:ev1']); assert.strictEqual(st.t, 'TEA TALK: Rajesh Ranganath TEA: Lena Weber'); assert.strictEqual(st.x, notion_text_fingerprint(r)); patched = []; mailed = []; sync_row(r, c, start_of_today()); assert.strictEqual(patched.length, 0); assert.strictEqual(mailed.length, 0); assert.strictEqual(e.desc, 'Title: \\nZoom Link: Z\\nDescription: Speaker:\\nRajesh Ranganath\\n\\nAbstract:\\nCausality.'); });
t('cancelled talk renamed to a member: presenter back on, they are told', () => { __props = {}; var r = cancelled_tt(); save_state('ev1', {t: 'TEA TALK: CANCELLED TEA: Lena Weber', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); var e = cev('TEA TALK: Nikolai Petrov TEA: Lena Weber'); e.desc = 'Title: Cancelled\\nZoom Link: Z'; var c = cctx(e); c.settings.live_types.push('Tea Talk'); sync_row(r, c, start_of_today()); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'b'); assert.strictEqual(patched[0].Description, undefined); assert.ok(/^nikolai@x \| Tea Talk back on/.test(mailed[0]), mailed[0]); });
t('cancelled talk: calendar as the bot left it, or still cancelled -> nothing', () => { __props = {}; var r = cancelled_tt(); save_state('ev1', {t: 'TEA TALK: CANCELLED TEA: Lena Weber', n: notion_fingerprint(r), d: soon.getTime(), x: notion_text_fingerprint(r)}); [cev('TEA TALK: CANCELLED TEA: Lena Weber'), cev('No tea talk today'), cev('TEA TALK:  TEA: Lena Weber')].forEach(function(e){ var c = cctx(e); c.settings.live_types.push('Tea Talk'); var out = sync_row(cancelled_tt(), c, start_of_today()); assert.strictEqual(out.finding, undefined, e.title); assert.strictEqual(patched.length, 0, e.title); assert.strictEqual(mailed.length, 0, e.title); }); });
t('cancelled slot renamed back, no state or past: nothing', () => { __props = {}; var e = cev('TEA TALK: Nikolai Petrov TEA: Lena Weber'); var c = cctx(e); c.settings.live_types.push('Tea Talk'); sync_row(cancelled_tt(), c, start_of_today()); assert.strictEqual(patched.length, 0); save_state('ev1', {t: 'x', d: 0}); c = cctx(e); c.settings.live_types.push('Tea Talk'); sync_row(row({type: 'Tea Talk', title: 'Cancelled', presenter_ids: [], tea_ids: ['a'], start: new Date(Date.now() - 2 * 864e5)}), c, start_of_today()); assert.strictEqual(patched.length, 0); });
t('cancelled just tea renamed with an unclear name: tsar asked, stays cancelled', () => { __props = {}; people.h = {id: 'h', name: 'Tom Old', active: true}; try { var r = row({type: 'Just Tea', title: 'Cancelled', presenter_ids: [], tea_ids: [], start: soon}); save_state('ev1', {t: 'JUST TEA: CANCELLED', n: notion_fingerprint(r), d: soon.getTime()}); var c = cctx(cev('JUST TEA: Tim Old')); c.settings.live_types.push('Just Tea'); var out = sync_row(r, c, start_of_today()); assert.strictEqual(out.finding.kind, 'uncertain_match'); assert.strictEqual(out.finding.alert_tsar, true); assert.strictEqual(patched.length, 0); } finally { delete people.h; } });
t('cancelled talk renamed back while watching only: reported, not changed', () => { __props = {}; var r = cancelled_tt(); save_state('ev1', {t: 'TEA TALK: CANCELLED TEA: Lena Weber', n: notion_fingerprint(r), d: soon.getTime()}); var c = cctx(cev('TEA TALK: Nikolai Petrov TEA: Lena Weber')); var out = sync_row(r, c, start_of_today()); assert.strictEqual(out.finding.kind, 'reinstate_from_calendar'); assert.strictEqual(patched.length, 0); });
t('telemetry: rows are checked, cut and scrubbed', () => { var now = new Date(0); var rows = telemetry_rows({s: 'abc123', p: 'rotas', b: 'Safari 18', os: 'iOS', w: 'phone', v: '21', u: 'member', ev: [{k: 'call', n: 'api_site_bundle', ms: 5321.4, o: 'timeout', a: 2, d: 'x'}, {k: 'evil', n: 'x'}, {k: 'error', n: 'script', d: 'bad t=0123456789abcdef0123 ada@ucl.ac.uk https://x.io/p?t=secret'}]}, now); assert.strictEqual(rows.length, 2); assert.deepStrictEqual(rows[0].slice(1), ['abc123', 'rotas', 'call', 'api_site_bundle', 5321, 'timeout', 2, 'x', 'Safari 18', 'iOS', 'phone', '21', 'member']); assert.strictEqual(rows[1][8], 'bad t=<id> <email> https://x.io/p'); });
t('telemetry: junk is dropped', () => { assert.deepStrictEqual(telemetry_rows(null, new Date()), []); assert.deepStrictEqual(telemetry_rows({s: 'abc123', p: 'elsewhere', ev: [{k: 'view'}]}, new Date()), []); assert.deepStrictEqual(telemetry_rows({s: '<script>', p: 'tea', ev: [{k: 'view'}]}, new Date()), []); var many = telemetry_rows({s: 'abc123', p: 'tea', u: 'admin', ev: Array(100).fill({k: 'view', n: 'personal', o: 'weird', a: 50, ms: -3})}, new Date()); assert.strictEqual(many.length, 40); assert.deepStrictEqual(many[0].slice(5, 8), ['', '', '']); assert.strictEqual(many[0][13], ''); });
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
t('coffee event deleted: nothing reported, not cancelled', () => { __props = {}; var r = row({type: 'Coffee Cleaning', presenter_ids: [], tea_ids: ['a'], start: soon}); save_state('ev1', {t: 'x', n: notion_fingerprint(r), d: soon.getTime()}); var out = sync_row(r, cctx(null), start_of_today()); assert.strictEqual(out.finding, undefined); assert.strictEqual(patched.length, 0); });
// leaving the tea system
t('leave link: personal for one registered recipient, general otherwise', () => { var saved = identity_rows; identity_rows = () => ({rows: [{id: 'b', email: 'Nikolai@x', token: 'tok'}]}); identity_token_cache = null; try { var base = page_url(get_settings()); assert.strictEqual(leave_url('nikolai@x', {}, {}), base + '?t=tok&leave=1'); assert.strictEqual(leave_url('nikolai@x', {cc: 'org@x'}, {}), base + '?leave=1'); assert.strictEqual(leave_url('nikolai@x,lena@x', {}, {}), base + '?leave=1'); assert.strictEqual(leave_url('list@x', {}, {}), base + '?leave=1'); } finally { identity_rows = saved; identity_token_cache = null; } });
t('tea-page links: the general one carries the unit key, links with a personal code do not', () => { var s = {PAGE_URL: 'https://page', PAGE_KEY: 'unitkey1'}; assert.strictEqual(page_link(s), 'https://page?k=unitkey1'); assert.strictEqual(page_link(s, {leave: 1}), 'https://page?k=unitkey1&leave=1'); assert.strictEqual(personal_link('tok', s), 'https://page?t=tok'); assert.strictEqual(page_link(s, {t: 'tok', leave: 1}), 'https://page?t=tok&leave=1'); assert.strictEqual(page_link(s, {swap: 'c1'}), 'https://page?swap=c1'); assert.strictEqual(page_link(s, {undo: 'c1'}), 'https://page?undo=c1'); assert.strictEqual(page_link({PAGE_URL: 'https://page'}, {leave: 1}), 'https://page?leave=1'); });
t('general page: names without the unit key (registered and active only), but no leaving by name without it', () => {
  settings_cache = Object.assign({}, get_settings(), {PAGE_KEY: 'unitkey1'});
  var saved = [identity_rows, load_people, get_global_constants];
  try {
    get_global_constants = () => ({});
    load_people = () => ({a: {id: 'a', name: 'Zoé Martin', active: true}, b: {id: 'b', name: 'Lena Weber', active: true}, c: {id: 'c', name: 'Sam Old', active: false}, d: {id: 'd', name: 'No Address', active: true}});
    identity_rows = () => ({rows: [{id: 'a', email: 'z@x'}, {id: 'b', email: 'l@x'}, {id: 'c', email: 'o@x'}, {id: 'd', email: ''}]});
    assert.deepStrictEqual(api_link_people('').map(p => p.name), ['Lena Weber', 'Zoé Martin']);
    assert.throws(() => api_leave_by_name('wrongkey', '0123456789abcdef0123456789abcdef'), /calendar event/);
    assert.throws(() => api_leave_by_name('', '0123456789abcdef0123456789abcdef'), /calendar event/);
  } finally { identity_rows = saved[0]; load_people = saved[1]; get_global_constants = saved[2]; settings_cache = null; }
});
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
t('taken out by the tea tsar: like leaving, also when inactive already; nobody emailed unless slots are held', () => {
  var m = [], cleared = []; var saved = [identity_rows, upcoming_rows_of, send_mail];
  identity_rows = () => ({sheet: {getRange: (r, c, nr, nc) => ({setValues: v => cleared.push([r, c, nc, v])})}, rows: [{row: 7, id: 'd', email: 'old@x', token: 'tok'}]});
  send_mail = function(to, subj, blocks, k, o){ m.push({to: to, subj: subj, o: o || {}, text: JSON.stringify(blocks)}); };
  try {
    upcoming_rows_of = () => [];
    var c = ctx(false); c.me = people.d; c.me_identity = {email: 'old@x'};
    assert.deepStrictEqual(leave_tea_system(c, 'tsar', 'Jan Bauer'), []);
    assert.deepStrictEqual(patched[patched.length - 1], {Active: {checkbox: false}});
    assert.deepStrictEqual(cleared, [[7, 3, 2, [['', '']]]]);
    assert.strictEqual(m.length, 0, 'nobody emailed');
    upcoming_rows_of = () => [row({start: soon, url: 'https://notion/r1', presenter_ids: ['d']})];
    c = ctx(false); c.me = people.d; c.me_identity = {email: 'old@x'};
    assert.strictEqual(leave_tea_system(c, 'tsar', 'Jan Bauer').length, 1);
    assert.strictEqual(m.length, 1); assert.strictEqual(m[0].to, 'tsar@x'); assert.strictEqual(m[0].o.cc, 'org@x');
    assert.ok(/Jan Bauer took Sam Old out of the Gatsby tea system/.test(m[0].text) && /TNJC talk/.test(m[0].text), m[0].text);
  } finally { identity_rows = saved[0]; upcoming_rows_of = saved[1]; send_mail = saved[2]; }
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
function slot_ctx(existing_rows, coffee_rows){ made = []; notion_request = function(m, path, body){ made.push(body.properties); return {}; }; load_rows = function(type){ return type === 'Coffee Cleaning' ? (coffee_rows || []) : (existing_rows || []).filter(r => r.type === type); }; var c = ctx(false); c.constants.notion_talk_db_id = 'db'; c.settings.closed_days = []; return c; }
t('TNJC slots match the September run (9 Tuesdays, CSNJC on the last Tuesday)', () => { var c = slot_ctx(); var r = create_slots('TNJC', {from: '2026-11-01', to: '2026-12-31'}, c); assert.strictEqual(r.created.length, 9); var cs = made.filter(p => p.CSNJC.checkbox).map(p => p.Date.date.start.slice(0, 10)); assert.deepStrictEqual(cs, ['2026-11-24', '2026-12-29']); assert.strictEqual(made[0].Title.title[0].text.content, '[TNJC Tentative]'); assert.strictEqual(made[0].Date.date.end, '2026-11-03T14:30:00+00:00'); });
t('existing slots are not duplicated', () => { var c = slot_ctx([{type: 'TNJC', start: new Date('2026-11-10T13:30:00Z')}]); var r = create_slots('TNJC', {from: '2026-11-01', to: '2026-11-30'}, c); assert.strictEqual(r.created.length, 3); assert.deepStrictEqual(r.skipped, ['2026-11-10 TNJC']); });
t('talks: research Mondays, tea talks Tue + Thu', () => { var c = slot_ctx(); create_slots('talks', {research_from: '2026-12-01', research_to: '2026-12-14', tea_from: '2026-11-02', tea_to: '2026-11-08'}, c); var kinds = made.map(p => p.Type.select.name + ' ' + p.Date.date.start.slice(0, 16)); assert.deepStrictEqual(kinds, ['Tea Talk 2026-11-03T15:30', 'Tea Talk 2026-11-05T15:30', 'Research Talk 2026-12-07T15:00', 'Research Talk 2026-12-14T15:00']); assert.ok(made.every(p => p.Title.title[0].text.content === '[Tentative]')); });
t('MLJC on Mondays', () => { var c = slot_ctx(); create_slots('MLJC', {from: '2026-11-01', to: '2026-11-15'}, c); assert.deepStrictEqual(made.map(p => p.Date.date.start.slice(0, 10)), ['2026-11-02', '2026-11-09']); });
t('coffee: Mon-Fri weeks, water filter continues the 4-week cycle, texts copied', () => { var c = slot_ctx([], [{type: 'Coffee Cleaning', start: new Date(2026, 9, 19), water_filter: true, description: 'FILTER'}, {type: 'Coffee Cleaning', start: new Date(2026, 9, 26), water_filter: false, description: 'STD'}]); create_slots('Coffee Cleaning', {from: '2026-11-02', to: '2026-11-29'}, c); assert.deepStrictEqual(made.map(p => [p.Date.date.start, p.Date.date.end, p['Water filter (coffee only)'].checkbox, p.Description.rich_text[0].text.content]), [['2026-11-02', '2026-11-06', false, 'STD'], ['2026-11-09', '2026-11-13', false, 'STD'], ['2026-11-16', '2026-11-20', true, 'FILTER'], ['2026-11-23', '2026-11-27', false, 'STD']]); });
t('bank holidays are skipped when creating slots', () => { var c = slot_ctx(); UrlFetchApp_stub(() => ({getResponseCode: () => 200, getContentText: () => JSON.stringify({'england-and-wales': {events: [{date: '2026-11-09', title: 'Test Day'}]}})})); var r = create_slots('MLJC', {from: '2026-11-01', to: '2026-11-15'}, c); UrlFetchApp = null; assert.deepStrictEqual(made.map(p => p.Date.date.start.slice(0, 10)), ['2026-11-02']); assert.deepStrictEqual(r.holidays, ['2026-11-09 (Test Day)']); });
t('swap list: who usually does a duty', () => { var p = {active: true, name: 'X', tnjc: true, csnjc: false, mljc: false, coffee: false, position: 'PhD student', rt_excluded: true, tt_excluded: false, tea_excluded: false}; assert.ok(can_do_duty(p, row({}), 'presenter')); assert.ok(!can_do_duty(p, row({csnjc: true}), 'presenter')); assert.ok(!can_do_duty(p, row({type: 'Research Talk'}), 'presenter')); assert.ok(can_do_duty(p, row({type: 'Research Talk'}), 'tea')); assert.ok(!can_do_duty(Object.assign({}, p, {position: 'Included only for JCs / coffee'}), row({type: 'Tea Talk'}), 'presenter')); assert.ok(!can_do_duty(Object.assign({}, p, {active: false}), row({}), 'presenter')); });
// network blips
t('hourly sync emails only after 3 failures in a row', () => { var m = []; send_mail = function(to, subj){ m.push(subj); }; clear_failures('Calendar sync'); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 0); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 1); clear_failures('Calendar sync'); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 1); });
t('other jobs email on the first failure', () => { var m = []; send_mail = function(to, subj){ m.push(subj); }; notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'a'}); assert.strictEqual(m.length, 1); });
// error mails
t('errors go to the tea tsar (the TNJC organiser when there is none), greeted by title', () => { var m = []; send_mail = function(to, subj, b, c, o){ m.push([to, o && o.cc, o && o.as]); }; notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'lena@x', admin_email: 'tsar@x'}); notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'lena@x', admin_email: ''}); assert.deepStrictEqual(m, [['tsar@x', undefined, 'tsar'], ['lena@x', undefined, 'tsar']]); });
t('tsars are greeted by their title, so they see why an email came to them', () => {
  var k = {admin_email: 'tsar@x', tnjc_admin_email: 'mc@x', mljc_admin_email: 'b@x, c@x', coffee_admin_email: ''};
  assert.strictEqual(tsar_greeting('mc@x', '', 'TNJC', k), 'Hi TNJC Tsar,');
  assert.strictEqual(tsar_greeting('tsar@x', '', 'Research Talk', k), 'Hi Tea Tsar,');           // the talks are the tea tsar's
  assert.strictEqual(tsar_greeting('tsar@x', '', 'talks', k), 'Hi Tea Tsar,');
  assert.strictEqual(tsar_greeting('tsar@x', '', 'TNJC', k), 'Hi Tea Tsar,');                    // not the TNJC tsar: their own title
  assert.strictEqual(tsar_greeting('MC@x', '', 'TNJC', k), 'Hi TNJC Tsar,');
  assert.strictEqual(tsar_greeting('c@x', '', 'mljc_admin_email', k), 'Hi MLJC Tsar,');         // second address of a cell
  assert.strictEqual(tsar_greeting('tsar@x', 'mc@x, c@x', 'tsar', k), 'Hi Tea Tsar, TNJC Tsar and MLJC Tsar,');
  assert.strictEqual(tsar_greeting('b@x, c@x', 'b@x', 'MLJC', k), 'Hi MLJC Tsar,');              // one title once
  assert.strictEqual(tsar_greeting('lena@x,nikolai@x', 'mc@x', undefined, k), '');               // to people on duty: no greeting
  assert.strictEqual(tsar_greeting('tsar@x', '', undefined, k), '');                             // the tea tsar on duty, not as tsar
  assert.strictEqual(tsar_greeting('lena@x', '', 'TNJC', k), '');                                // no tsar among them
});
t('send_mail opens with the greeting for tsars, and leaves other emails as they were', () => {
  var sent = [], saved = [get_settings, leave_url];
  get_settings = () => ({PAGE_URL: 'https://page/'}); leave_url = () => '';
  MailApp = {sendEmail: m => sent.push(m)};
  var k = {admin_email: 'tsar@x', tnjc_admin_email: 'mc@x'};
  try {
    REAL.send_mail('mc@x', 'Time to schedule more TNJC slots', ['The TNJC schedule runs out.'], k, {as: 'TNJC'});
    REAL.send_mail('lena@x', 'Swap done', ['Done.'], k);
    REAL.send_mail('lena@x', 'Cancelled', ['Cancelled.'], k, {cc: 'mc@x'});
  } finally { get_settings = saved[0]; leave_url = saved[1]; }
  assert.ok(sent[0].body.startsWith('Hi TNJC Tsar,\\n\\nThe TNJC schedule runs out.'), sent[0].body);
  assert.ok(sent[0].htmlBody.indexOf('>Hi TNJC Tsar,</p>') > 0);
  assert.ok(sent[1].body.startsWith('Done.'), sent[1].body);
  assert.ok(sent[2].body.startsWith('Cancelled.'), sent[2].body);
});
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
t('talk titles: any member sets the title and description of any talk, not on tentative, cancelled or coffee slots, and cannot cancel by title', () => {
  var saved = [page_context, notion_get_page, notion_patch_page, log_row];
  var patched = null, logged = [];
  var slot = (type, title) => () => ({id: 's1', properties: {Type: {select: {name: type}}, Title: {title: title ? [{plain_text: title}] : []},
    Presenter: {relation: [{id: 'b'}]}, Date: {date: {start: '2026-11-16T13:30:00.000+00:00'}}}});
  try {
    page_context = () => ({me: {id: 'p1', name: 'Lena Weber'}, constants: {}, settings: {}, cal: {getEventById: () => null}});
    notion_patch_page = (id, props) => { patched = props; };
    log_row = (ctx, job, type, date, action, detail) => logged.push(action + ': ' + detail);
    notion_get_page = slot('MLJC', '');  // someone else's talk
    assert.ok(/^Saved/.test(api_title('tok', 's1', ' A map of feature learning ', 'Abstract: …')));
    assert.strictEqual(patched.Title.title[0].text.content, 'A map of feature learning');
    assert.deepStrictEqual(logged, ['title: Lena Weber: A map of feature learning']);
    patched = null;
    notion_get_page = slot('Coffee Cleaning', '');
    assert.throws(() => api_title('tok', 's1', 'x', ''), /no talk/);
    notion_get_page = slot('TNJC', '[TNJC Tentative]');
    assert.throws(() => api_title('tok', 's1', 'x', ''), /tentative/);
    notion_get_page = slot('Research Talk', 'Cancelled');
    assert.throws(() => api_title('tok', 's1', 'x', ''), /cancelled/);
    notion_get_page = slot('Research Talk', 'Old title');
    assert.throws(() => api_title('tok', 's1', 'Cancelled: ill', ''), /Nobody can take over/);
    assert.strictEqual(patched, null);
  } finally { page_context = saved[0]; notion_get_page = saved[1]; notion_patch_page = saved[2]; log_row = saved[3]; }
});
t('report an issue: the tea tsar by the name in the identity sheet, with the first address of their cell', () => {
  var saved = identity_rows;
  try {
    identity_rows = () => ({rows: [{id: 'a', name: 'Lena Weber', email: 'Lena@x'}, {id: 'b', name: 'Nikolai Petrov', email: 'nik@x'}]});
    assert.deepStrictEqual(tea_tsar_contact({admin_email: 'lena@x,other@x'}), {name: 'Lena Weber', email: 'lena@x'});
    assert.deepStrictEqual(tea_tsar_contact({admin_email: 'nobody@x'}), {name: '', email: 'nobody@x'});
    assert.strictEqual(tea_tsar_contact({admin_email: ''}), null);
  } finally { identity_rows = saved; }
});
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
    assert.deepStrictEqual([tea.royal, tnjc.royal, none.royal], ['tsar', 'TNJC', '']);
    assert.strictEqual(site_rights('', c).person, '');
  } finally { site_restore(); }
});
t('site: removing a slot deletes its calendar event after the row; invited guests get the cancellation; a paused bot keeps it', () => {
  site_stubs('tnjc@x');
  var saved = [get_settings, Calendar];
  var calls = [];
  try {
    notion_get_page = () => ({id: 'row1', properties: {'Type': {select: {name: 'TNJC'}}, 'Date': {date: {start: '2026-12-22T13:30:00.000+00:00'}},
      'GCal ID': {rich_text: [{plain_text: 'ev9@google.com'}]}}});
    notion_request = (m, p, body) => { calls.push('notion ' + m + ' ' + JSON.stringify(body)); return {}; };
    Calendar = {Events: {remove: (cal, id, opts) => { calls.push('remove ' + id + ' ' + opts.sendUpdates); }}};
    get_settings = () => ({dry_run: false});
    __props = {'state:ev9@google.com': '{}', 'invite:ev9': JSON.stringify({g: ['lena@x'], no: []})};
    assert.deepStrictEqual(api_site_delete_slot('tok', 'row1'), {calendar: 'deleted'});
    assert.deepStrictEqual(calls, ['notion patch {"archived":true}', 'remove ev9 all']);
    assert.deepStrictEqual(__props, {});
    calls = [];
    assert.deepStrictEqual(api_site_delete_slot('tok', 'row1'), {calendar: 'deleted'});
    assert.deepStrictEqual(calls, ['notion patch {"archived":true}', 'remove ev9 none']);
    Calendar.Events.remove = () => { throw new Error('Resource has been deleted'); };
    assert.deepStrictEqual(api_site_delete_slot('tok', 'row1'), {calendar: 'deleted'});
    get_settings = () => ({dry_run: true});
    calls = [];
    assert.deepStrictEqual(api_site_delete_slot('tok', 'row1'), {calendar: 'kept'});
    assert.deepStrictEqual(calls, ['notion patch {"archived":true}']);
    identity_for_token = () => ({id: 'p1', email: 'mljc@x'});
    assert.throws(() => api_site_delete_slot('tok', 'row1'), /Only the TNJC tsar/);
  } finally { site_restore(); get_settings = saved[0]; Calendar = saved[1]; __props = {}; }
});
t('site: every write drops the site copy of the data, reads keep it', () => {
  var saved = [store_request, CacheService];
  var removed = [];
  try {
    store_request = () => ({});
    CacheService = {getScriptCache: () => ({remove: (k) => removed.push(k)})};
    REAL.notion_request('post', 'databases/db/query', {}, {});
    REAL.notion_request('get', 'pages/x', null, {});
    assert.deepStrictEqual(removed, []);
    REAL.notion_request('patch', 'pages/x', {}, {});
    REAL.notion_request('post', 'pages', {}, {});
    assert.deepStrictEqual(removed, ['site:data', 'site:data']);
  } finally { store_request = saved[0]; CacheService = saved[1]; }
});
t('site: a rota tsar can only tick their own rota on people, and only edit their own slots', () => {
  site_stubs('tnjc@x');
  var patched = null;
  try {
    notion_patch_page = function(id, props){ patched = props; return {id: id, properties: {}}; };
    site_person = function(page){ return page; };
    api_site_save_person('tok', {id: 'b', name: 'X', rotas: ['TNJC', 'MLJC'], active: false, excluded: ['tea']});
    assert.deepStrictEqual(Object.keys(patched).sort(), ['CSNJC', 'TNJC']);
    assert.strictEqual(patched.TNJC.checkbox, true);
    assert.throws(() => api_site_save_person('tok', {name: 'New'}), /tea tsar and the unit admins/);
    assert.throws(() => api_site_save_slot('tok', {type: 'MLJC', start: '2026-11-02'}), /MLJC tsar/);
    notion_get_page = function(){ return {id: 's1', properties: {Type: {select: {name: 'MLJC'}}}}; };
    assert.throws(() => api_site_save_slot('tok', {id: 's1', type: 'TNJC', start: '2026-11-02'}), /MLJC tsar/);
  } finally { site_restore(); }
});
function tsar_cancel(how, tea){
  __props = {}; var e = cev('TEA TALK: Nikolai Petrov TEA: x'); var c = cctx(e); var m = []; var saved = send_mail;
  send_mail = function(to, subj, blocks, k, o){ m.push({to: to, subj: subj, text: JSON.stringify(blocks), o: o || {}}); };
  try {
    var told = cancel_slot(row({type: 'Tea Talk', tea_ids: tea || ['a', 'c'], start: soon}), c, Object.assign({source: 'site', by: 'The Tea Tsar', reason: 'Nikolai cannot make it'}, how));
    return {told: JSON.parse(JSON.stringify(told)), m: m, e: e, patch: patched[0], logged: logged};
  } finally { send_mail = saved; }
}
t('tsar cancels the talk, tea stays (just tea): named by title, reason given, tea said to go ahead; who was emailed comes back', () => {
  var r = tsar_cancel({});
  assert.deepStrictEqual(r.told, {emailed: ['Nikolai Petrov', 'Lena Weber'], no_address: ['Zoé Martin']});
  assert.strictEqual(r.m.length, 1); assert.strictEqual(r.m[0].to, 'nikolai@x,lena@x'); assert.strictEqual(r.m[0].o.cc, 'tsar@x');
  assert.ok(/^Cancelled: Tea Talk on .* \\(just tea now\\)$/.test(r.m[0].subj), r.m[0].subj);
  assert.ok(r.m[0].text.includes('The Tea Tsar has cancelled the talk. Tea still goes ahead: it is just tea this time.') && r.m[0].text.includes('Nikolai cannot make it') && r.m[0].text.includes('(still on)'), r.m[0].text);
  assert.deepStrictEqual([r.patch.Presenter.relation, r.patch.Tea], [[], undefined]);
  assert.strictEqual(r.e.title, 'TEA TALK: CANCELLED TEA: Lena Weber, Zoé Martin');
  assert.ok(r.logged.some(l => l.indexOf('cancelled: The Tea Tsar: Nikolai cannot make it (was: Nikolai Petrov); emailed Nikolai Petrov, Lena Weber') === 0), r.logged.join('; '));
});
t('tsar cancels talk and tea: both come off (keeping their turn), calendar without tea, the email says so', () => {
  var r = tsar_cancel({keep_tea: false}, ['a']);
  assert.deepStrictEqual([r.patch.Presenter.relation, r.patch.Tea.relation], [[], []]);
  assert.strictEqual(r.e.title, 'TEA TALK: CANCELLED');
  assert.ok(/^Cancelled: Tea Talk and tea on [^(]*$/.test(r.m[0].subj), r.m[0].subj);
  assert.ok(r.m[0].text.includes('has cancelled the talk and the tea.') && r.m[0].text.includes('(cancelled too)') && r.m[0].text.includes('The presenter and the tea person are no longer recorded'), r.m[0].text);
  assert.ok(!r.m[0].text.includes('still goes ahead'));
  assert.strictEqual(r.m[0].to, 'nikolai@x,lena@x');
  assert.ok(r.logged.some(l => l.indexOf('cancelled talk and tea: ') === 0), r.logged.join('; '));
});
t('tsar chooses who is emailed: only them; nobody: the organiser alone, or no email when the organiser cancelled it', () => {
  var r = tsar_cancel({email: ['b']});
  assert.deepStrictEqual(r.told, {emailed: ['Nikolai Petrov'], no_address: []});
  assert.deepStrictEqual([r.m.length, r.m[0].to, r.m[0].o.cc], [1, 'nikolai@x', 'tsar@x']);
  r = tsar_cancel({email: []});
  assert.deepStrictEqual(r.told, {emailed: [], no_address: []});
  assert.deepStrictEqual([r.m.length, r.m[0].to], [1, 'tsar@x']);
  assert.ok(r.logged.some(l => /nobody on the slot emailed$/.test(l)), r.logged.join('; '));
  r = tsar_cancel({email: [], by_organiser: true});
  assert.strictEqual(r.m.length, 0);
});
t('site: a tsar cancels an upcoming talk of their rota with a reason; tentative, cancelled, past, coffee and paused slots are refused', () => {
  site_stubs('tsar@x');
  var saved = [make_context, get_settings, cancel_slot], calls = [];
  var start = new Date(Date.now() + 3 * 864e5).toISOString();
  var page = (o) => () => ({id: 's1', url: 'u', properties: Object.assign({Type: {select: {name: 'Tea Talk'}}, Title: {title: []}, Presenter: {relation: [{id: 'b'}]},
    Tea: {relation: [{id: 'a'}]}, Date: {date: {start: start}}, 'GCal ID': {rich_text: [{plain_text: 'ev1'}]}}, o)});
  try {
    var live = ['Tea Talk', 'TNJC'];
    get_settings = () => ({dry_run: false, live_types: live});
    make_context = (k, s) => ({constants: k, settings: s, people: people});
    cancel_slot = (r, c, how) => { calls.push([r.id, r.type, how.source, how.by, how.reason, how.keep_tea, how.email, how.by_organiser]); return {emailed: ['Nikolai Petrov'], no_address: []}; };
    notion_get_page = page({});
    var done = api_site_cancel_slot('tok', 's1', '  Alex cannot make it, just tea  ');
    assert.deepStrictEqual(calls, [['s1', 'Tea Talk', 'site', 'The Tea Tsar', 'Alex cannot make it, just tea', true, null, true]]);
    calls = [];
    api_site_cancel_slot('tok', 's1', 'a good reason', {keep_tea: false, email: ['a']});
    assert.deepStrictEqual(calls[0].slice(5), [false, ['a'], true]);
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason', {email: ['e']}), /Sam Old is not on this slot/);
    assert.strictEqual(done.slot.id, 's1'); assert.deepStrictEqual(done.emailed, ['Nikolai Petrov']);
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'ill'), /short reason/);
    notion_get_page = page({Title: {title: [{plain_text: '[Tea Talk Tentative]'}]}});
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason'), /tentative/);
    notion_get_page = page({Title: {title: [{plain_text: 'Cancelled'}]}});
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason'), /already cancelled/);
    notion_get_page = page({Date: {date: {start: '2026-01-05T15:30:00.000+00:00'}}});
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason'), /upcoming/);
    notion_get_page = page({Type: {select: {name: 'Coffee Cleaning'}}});
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason'), /Only talks and just teas/);
    notion_get_page = page({});
    live = ['TNJC'];
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason'), /paused/);
    identity_for_token = () => ({id: 'p1', email: 'tnjc@x'});
    assert.throws(() => api_site_cancel_slot('tok', 's1', 'a good reason'), /Only the Tea Talk tsar/);
    notion_get_page = page({Type: {select: {name: 'TNJC'}}});
    live = ['TNJC'];
    calls = [];
    api_site_cancel_slot('tok', 's1', 'room closed for works');
    assert.strictEqual(calls[0][3], 'The TNJC Tsar');
    assert.strictEqual(calls[0][7], true, 'the TNJC tsar organises TNJC');
    assert.strictEqual(calls.length, 1);
  } finally { site_restore(); make_context = saved[0]; get_settings = saved[1]; cancel_slot = saved[2]; }
});
t('site: a "Cancelled" title on a slot with people on it is refused (it would tell nobody); empty, new and paused slots may have one', () => {
  site_stubs('tsar@x');
  var saved = [get_settings], start = new Date(Date.now() + 3 * 864e5).toISOString(), patched = 0;
  var page = (o) => () => ({id: 's1', url: 'u', properties: Object.assign({Type: {select: {name: 'Tea Talk'}}, Title: {title: []}, Presenter: {relation: [{id: 'b'}]},
    Tea: {relation: []}, Date: {date: {start: start}}}, o)});
  try {
    var dry = false;
    get_settings = () => ({dry_run: dry, live_types: ['Tea Talk']});
    notion_patch_page = (id, props) => { patched++; return {id: id, properties: {}}; };
    notion_request = () => { patched++; return {id: 'n', properties: {}}; };
    var slot = {id: 's1', type: 'Tea Talk', title: 'Cancelled: ill', start: '2026-12-01', presenter: ['b'], tea: []};
    notion_get_page = page({});
    assert.throws(() => api_site_save_slot('tok', slot), /Cancel talk/);
    assert.strictEqual(patched, 0);
    api_site_save_slot('tok', Object.assign({}, slot, {title: 'A new title'}));
    notion_get_page = page({Presenter: {relation: []}});
    api_site_save_slot('tok', Object.assign({}, slot, {presenter: []}));
    api_site_save_slot('tok', Object.assign({}, slot, {id: undefined, presenter: []}));
    notion_get_page = page({});
    dry = true;
    api_site_save_slot('tok', slot);
    assert.strictEqual(patched, 4);
  } finally { site_restore(); get_settings = saved[0]; }
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
// the rota data sheet (Store.js)
function FakeSheet(name){ this.name = name; this.cells = []; }
FakeSheet.prototype.getLastRow = function(){ return this.cells.length; };
FakeSheet.prototype.getLastColumn = function(){ return this.cells.reduce((m, r) => Math.max(m, r.length), 0); };
FakeSheet.prototype.getRange = function(r, c, nr, nc){
  var sh = this; nr = nr || 1; nc = nc || 1;
  var range = {
    getValue: () => range.getValues()[0][0],
    getValues: () => { var out = []; for (var i = 0; i < nr; i++){ var row = []; for (var j = 0; j < nc; j++) row.push(((sh.cells[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); } return out; },
    setValues: (v) => { v.forEach((row, i) => { var t = sh.cells[r - 1 + i] = sh.cells[r - 1 + i] || []; row.forEach((x, j) => { t[c - 1 + j] = String(x); }); }); return range; },
    setValue: (x) => range.setValues([[x]]),
    setNumberFormat: () => range,
    setFontColor: (c) => { sh.heading_colour = c; return range; },
    setFontWeight: () => range,
    setNote: (n) => { sh.note = n; return range; }
  };
  return range;
};
FakeSheet.prototype.clear = function(){ this.cells = []; };
FakeSheet.prototype.clearContents = function(){ this.cells = []; };
FakeSheet.prototype.setFrozenRows = function(){};
FakeSheet.prototype.setTabColor = function(c){ this.tab_colour = c; };
FakeSheet.prototype.getProtections = function(){ return this.protection ? [this.protection] : []; };
FakeSheet.prototype.protect = function(){ var p = this.protection = {}; p.setWarningOnly = (w) => { p.warning_only = w; return p; }; p.setDescription = (d) => { p.description = d; return p; }; return p; };
function FakeBook(){ this.tabs = [new FakeSheet('Sheet1')]; }
FakeBook.prototype.getSheetByName = function(n){ return this.tabs.filter(t => t.name === n)[0] || null; };
FakeBook.prototype.insertSheet = function(n){ var t = new FakeSheet(n); this.tabs.push(t); return t; };
FakeBook.prototype.getSheets = function(){ return this.tabs; };
FakeBook.prototype.deleteSheet = function(t){ this.tabs = this.tabs.filter(x => x !== t); };
FakeBook.prototype.getId = function(){ return 'book'; };

var STORE_DBS = {notion_talk_db_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', notion_people_db_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', notion_rota_rules_db_id: 'cccccccccccccccccccccccccccccccc'};
function rt(t){ return [{type: 'text', text: {content: t}, plain_text: t}]; }
function slot_page(id, start, type, presenter, title){
  return {object: 'page', id: id, parent: {type: 'database_id', database_id: STORE_DBS.notion_talk_db_id}, created_time: '2026-01-01T00:00:00.000Z', last_edited_time: '2026-01-01T00:00:00.000Z', icon: null,
          properties: {Title: {type: 'title', title: rt(title || '')}, Date: {type: 'date', date: {start: start, end: null}}, Type: {type: 'select', select: {name: type}},
                       Presenter: {type: 'relation', relation: presenter.map(x => ({id: x}))}, Tea: {type: 'relation', relation: []}, CSNJC: {type: 'checkbox', checkbox: false},
                       'Presenter Text': {type: 'formula', formula: {string: 'x'}}}};
}
var STORE_NOTION = {
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {schema: {Title: {id: 'title', type: 'title'}, Date: {id: 'd', type: 'date'}, Type: {id: 't', type: 'select', select: {options: [{name: 'TNJC'}, {name: 'MLJC'}]}},
                                              Presenter: {id: 'p', type: 'relation'}, Tea: {id: 'e', type: 'relation'}, CSNJC: {id: 'c', type: 'checkbox'}, 'Presenter Text': {id: 'f', type: 'formula'}},
                                     pages: [slot_page('11111111111111111111111111111111', '2026-11-10T13:30:00.000+00:00', 'TNJC', ['dddddddddddddddddddddddddddddddd']),
                                             slot_page('22222222222222222222222222222222', '2026-11-17T13:30:00.000+00:00', 'TNJC', ['eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'], 'Spikes'),
                                             slot_page('33333333333333333333333333333333', '2026-06-01T23:30:00.000+00:00', 'MLJC', [])]},
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: {schema: {Name: {id: 'title', type: 'title'}, Active: {id: 'a', type: 'checkbox'}}, pages: []},
  cccccccccccccccccccccccccccccccc: {schema: {Type: {id: 'title', type: 'title'}}, pages: []}
};
var store_saved = {};
// the rota data sheet as the move left it: every Notion row copied, formulas left behind (what the one-off import did)
function store_fill(book){
  var schema = {};
  Object.keys(STORE_TABS).forEach(function(k){
    var name = STORE_TABS[k], db = STORE_DBS[k], props = {};
    Object.keys(STORE_NOTION[db].schema).forEach(function(n){
      var def = STORE_NOTION[db].schema[n];
      if (STORE_TYPES.indexOf(def.type) < 0) return;
      props[n] = {id: def.id, type: def.type};
      if (def.type === 'select') props[n].options = def.select.options.map(o => o.name);
    });
    schema[name] = {db: db, properties: props};
    var header = STORE_META.slice();
    Object.keys(props).forEach(n => { header.push(n); if (props[n].type === 'date') header.push(n + ' end'); });
    var tab = {name: name, header: header, col: {}};
    header.forEach((h, i) => { tab.col[h] = i; });
    book.insertSheet(name).cells = [header].concat(STORE_NOTION[db].pages.map(function(pg){
      var row = header.map(() => '');
      row[0] = normalise_id(pg.id); row[tab.col['created']] = pg.created_time; row[tab.col['edited']] = pg.last_edited_time;
      return store_cells(tab, pg.properties, row, {schema: schema});
    }));
  });
  book.insertSheet('Schema');
  store_save_schema({ss: book, schema: schema});
}
function store_stubs(){
  store_saved = {gc: get_global_constants, gs: get_settings, ss: SpreadsheetApp,
                 nr: notion_request, np: notion_patch_page, gp: notion_get_page, nq: notion_query, tr: to_row};
  notion_request = REAL.notion_request; notion_patch_page = REAL.notion_patch_page; notion_get_page = REAL.notion_get_page; notion_query = REAL.notion_query; to_row = REAL.to_row;
  var book = new FakeBook(), calls = [];
  store_fill(book);
  SpreadsheetApp = {openById: (id) => book, ProtectionType: {SHEET: 'SHEET'}};
  __props.STORE_SHEET_ID = 'book';
  get_global_constants = () => Object.assign({}, STORE_DBS);
  get_settings = () => ({PAGE_URL: 'https://gatsbyunit.github.io/gatsby-teabot/'});
  store_cache = null;
  return {book: book, calls: calls};
}
function store_restore(){
  get_global_constants = store_saved.gc; get_settings = store_saved.gs;
  SpreadsheetApp = store_saved.ss; store_cache = null; delete __props.STORE_SHEET_ID;
  notion_request = store_saved.nr; notion_patch_page = store_saved.np; notion_get_page = store_saved.gp; notion_query = store_saved.nq; to_row = store_saved.tr;
}
t('store: the bot\\'s sheets warn against hand edits, once', () => {
  var sh = new FakeSheet('Schedule'), saved = SpreadsheetApp;
  sh.cells = [['id', 'Title']];
  SpreadsheetApp = {ProtectionType: {SHEET: 'SHEET'}};
  try { guard_sheet(sh); } finally { SpreadsheetApp = saved; }
  assert.strictEqual(sh.tab_colour, '#cc0000');
  assert.ok(/DO NOT EDIT BY HAND/.test(sh.note));
  assert.strictEqual(sh.protection.warning_only, true);
  var before = sh.protection;
  SpreadsheetApp = {ProtectionType: {SHEET: 'SHEET'}};
  try { guard_sheet(sh); } finally { SpreadsheetApp = saved; }
  assert.strictEqual(sh.protection, before);
});
t('store: queries answered from the sheet, in Notion\\'s format (filters, sorts, paging); Notion never asked', () => {
  var st = store_stubs();
  try {
    var c = get_global_constants();
    var ids = (f, sorts) => notion_query(STORE_DBS.notion_talk_db_id, f, sorts, c).map(p => normalise_id(p.id).slice(0, 1));
    assert.deepStrictEqual(ids({property: 'Date', date: {on_or_after: '2026-11-17'}}), ['2']);
    assert.deepStrictEqual(ids({property: 'Date', date: {equals: '2026-06-02'}}), ['3']);  // 23:30 UTC is the next day in London
    assert.deepStrictEqual(ids({and: [{property: 'Type', select: {equals: 'TNJC'}}, {or: [{property: 'Presenter', relation: {contains: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'}}, {property: 'Title', title: {equals: 'nothing'}}]}]}), ['2']);
    assert.deepStrictEqual(ids(null, [{property: 'Date', direction: 'descending'}]), ['2', '1', '3']);
    var last = notion_request('post', 'databases/' + STORE_DBS.notion_talk_db_id + '/query', {filter: {property: 'Type', select: {equals: 'TNJC'}}, sorts: [{property: 'Date', direction: 'descending'}], page_size: 1}, c);
    assert.strictEqual(last.results.length, 1); assert.strictEqual(last.has_more, true);
    var row = to_row(notion_get_page('22222222222222222222222222222222', c));
    assert.deepStrictEqual([row.title, row.type, row.presenter_ids[0], row.start.toISOString()], ['Spikes', 'TNJC', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '2026-11-17T13:30:00.000Z']);
    assert.deepStrictEqual(st.calls, []);
  } finally { store_restore(); }
});
t('store: changes go into the sheet only; archived rows drop out', () => {
  var st = store_stubs();
  try {
    var c = get_global_constants();
    notion_patch_page('11111111-1111-1111-1111-111111111111', {Title: {title: [{text: {content: 'New title'}}]}, Tea: {relation: [{id: 'ffffffff-ffff-ffff-ffff-ffffffffffff'}]}}, c);
    var made = notion_request('post', 'pages', {parent: {database_id: STORE_DBS.notion_talk_db_id}, properties: {Type: {select: {name: 'MLJC'}}, Date: {date: {start: '2026-12-01'}}}}, c);
    notion_request('patch', 'pages/22222222222222222222222222222222', {archived: true}, c);
    assert.deepStrictEqual(st.calls, []);
    store_cache = null;  // as the next run sees it
    var rows = notion_query(STORE_DBS.notion_talk_db_id, null, [{property: 'Date', direction: 'ascending'}], c).map(to_row);
    assert.deepStrictEqual(rows.map(r => r.id.slice(0, 1)), ['3', '1', normalise_id(made.id).slice(0, 1)]);
    assert.ok(/^[0-9a-f]{32}$/.test(normalise_id(made.id)));
    assert.strictEqual(rows[1].title, 'New title');
    assert.deepStrictEqual(rows[1].tea_ids, ['ffffffffffffffffffffffffffffffff']);
  } finally { store_restore(); }
});
t('store: a change writes only its own cells; a new row goes after rows another run added meanwhile', () => {
  var st = store_stubs();
  try {
    var c = get_global_constants();
    notion_get_page('11111111111111111111111111111111', c);  // this run has read the tab
    var cells = st.book.getSheetByName('Schedule').cells;
    cells[1][8] = 'MLJC';  // another run changes the type meanwhile
    cells.push(cells[3].slice()); cells[4][0] = '55555555555555555555555555555555'; cells[4][5] = 'Added elsewhere';
    notion_patch_page('11111111111111111111111111111111', {Title: {title: rt('Mine')}}, c);
    assert.deepStrictEqual([cells[1][5], cells[1][8]], ['Mine', 'MLJC']);
    var made = notion_request('post', 'pages', {parent: {database_id: STORE_DBS.notion_talk_db_id}, properties: {Title: {title: rt('New')}, Date: {date: {start: '2026-12-01'}}}}, c);
    assert.strictEqual(cells.length, 6);
    assert.deepStrictEqual([cells[4][5], cells[5][5]], ['Added elsewhere', 'New']);
    assert.strictEqual(normalise_id(made.id), cells[5][0]);
    assert.strictEqual(notion_get_page('55555555555555555555555555555555', c).properties.Title.title[0].plain_text, 'Added elsewhere');
  } finally { store_restore(); }
});
t('store: rows link to the slot or person on the site, and the ids come back out of those addresses', () => {
  var st = store_stubs();
  try {
    var c = get_global_constants();
    var slot = notion_get_page('11111111111111111111111111111111', c);
    assert.strictEqual(slot.url, 'https://gatsbyunit.github.io/gatsby-teabot/rotas/?slot=11111111111111111111111111111111');
    assert.strictEqual(to_row(slot).url, slot.url);
    var person = notion_request('post', 'pages', {parent: {database_id: STORE_DBS.notion_people_db_id}, properties: {Name: {title: rt('Lena Weber')}, Active: {checkbox: true}}}, c);
    assert.strictEqual(person.url, 'https://gatsbyunit.github.io/gatsby-teabot/rotas/?person=' + normalise_id(person.id));
    assert.strictEqual(id_from_notion_url(person.url), normalise_id(person.id));
    assert.strictEqual(id_from_notion_url('https://gatsbyunit.github.io/gatsby-teabot/rotas/?slot=11111111111111111111111111111111&mode=dark'), '11111111111111111111111111111111');
    assert.strictEqual(id_from_notion_url('https://www.notion.so/Lena-Weber-0123456789abcdef0123456789abcdef?pvs=4'), '0123456789abcdef0123456789abcdef');
    assert.strictEqual(id_from_notion_url('https://www.notion.so/0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef');
    assert.strictEqual(id_from_notion_url('https://gatsbyunit.github.io/gatsby-teabot/rotas/'), '');
  } finally { store_restore(); }
});
t('store: the Cron Jobs get Notion-like answers from the sheet, and their changes land there', () => {
  var st = store_stubs();
  var saved = CacheService, removed = [];
  CacheService = {getScriptCache: () => ({remove: (k) => removed.push(k)})};
  try {
    var res = store_fetch('https://api.notion.com/v1/databases/' + STORE_DBS.notion_talk_db_id + '/query', {method: 'post', headers: {Authorization: 'Bearer x'}, payload: JSON.stringify({filter: {property: 'Date', date: {on_or_before: '2026-11-10'}}})});
    assert.strictEqual(res.getResponseCode(), 200);
    var body = JSON.parse(res.getContentText());
    assert.deepStrictEqual(body.results.map(p => p.properties.Type.select.name).sort(), ['MLJC', 'TNJC']);
    assert.strictEqual(body.results[0].properties.Title.title.length >= 0, true);
    var patched = store_fetch('https://api.notion.com/v1/pages/22222222-2222-2222-2222-222222222222', {method: 'patch', payload: JSON.stringify({properties: {CSNJC: {checkbox: true}}})});
    assert.strictEqual(patched.getResponseCode(), 200);
    assert.deepStrictEqual(removed, ['site:data']);
    store_cache = null;
    assert.strictEqual(notion_get_page('22222222222222222222222222222222', get_global_constants()).properties.CSNJC.checkbox, true);
    assert.strictEqual(store_fetch('https://api.notion.com/v1/pages/99999999999999999999999999999999', {method: 'get'}).getResponseCode(), 500);
    assert.deepStrictEqual(st.calls, []);
  } finally { CacheService = saved; store_restore(); }
});
t('store: the old Notion token leaves the constants sheet, once', () => {
  var saved = const_book, book = new FakeBook(), first = book.tabs[0];
  first.cells = Array.from({length: 28}, (_, i) => ['row ' + (i + 1), 'v' + (i + 1)]);
  const_book = () => book;
  try {
    assert.strictEqual(forget_notion_token(), true);
    assert.deepStrictEqual(first.cells[20], ['(Notion token, removed 2026-11-11)', '']);
    assert.deepStrictEqual(first.cells[21], ['row 22', 'v22']);
    assert.strictEqual(forget_notion_token(), false);
  } finally { const_book = saved; }
});
// the bot's Drive, as far as the photos use it
function FakeFolder(name){ this.name = name; this.files = []; this.folders = []; }
FakeFolder.prototype.getFiles = function(){ var l = this.files.slice(), i = 0; return {hasNext: () => i < l.length, next: () => l[i++]}; };
FakeFolder.prototype.getFoldersByName = function(n){ var l = this.folders.filter(f => f.name === n), i = 0; return {hasNext: () => i < l.length, next: () => l[i++]}; };
FakeFolder.prototype.createFolder = function(n){ var f = new FakeFolder(n); this.folders.push(f); return f; };
FakeFolder.prototype.getId = function(){ return 'folder-' + this.name; };
FakeFolder.prototype.getUrl = function(){ return 'https://drive/' + this.name; };
FakeFolder.prototype.createFile = function(blob){
  var f = {name: blob.name, type: blob.type, bytes: blob.bytes, trashed: false, at: new Date()};
  var file = {getName: () => f.name, isTrashed: () => f.trashed, setTrashed: (v) => { f.trashed = v; }, getLastUpdated: () => f.at,
              getBlob: () => ({getContentType: () => f.type, getBytes: () => f.bytes}), f: f};
  this.files.push(file);
  return file;
};
function live(folder){ return folder.files.filter(x => !x.f.trashed).map(x => x.f.name).sort(); }
function drive_stubs(){
  var root = new FakeFolder('root');
  var saved = {drive: typeof DriveApp === 'undefined' ? undefined : DriveApp, nb: Utilities.newBlob, dec: Utilities.base64Decode, enc: Utilities.base64Encode, lock: LockService, cache: CacheService};
  DriveApp = {getRootFolder: () => root, getFolderById: (id) => { throw new Error('gone'); }};
  Utilities.newBlob = (bytes, type, name) => ({bytes: bytes, type: type, name: name, setName: function(n){ this.name = n; return this; }, getContentType: function(){ return this.type; }});
  Utilities.base64Decode = (s) => Array.from(Buffer.from(s, 'base64'));
  Utilities.base64Encode = (b) => Buffer.from(b).toString('base64');
  LockService = {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})};
  CacheService = {getScriptCache: () => ({get: () => null, put: () => {}, putAll: () => {}, getAll: () => ({}), remove: () => {}})};
  return {root: root, restore: () => { DriveApp = saved.drive; Utilities.newBlob = saved.nb; Utilities.base64Decode = saved.dec; Utilities.base64Encode = saved.enc; LockService = saved.lock; CacheService = saved.cache; delete __props.SITE_PHOTOS_FOLDER_ID; }};
}
t('site: photos are files in the bot\\'s Drive (full size and a small copy); people change their own, tsars anyone\\'s', () => {
  assert.ok(site_photo_ok('data:image/jpeg;base64,/9j/4AAQ=='));
  assert.ok(!site_photo_ok('data:image/svg+xml;base64,PHN2Zz4='));
  assert.ok(!site_photo_ok('https://example.org/x.jpg'));
  site_stubs('someone@x');
  var d = drive_stubs();
  try {
    identity_for_token = () => ({id: 'p1', email: 'someone@x'});
    api_site_save_photo('tok', 'p1', 'data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,QUFBQUFB');
    var folder = d.root.folders[0], small = folder.folders[0];
    assert.strictEqual(folder.name, 'Gatsby Rotas photos');
    assert.deepStrictEqual([live(folder), live(small)], [['Lena Weber (p1).jpg'], ['p1.jpg']]);
    assert.deepStrictEqual(small.files[0].f.bytes, Array.from(Buffer.from('AAAA', 'base64')));
    assert.deepStrictEqual(folder.files[0].f.bytes, Array.from(Buffer.from('QUFBQUFB', 'base64')));
    api_site_save_photo('tok', 'p1', 'data:image/jpeg;base64,BBBB');  // no full size: the small one stands in
    assert.deepStrictEqual([live(folder), live(small)], [['Lena Weber (p1).jpg'], ['p1.jpg']]);
    assert.strictEqual(folder.files.length, 2);  // the first full-size photo is in the bin
    api_site_save_photo('tok', 'p1', '');
    assert.deepStrictEqual([live(folder), live(small)], [[], []]);
    assert.throws(() => api_site_save_photo('tok', 'b', 'data:image/jpeg;base64,AAAA'), /tsars/);
    identity_for_token = () => ({id: 'p1', email: 'tnjc@x'});
    api_site_save_photo('tok', 'b', 'data:image/jpeg;base64,BBBB');
    assert.deepStrictEqual(live(small), ['b.jpg']);
  } finally { d.restore(); site_restore(); }
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

// ---- site access (Access.js): readers and unit admins; the debug view ----
function fake_sheet(rows){
  var sh = {rows: rows};
  sh.getLastRow = () => sh.rows.length;
  sh.getRange = (r, c, nr, nc) => {
    var range = {
      getValues: () => sh.rows.slice(r - 1, r - 1 + (nr || 1)).map(row => { var o = []; for (var i = 0; i < (nc || 1); i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; }),
      setValues: (v) => { v.forEach((row, i) => { var at = r - 1 + i; while (sh.rows.length <= at) sh.rows.push([]); row.forEach((x, j) => { sh.rows[at][c - 1 + j] = x; }); }); return range; },
      setValue: (x) => { while (sh.rows.length < r) sh.rows.push([]); sh.rows[r - 1][c - 1] = x; return range; },
      setNumberFormat: () => range
    };
    return range;
  };
  sh.deleteRow = (r) => { sh.rows.splice(r - 1, 1); };
  return sh;
}
var READER = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', LENA_ADMIN = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', READER_CODE = new Array(41).join('c');
function access_stubs(rows){
  var sh = fake_sheet([ACCESS_HEADER.slice()].concat(rows || []));
  var saved = {sheet: access_sheet, ss: store_spreadsheet, lock: LockService, mail: send_mail, ir: identity_rows, cache: CacheService, bot: bot_email, uuid: Utilities.getUuid};
  store_spreadsheet = () => ({getSheetByName: (n) => (n === ACCESS_TAB ? sh : null)});
  access_sheet = () => sh;
  LockService = {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})};
  var store = {};
  CacheService = {getScriptCache: () => ({get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = String(v); }, remove: (k) => { delete store[k]; }})};
  bot_email = () => '';
  Utilities.getUuid = () => require_crypto.randomUUID();
  var mails = [];
  send_mail = (to, subject, blocks, c, opts) => { mails.push({to: to, subject: subject, text: JSON.stringify(blocks), opts: opts || {}}); };
  access_forget();
  return {sh: sh, mails: mails, store: store, restore: () => {
    access_sheet = saved.sheet; store_spreadsheet = saved.ss; LockService = saved.lock; send_mail = saved.mail; identity_rows = saved.ir;
    CacheService = saved.cache; bot_email = saved.bot; Utilities.getUuid = saved.uuid; access_cache = null;
  }};
}
t('site access: a unit admin edits every rota\\'s slots and people and the list, not pages or rules; a reader reads', () => {
  site_stubs('someone@x');
  var a = access_stubs([[LENA_ADMIN, 'Lena Weber', 'lena@ucl', 'Unit admin', 'p1', '', '2026-11-13', 'Jan'],
                        [READER, 'Mira Holt', 'mira@ucl', 'Reader', '', READER_CODE, '2026-11-13', 'Jan']]);
  try {
    var c = get_global_constants();
    var admin = site_rights('tok', c);
    assert.ok(admin.unit_admin && admin.access && admin.add_people && admin.people[0] === 'all' && admin.slots.length === ALL_TYPES.length);
    assert.ok(!admin.pages && !admin.rules && !admin.tea_tsar && !admin.debug && admin.member);
    var reader = site_rights(READER_CODE, c);
    assert.ok(!reader.member && reader.person === READER && !reader.access && !reader.slots.length && !reader.people.length && !reader.add_people);
    assert.strictEqual(site_visitor('', READER_CODE, c).entry.name, 'Mira Holt');
    assert.strictEqual(site_visitor('', new Array(41).join('d'), c), null);
    // the access list's email never makes anyone a tsar: only a member's registered address does
    a.sh.rows[2][2] = 'tsar@x'; access_forget();
    assert.ok(!site_rights(READER_CODE, c).tea_tsar);
    // rota tsars keep the list too
    identity_for_token = () => ({id: 'b', email: 'tnjc@x'});
    var tnjc = site_rights('tok', c);
    assert.ok(tnjc.access && !tnjc.unit_admin && tnjc.slots.join() === 'TNJC');
  } finally { a.restore(); site_restore(); }
});
t('site access: the debug view is for the tea tsar (any of the listed addresses) and the bot\\'s own account only', () => {
  site_stubs('tsar2@x');
  var a = access_stubs([[READER, 'Gatsby Tea Bot', 'bot@x', 'Reader', '', READER_CODE, '', '']]);
  try {
    var c = Object.assign(get_global_constants(), {admin_email: 'tsar@x,tsar2@x'});
    var tsar = site_rights('tok', c);
    assert.ok(tsar.debug && tsar.tea_tsar);
    identity_for_token = (tok) => (tok === 'tok' ? {id: 'p1', email: 'tnjc@x'} : null);
    assert.ok(!site_rights('tok', c).debug);
    assert.ok(!site_rights(READER_CODE, c).debug);
    bot_email = () => 'bot@x';
    var bot = site_rights(READER_CODE, c);
    assert.ok(bot.debug && !bot.access && !bot.slots.length);
    assert.throws(() => { get_global_constants = () => c; api_debug_state('tok', 'b'); }, /only for the tea tsar/);
  } finally { a.restore(); site_restore(); }
});
t('site access: the debug view shows someone\\'s tea page without their away dates, address or swap codes, and is logged', () => {
  site_stubs('tsar@x');
  var a = access_stubs([]);
  var saved = [make_context, notion_query, ensure_log_sheet], logged = [];
  try {
    load_people = () => ({p1: {id: 'p1', name: 'Lena Weber', active: true}, b: {id: 'b', name: 'Nikolai Petrov', active: true, away_sheet: 'https://sheet'}});
    make_context = (c, s) => ({constants: c, settings: s, people: load_people()});
    notion_query = () => [];
    identity_rows = () => ({rows: [{id: 'b', email: 'nikolai.petrov@ucl.ac.uk', token: 'secret'}]});
    ensure_log_sheet = () => ({getSheetByName: () => ({appendRow: (r) => logged.push(r)})});
    __props = {'swapreq:abc': JSON.stringify({code: 'abc', from: 'p1', to: 'b', row_id: 'r', duty: 'tea', type: 'Just Tea', start: Date.now() + 864e5})};
    var s = api_debug_state('tok', 'b');
    assert.strictEqual(s.name, 'Nikolai Petrov');
    assert.ok(s.away_hidden && s.away.length === 0 && s.has_away_sheet);
    assert.strictEqual(s.email, 'ni•••v@u•••.ac.uk');
    assert.strictEqual(s.incoming.length, 1);
    assert.ok(!('code' in s.incoming[0]));
    assert.ok(JSON.stringify(s).indexOf('secret') < 0 && JSON.stringify(s).indexOf('abc') < 0);
    assert.deepStrictEqual([logged[0][1], logged[0][5], logged[0][6]], ['debug view', 'Lena Weber', 'looked at the tea page of Nikolai Petrov']);
    assert.throws(() => api_debug_state('tok', 'zz'), /Unknown person/);
  } finally { make_context = saved[0]; notion_query = saved[1]; ensure_log_sheet = saved[2]; __props = {}; a.restore(); site_restore(); }
});
t('site access: adding someone links rota members (by address, else by name), refuses duplicates, emails a sign-in link; removing', () => {
  site_stubs('tnjc@x');
  var a = access_stubs([]);
  try {
    load_people = () => ({p1: {id: 'p1', name: 'Lena Weber', active: true, email: 'tnjc@x'}, b: {id: 'b', name: 'Nikolai Petrov', active: true, email: 'nikolai@x'}});
    identity_rows = () => ({rows: [{id: 'p1', email: 'tnjc@x', token: 'lenatoken'}, {id: 'b', email: 'nikolai@x', token: 'nikotoken'}]});
    var list = api_site_save_access('tok', {name: ' Mira  Holt ', email: 'mira@ucl.ac.uk', role: 'Reader', notify: true});
    assert.deepStrictEqual(list.map(e => [e.name, e.person, e.by]), [['Mira Holt', '', 'Lena Weber']]);
    var code = a.sh.rows[1][5];
    assert.ok(/^[0-9a-f]{40}$/.test(code));
    assert.strictEqual(a.mails[0].to, 'mira@ucl.ac.uk');
    assert.ok(a.mails[0].opts.no_leave && a.mails[0].text.indexOf('?t=' + code) >= 0 && /read the Gatsby Rotas/.test(a.mails[0].subject));
    assert.throws(() => api_site_save_access('tok', {name: 'K F', email: 'MIRA@ucl.ac.uk', role: 'Reader'}), /on the list already/);
    assert.throws(() => api_site_save_access('tok', {name: 'Nikolai Petrov', email: 'n.petrov@ucl.ac.uk', role: 'Reader'}), /can read the site already/);
    assert.throws(() => api_site_save_access('tok', {name: 'X', email: 'nope', role: 'Reader'}), /email address/);
    assert.throws(() => api_site_save_access('tok', {name: 'X', email: 'x@y.org', role: 'Owner'}), /Reader or Unit admin/);
    // a rota tsar keeps the readers; only the tea tsar and unit admins make unit admins
    assert.throws(() => api_site_save_access('tok', {name: 'Nikolai Petrov', email: 'n.petrov@ucl.ac.uk', role: 'Unit admin'}), /Only the tea tsar and the unit admins/);
    assert.throws(() => api_site_save_access('tok', {name: 'Lena Weber', email: 'tnjc@x.org', role: 'Unit admin'}), /Only the tea tsar and the unit admins/);  // not themselves either
    identity_for_token = (tok) => (tok === 'tok' ? {id: 'p1', email: 'tsar@x'} : null);
    list = api_site_save_access('tok', {name: 'Nikolai Petrov', email: 'n.petrov@ucl.ac.uk', role: 'Unit admin', notify: true});
    var nik = list.filter(e => e.role === 'Unit admin')[0];
    assert.strictEqual(nik.person, 'b');
    assert.strictEqual(a.sh.rows[2][5], '');  // members sign in as themselves
    assert.strictEqual(a.mails[1].to, 'nikolai@x');
    assert.ok(a.mails[1].text.indexOf('?t=nikotoken') >= 0 && !a.mails[1].opts.no_leave && /make changes/.test(a.mails[1].subject));
    identity_for_token = (tok) => (tok === 'tok' ? {id: 'p1', email: 'tnjc@x'} : null);
    assert.throws(() => api_site_remove_access('tok', nik.id), /Only the tea tsar and the unit admins can remove/);
    assert.throws(() => api_site_save_access('tok', {id: nik.id, name: 'Nikolai Petrov', email: 'n.petrov@ucl.ac.uk', role: 'Unit admin'}), /Only the tea tsar and the unit admins/);
    identity_for_token = (tok) => (tok === 'tok' ? {id: 'b', email: 'nikolai@x'} : null);
    assert.ok(site_rights('tok', get_global_constants()).unit_admin && site_rights('tok', get_global_constants()).grant_admin);
    assert.throws(() => api_site_remove_access('tok', nik.id), /yourself/);
    list = api_site_remove_access('tok', list.filter(e => e.role === 'Reader')[0].id);
    assert.deepStrictEqual(list.map(e => e.name), ['Nikolai Petrov']);
    assert.strictEqual(site_visitor('', code, get_global_constants()), null);  // removed: signed out
    identity_for_token = () => ({id: 'p1', email: 'someone@x'});
    assert.throws(() => api_site_access('tok'), /Only the tsars and the unit admins/);
  } finally { a.restore(); site_restore(); }
});
t('site access: someone not on the rotas picks their name, gets the link, and signs in with their own code, not the unit key', () => {
  site_stubs('someone@x');
  var a = access_stubs([[READER, 'Mira Holt', 'mira@ucl.ac.uk', 'Reader', '', '', '2026-11-13', 'Jan'],
                        [LENA_ADMIN, 'Lena Weber', 'lena@ucl', 'Unit admin', 'p1', '', '', '']]);
  try {
    identity_rows = () => ({rows: [{id: 'p1', email: 'lena@x', token: 'x'}]});
    assert.deepStrictEqual(api_site_people().map(p => p.name), ['Lena Weber', 'Mira Holt']);
    assert.ok(/Sent to mi•••@u•••\\.ac\\.uk/.test(api_site_request_link(READER)));
    assert.ok(a.mails[0].to === 'mira@ucl.ac.uk' && a.mails[0].opts.no_leave);
    var code = Object.keys(a.store).filter(k => k.indexOf('signin:') === 0)[0].slice(7);
    var s = api_site_sign_in(code);
    assert.deepStrictEqual([s.key, s.person, s.name, s.member], ['', READER, 'Mira Holt', false]);
    assert.strictEqual(a.sh.rows[1][5], s.token);
    assert.strictEqual(api_site_sign_in_token(s.token).person, READER);
    api_site_request_link(READER); api_site_request_link(READER);
    assert.throws(() => api_site_request_link(READER), /several times/);
  } finally { a.restore(); site_restore(); }
});
t('site: unit admins add newcomers with their email, take leavers off (their swap requests go), and put several people on a rota', () => {
  site_stubs('someone@x');
  var a = access_stubs([[LENA_ADMIN, 'Lena Weber', 'lena@ucl', 'Unit admin', 'p1', '', '', '']]);
  var ident = fake_sheet([['A', 'B', 'C', 'D'], ['u1', 'Lena Weber', 'someone@x', 'tok'], ['', '', '', 'stale'], ['u2', 'Nikolai Petrov', 'nikolai@x', '']]);
  var created = null, patched = [];
  try {
    load_people = () => ({p1: {id: 'p1', name: 'Lena Weber', active: true, email: 'someone@x'}, b: {id: 'b', name: 'Nikolai Petrov', active: true, email: 'nikolai@x'}});
    identity_rows = () => ({sheet: ident, rows: [{row: 2, id: 'p1', email: 'someone@x', token: 'tok', name: 'Lena Weber'}, {row: 3, id: '', email: '', token: 'stale', name: ''},
                                                 {row: 4, id: 'b', email: 'nikolai@x.org', token: '', name: 'Nikolai Petrov'}]});
    notion_request = (m, path, body) => { created = body.properties; return {id: 'n1', properties: {}}; };
    notion_patch_page = (id, props) => { patched.push([id, props]); return {id: id, properties: {}}; };
    site_person = (page) => ({id: normalise_id(page.id), name: page.id === 'n1' ? 'Samuel Eckmann' : 'Someone'});
    var saved = api_site_save_person('tok', {name: 'Samuel Eckmann', position: 'Postdoc', joined: '2026-06-01', active: true, rotas: [], excluded: ['research', 'tea_talk', 'tea'], email: 'sam@ucl.ac.uk'});
    assert.strictEqual(created['Join Date'].date.start, '2026-06-01');
    assert.strictEqual(created['Excluded from tea'].checkbox, true);
    assert.deepStrictEqual(ident.rows[2], ['https://page/rotas/?person=n1', 'Samuel Eckmann', 'sam@ucl.ac.uk', '']);  // the first gap, stale code cleared
    assert.strictEqual(saved.email_hint, 'sa•••@u•••.ac.uk');
    assert.throws(() => api_site_save_person('tok', {id: 'p1', name: 'Lena Weber', active: true, email: 'NIKOLAI@x.org'}), /already registered for Nikolai Petrov/);
    __props = {'swapreq:abc': JSON.stringify({code: 'abc', from: 'b', to: 'p1'}), 'swapreq:def': JSON.stringify({code: 'def', from: 'p1', to: 'x'})};
    api_site_save_person('tok', {id: 'b', name: 'Nikolai Petrov', active: false, rotas: [], excluded: []});
    assert.deepStrictEqual(Object.keys(__props), ['swapreq:def']);
    assert.strictEqual(patched[0][1]['Active'].checkbox, false);
    patched = [];
    load_people = () => ({p1: {id: 'p1', name: 'Lena Weber', active: true, email: 'someone@x', mljc: true}, b: {id: 'b', name: 'Nikolai Petrov', active: true, email: 'nikolai@x.org'}});
    var consts = get_global_constants;
    get_global_constants = () => Object.assign(consts(), {mljc_email: 'gatsby-mljc@googlegroups.com'});
    a.mails.length = 0;
    api_site_set_rota('tok', 'MLJC', ['b'], ['p1']);
    get_global_constants = consts;
    assert.deepStrictEqual(patched.map(x => [x[0].replace(/-/g, ''), x[1].MLJC.checkbox]), [['b', true], ['p1', false]]);
    assert.deepStrictEqual(a.mails.map(m => m.to), ['mljc@x']);
    assert.ok(a.mails[0].text.indexOf('Add Nikolai Petrov <nikolai@x.org>') >= 0 && a.mails[0].text.indexOf('Remove Lena Weber <someone@x> (taken off MLJC') >= 0);
    identity_for_token = () => ({id: 'b', email: 'tnjc@x'});
    access_forget();
    assert.throws(() => api_site_set_rota('tok', 'MLJC', ['b'], []), /Only the MLJC tsar/);
    api_site_set_rota('tok', 'CSNJC', ['p1'], []);
    assert.throws(() => api_site_save_person('tok', {name: 'Someone New'}), /tea tsar and the unit admins/);
  } finally { __props = {}; a.restore(); site_restore(); }
});

t('mailing lists: who to add, remove or re-address, from two states of a person', () => {
  var lena = {name: 'Lena Weber', email: 'lena@ucl.ac.uk', active: true, tnjc: true, csnjc: true, mljc: false, coffee: false};
  var j = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(j(list_moves(null, list_person(null, {name: 'Sam New', email: 'sam@ucl.ac.uk', tnjc: true}))), [{rota: 'TNJC', action: 'add', name: 'Sam New', email: 'sam@ucl.ac.uk'}]);
  assert.deepStrictEqual(j(list_moves(lena, list_person(lena, {active: false}))).map(m => [m.rota, m.action, m.why]), [['TNJC', 'remove', 'left'], ['CSNJC', 'remove', 'left']]);
  assert.deepStrictEqual(j(list_moves(lena, list_person(lena, {csnjc: false, mljc: true}))).map(m => [m.rota, m.action, m.why]), [['CSNJC', 'remove', 'off'], ['MLJC', 'add', undefined]]);
  assert.deepStrictEqual(j(list_moves(lena, list_person(lena, {email: 'l.weber@gmail.com'}))).map(m => [m.rota, m.action, m.old, m.email]),
    [['TNJC', 'replace', 'lena@ucl.ac.uk', 'l.weber@gmail.com'], ['CSNJC', 'replace', 'lena@ucl.ac.uk', 'l.weber@gmail.com']]);
  assert.deepStrictEqual(list_moves(lena, list_person(lena, {name: 'Lena W.'})), []);
  assert.deepStrictEqual(list_moves(list_person(lena, {active: false}), list_person(lena, {active: false, tnjc: false})), []);  // inactive people are on no list
  assert.ok(/no address registered yet/.test(list_line({rota: 'TNJC', action: 'add', name: 'X', email: ''})));
});
t('mailing lists: one email per organiser, every list they look after, with a link to the group', () => {
  var saved = send_mail, mails = [];
  send_mail = (to, subject, blocks) => mails.push({to: to, subject: subject, text: JSON.stringify(blocks)});
  try {
    var c = {tnjc_email: 'gatsby-tnjc@googlegroups.com', csnjc_email: 'gatsby-csnjc@googlegroups.com', mljc_email: 'gatsby-mljc@googlegroups.com',
             tnjc_admin_email: 'tnjc@x', mljc_admin_email: 'mljc@x', admin_email: 'tsar@x'};
    var lena = {name: 'Lena Weber', email: 'lena@ucl.ac.uk', active: true, tnjc: true, csnjc: true, mljc: true};
    list_todo(list_moves(lena, list_person(lena, {active: false})), c, 'Lena Weber has left the Gatsby tea system.');
    assert.deepStrictEqual(mails.map(m => [m.to, m.subject]), [['tnjc@x', 'Mailing list: 2 changes to make'], ['mljc@x', 'Mailing list: 1 change to make']]);
    assert.ok(mails[0].text.indexOf('TNJC: gatsby-tnjc@googlegroups.com') >= 0 && mails[0].text.indexOf('CSNJC: gatsby-csnjc@googlegroups.com') >= 0);
    assert.ok(mails[0].text.indexOf('Remove Lena Weber <lena@ucl.ac.uk> (no longer on the rotas)') >= 0);
    assert.ok(mails[0].text.indexOf('https://groups.google.com/g/gatsby-tnjc/members') >= 0);
    mails = [];
    list_todo([{rota: 'Coffee', action: 'add', name: 'X', email: 'x@y.org'}], c, 'x');  // no coffee list configured: nothing
    list_todo([], c, 'x');
    assert.strictEqual(mails.length, 0);
  } finally { send_mail = saved; }
});
// closed days and the autopilot (Autopilot.js)
t('closed dates: yearly ranges over New Year, one-off ranges and days', () => {
  var c = parse_closed('12-24..01-01, 2027-03-15..2027-03-19, 2027-04-02, 2027-05-03..05-05, nonsense');
  assert.strictEqual(c.length, 4);
  [['2026-12-29', true], ['2027-01-01', true], ['2027-01-02', false], ['2026-12-23', false], ['2027-03-17', true], ['2028-03-17', false], ['2027-04-02', true], ['2027-05-04', true]]
    .forEach(x => assert.strictEqual(is_closed(x[0], c), x[1], x[0]));
  assert.deepStrictEqual(parse_closed(''), []);
});
t('slot creation skips closed days, and a coffee week only when it is closed all week', () => {
  var c = slot_ctx(); c.settings.closed_days = parse_closed('12-24..01-01');
  var r = create_slots('TNJC', {from: '2026-12-01', to: '2027-01-10'}, c);
  assert.deepStrictEqual(made.map(p => p.Date.date.start.slice(0, 10)), ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2027-01-05']);
  assert.deepStrictEqual(r.holidays, ['2026-12-29 (closed)']);
  c = slot_ctx(); c.settings.closed_days = parse_closed('12-24..01-01');
  r = create_slots('Coffee Cleaning', {from: '2026-12-21', to: '2027-01-10'}, c);
  assert.deepStrictEqual(made.map(p => p.Date.date.start), ['2026-12-21', '2027-01-04']);
  assert.deepStrictEqual(r.holidays, ['2026-12-28 (closed all week)']);
});
t('slot creation leaves out the skip list and returns the new ids', () => {
  var c = slot_ctx(); var n = 0;
  notion_request = function(m, path, body){ made.push(body.properties); n++; return {id: 'id-' + n}; };
  var r = create_slots('MLJC', {from: '2026-11-01', to: '2026-11-16'}, c, {'MLJC|2026-11-09': true});
  assert.deepStrictEqual(r.made, [{id: 'id1', key: 'MLJC|2026-11-02'}, {id: 'id2', key: 'MLJC|2026-11-16'}]);
  assert.deepStrictEqual(r.skipped, ['2026-11-09 MLJC']);
  slot_ctx();
});
t('autopilot: rota names', () => assert.deepStrictEqual(auto_rotas_of('MLJC, talks, Coffee, research talk, nonsense'), ['MLJC', 'talks', 'Coffee Cleaning']));
t('autopilot: plans from 10 days ahead to the end of the week AUTO_WEEKS ahead; a talk-like slot takes its day', () => {
  var saved = load_rows;
  try {
    var c = ctx(false); c.settings.auto_weeks = 6;
    assert.deepStrictEqual(auto_window(c, '2026-11-20'), {from: '2026-11-30', to: '2027-01-03'});
    assert.deepStrictEqual(auto_window(c, '2026-11-23'), {from: '2026-12-03', to: '2027-01-10'});
    assert.deepStrictEqual(auto_ranges('talks', {from: 'a', to: 'b'}), {research_from: 'a', research_to: 'b', tea_from: 'a', tea_to: 'b'});
    load_rows = type => type === 'Just Tea' ? [{start: new Date('2026-12-08T15:30:00Z')}] : (type === 'TNJC' ? [{start: new Date('2027-01-19T13:30:00Z')}] : []);
    assert.deepStrictEqual(auto_slot_keys('talks', {from: '2026-12-03', to: '2027-01-10'}, c), ['Research Talk|2026-12-08', 'Tea Talk|2026-12-08']);
    assert.deepStrictEqual(auto_slot_keys('TNJC', {from: '2026-12-03', to: '2027-01-31'}, c), ['TNJC|2027-01-19']);
  } finally { load_rows = saved; }
});
// A small world for the autopilot: four MLJC people (An, Bo, Cy, Di X) who last presented in May, June, July and
// August (so An is next in line, then Bo, Cy, Di), an in-memory rota data table that create/fill/patch work on,
// away dates per person, and the emails as text. W.day('yyyy-MM-dd') moves "today" and clears the mails.
var AP_STUBS = ['load_rows', 'tentative_rows', 'read_away_all', 'notion_patch_page', 'notion_request', 'send_mail', 'tea_page_link_for', 'start_of_today', 'finalise_rows'];
function ap_t(name, fn){
  t(name, () => {
    var saved = {};
    AP_STUBS.forEach(k => { saved[k] = globalThis[k]; });
    ['auto:MLJC', 'auto:TNJC', 'auto:talks', 'auto:Coffee Cleaning'].forEach(k => PropertiesService.getScriptProperties().deleteProperty(k));
    try { fn(); } finally { AP_STUBS.forEach(k => { globalThis[k] = saved[k]; }); }
  });
}
function ap_row(id, type, start, pres, tea, extra){
  return Object.assign({id: id, url: 'u', type: type, title: '', description: '', start: new Date(start), end: null, presenter_ids: pres || [], tea_ids: tea || [],
                        csnjc: false, water_filter: false, gcal_id: 'ev-' + id, guest: ''}, extra || {});
}
function ap_past(){
  return [ap_row('m1', 'MLJC', '2026-05-04T12:30:00Z', ['an']), ap_row('m2', 'MLJC', '2026-06-01T12:30:00Z', ['bo']),
          ap_row('m3', 'MLJC', '2026-07-06T12:30:00Z', ['cy']), ap_row('m4', 'MLJC', '2026-08-03T12:30:00Z', ['di'])];
}
function ap_world(o){
  o = o || {};
  var W = {rows: ap_past().concat(o.rows || []), away: o.away || {}, mails: [], titles: {}, fin: [], n: 0};
  var c = ctx(false);
  c.settings.auto_weeks = 6; c.settings.closed_days = parse_closed('12-24..01-01'); c.settings.auto_rotas = o.auto || ['MLJC'];
  c.constants = {mljc_admin_email: 'org@x', tnjc_admin_email: 'tnjc@x', admin_email: 'tsar@x', notion_talk_db_id: 'db'};
  c.people = {};
  (o.people || ['an', 'bo', 'cy', 'di']).forEach(id => {
    c.people[id] = {id: id, name: id.charAt(0).toUpperCase() + id.slice(1) + ' X', active: true, mljc: true, tnjc: false, csnjc: false, coffee: false,
                    position: 'PhD student', email: id + '@x', away_sheet: 'sheet', rt_excluded: false, tt_excluded: false, tea_excluded: false};
  });
  var find = id => W.rows.filter(r => r.id === normalise_id(id))[0];
  load_rows = (type, from, to) => W.rows.filter(r => r.type === type && r.start >= from && (!to || r.start < add_days(to, 1)));
  tentative_rows = rota => W.rows.filter(r => is_tentative(r) && rota_of_type(r.type) === rota);
  read_away_all = p => (W.away[p.id] || []).map(a => ({from: a[0], to: a[1]}));
  notion_patch_page = (id, props) => {
    var r = find(id);
    if (props.Presenter) r.presenter_ids = props.Presenter.relation.map(x => normalise_id(x.id));
    if (props.Tea) r.tea_ids = props.Tea.relation.map(x => normalise_id(x.id));
    if (props.Type) r.type = props.Type.select.name;
  };
  notion_request = (m, path, body) => {
    var p = body.properties; W.n++;
    var r = ap_row('new' + W.n, p.Type.select.name, p.Date.date.start, [], [], {title: p.Title.title[0].text.content, gcal_id: ''});
    W.rows.push(r);
    return {id: r.id};
  };
  finalise_rows = rows => rows.forEach(r => { r.title = ''; r.gcal_id = 'ev-' + r.id; W.fin.push(fmt_iso_date(r.start)); });
  send_mail = (to, subject, blocks) => W.mails.push({to: to, subject: subject, text: blocks_to_text(blocks).split('\\n').map(l => l.trim()).join(' ')});   // unwrapped
  tea_page_link_for = id => 'https://page/?t=' + id;
  c.cal = {getEventById: id => ({getTitle: () => W.titles[id] || '', setTitle: x => { W.titles[id] = x; }})};
  W.day = d => { start_of_today = () => parse_iso_date(d); W.mails = []; W.today = d; };
  W.run = d => { W.day(d); return autopilot_rota((o.auto || ['MLJC'])[0], c, d); };
  W.on = d => W.rows.filter(r => r.type === 'MLJC' && fmt_iso_date(r.start) === d)[0];
  W.to = who => W.mails.filter(m => m.to === who);
  W.day(o.today || '2026-11-20');
  return {c: c, W: W};
}

t('sched_pick: next in line who is free, not excluded, not presenting within a week; the flags of the duty', () => {
  var past = [{id: 'p1', date: '2026-05-04', type: 'MLJC', presenter: ['an'], tea: []}, {id: 'p2', date: '2026-06-01', type: 'MLJC', presenter: ['bo'], tea: []},
              {id: 'p3', date: '2026-07-06', type: 'MLJC', presenter: ['cy'], tea: []}, {id: 'p4', date: '2027-01-11', type: 'MLJC', presenter: ['di'], tea: []}];
  var free = id => ({id: id, away_from: [], away_until: []});
  var people = ['an', 'bo', 'cy', 'di'].map(free);
  var slot = {id: 's', date: '2027-01-04', type: 'MLJC', presenter: ['an'], tea: []};
  assert.strictEqual(sched_pick(slot, 'presenter', past, people, ['an']), 'bo');
  people[1] = {id: 'bo', away_from: ['2027-01-01'], away_until: ['2027-01-05']};
  assert.strictEqual(sched_pick(slot, 'presenter', past, people, ['an']), 'cy');
  assert.strictEqual(sched_pick(slot, 'presenter', past, people, ['an', 'cy']), null, 'di presents a week later, so is protected');
  var talk = {id: 't', date: '2027-01-04', type: 'Research Talk', presenter: ['an'], tea: ['bo']};
  var flags = [{id: 'cy', away_from: [], away_until: [], rt_excluded: true}, {id: 'di', away_from: [], away_until: [], tea_excluded: true}, free('an'), free('bo')];
  assert.strictEqual(sched_pick(talk, 'presenter', [], flags, ['an', 'bo']), 'di');
  assert.strictEqual(sched_pick(talk, 'tea', [], flags, ['an', 'bo']), 'cy');
});
ap_t('fill_slots: only the open duties of tentative slots; people on them stay; guests keep their talk; cancelled slots are left alone', () => {
  var T = '[Tentative]';
  var w = ap_world({rows: [
    ap_row('s1', 'Research Talk', '2027-01-04T15:00:00Z', [], ['an'], {title: T}),
    ap_row('s2', 'Research Talk', '2027-01-11T15:00:00Z', [], [], {title: T + ' Cancelled'}),
    ap_row('s3', 'Tea Talk', '2027-01-05T15:30:00Z', [], [], {title: T, guest: 'Prof Guest'}),
    ap_row('s4', 'Tea Talk', '2027-02-04T15:30:00Z', ['bo'], ['cy'], {title: T}),
    ap_row('s5', 'Just Tea', '2027-01-12T15:30:00Z', [], [], {title: 'Cancelled'})
  ]}), W = w.W;
  var patched = [], real_patch = notion_patch_page;
  notion_patch_page = (id, props) => { patched.push(normalise_id(id)); return real_patch(id, props); };
  var res = fill_slots('talks', w.c);
  var on = id => W.rows.filter(r => r.id === id)[0];
  assert.deepStrictEqual([on('s1').presenter_ids, on('s1').tea_ids], [['di'], ['an']], 'the tea person stays, the presenter is filled');
  assert.deepStrictEqual([on('s3').presenter_ids, on('s3').tea_ids], [[], ['bo']], 'a guest talk only gets tea: di presents the day before, an (s1) and cy (s4) count as having had tea');
  assert.deepStrictEqual(patched.sort(), ['s1', 's3'], 'full and cancelled slots are not written');
  assert.deepStrictEqual([on('s2').presenter_ids, on('s2').tea_ids, on('s5').tea_ids], [[], [], []]);
  assert.strictEqual(res.filled.length, 2);
  assert.ok(/Prof Guest, tea: Bo X/.test(res.filled.join(' | ')), res.filled.join(' | '));
  assert.deepStrictEqual(fill_slots('talks', w.c).warnings, ['No tentative slot is missing a presenter or tea person.'], 'a second run finds nothing to do');
});
t('organiser_rota: rota names in any case, talk aliases, unknown names are their own error', () => {
  var c = {me_identity: {email: 'Tsar@x'}, constants: {admin_email: 'tsar@x', mljc_admin_email: 'org@x'}};
  assert.strictEqual(organiser_rota(c, 'Research Talk'), 'talks');
  assert.strictEqual(organiser_rota(c, 'tea talks'), 'talks');
  assert.strictEqual(organiser_rota(c, 'coffee cleaning'), 'Coffee Cleaning');
  assert.throws(() => organiser_rota(c, 'Lunch'), /no rota called "Lunch"/);
  assert.throws(() => organiser_rota({me_identity: {email: 'org@x'}, constants: c.constants}, 'TNJC'), /Only the organiser/);
  assert.strictEqual(organiser_rota({me_identity: {email: 'org@x'}, constants: c.constants}, 'mljc'), 'MLJC');
});
ap_t('autopilot, a week of it: pencilled in on Friday, an away date hands a slot on, Monday it goes live and plans on, an organiser edit is told', () => {
  var w = ap_world({rows: [ap_row('g', 'MLJC', '2026-11-23T13:30:00Z', [], [], {guest: 'Prof Guest'})]}), W = w.W;
  W.run('2026-11-20');   // Friday, first run: plans 30 Nov - 3 Jan (28 Dec closed)
  assert.deepStrictEqual(['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'].map(d => W.on(d).presenter_ids[0]), ['an', 'bo', 'cy', 'di']);
  assert.strictEqual(W.on('2026-12-28'), undefined);
  assert.deepStrictEqual(W.mails.map(m => m.to).sort(), ['an@x', 'bo@x', 'cy@x', 'di@x', 'org@x']);
  var an = W.to('an@x')[0], cy = W.to('cy@x')[0];
  assert.strictEqual(an.subject, 'You are presenting at MLJC on Mon 30 Nov 2026');
  assert.ok(an.text.indexOf('ask someone to swap') >= 0 && an.text.indexOf('Away then?') < 0, 'less than three weeks away: swap only');
  assert.ok(cy.text.indexOf('by the end of Sun 22 Nov 2026') >= 0, cy.text);
  assert.ok(cy.text.indexOf('It goes on the calendar on Mon 23 Nov 2026.') >= 0 && cy.text.indexOf('https://page/?t=cy') >= 0);
  assert.strictEqual(W.to('org@x')[0].subject, 'MLJC: next slots planned, on the calendar on Mon 23 Nov 2026');

  W.run('2026-11-21');   // Saturday: nothing to do
  assert.deepStrictEqual(W.mails, []); assert.deepStrictEqual(W.fin, []);

  W.away.di = [['2026-12-19', '2026-12-23']];
  W.run('2026-11-23');   // Monday: Di's slot goes to the next free person (An: Cy presents the week before), all four go live, 4 Jan planned
  assert.deepStrictEqual(W.on('2026-12-21').presenter_ids, ['an']);
  assert.strictEqual(W.to('di@x')[0].subject, 'Handed on: presenting at MLJC on Mon 21 Dec 2026');
  var take = W.to('an@x')[0];
  assert.ok(take.text.indexOf('You take over from Di X') >= 0 && take.text.indexOf('by the end of Sun 29 Nov 2026') >= 0, take.text);
  assert.ok(W.mails.some(m => m.to === 'org@x' && m.subject === 'MLJC: slots handed on because of away dates' && m.text.indexOf('Di X → An X') >= 0));
  assert.deepStrictEqual(W.fin, ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
  assert.strictEqual(W.to('an@x').length, 1, 'nobody is told twice');
  assert.deepStrictEqual(W.on('2027-01-04').presenter_ids, ['di']);
  assert.ok(W.to('di@x').some(m => m.subject === 'You are presenting at MLJC on Mon 4 Jan 2027' && m.text.indexOf('It goes on the calendar on Thu 26 Nov 2026.') >= 0));

  W.on('2027-01-04').presenter_ids = ['bo'];   // the organiser changes it by hand during the review
  W.run('2026-11-26');
  assert.deepStrictEqual(W.fin.slice(-1), ['2027-01-04']);
  assert.deepStrictEqual(W.mails.map(m => m.to), ['bo@x']);
  assert.ok(W.mails[0].text.indexOf('It is on the calendar.') >= 0);
});
ap_t('autopilot away check: a slot on the calendar changes hands there too; slots closer than three weeks are left alone', () => {
  var w = ap_world({today: '2026-11-23', rows: [ap_row('s9', 'MLJC', '2027-01-04T13:30:00Z', ['an']), ap_row('s8', 'MLJC', '2026-12-07T13:30:00Z', ['cy'])],
                    away: {an: [['2027-01-01', '2027-01-10']], cy: [['2026-12-07', '2026-12-07']]}}), W = w.W;
  W.titles['ev-s9'] = 'MLJC: An X';
  auto_recheck('MLJC', w.c, '2026-11-23', load_auto_state('MLJC'));
  assert.deepStrictEqual(W.on('2027-01-04').presenter_ids, ['bo']);
  assert.strictEqual(W.titles['ev-s9'], 'MLJC: Bo X');
  assert.deepStrictEqual(W.on('2026-12-07').presenter_ids, ['cy'], 'two weeks away: a swap, not the bot');
  assert.ok(W.to('bo@x')[0].text.indexOf('It is on the calendar.') >= 0);
  assert.strictEqual(W.mails.length, 3);
});
ap_t('autopilot away check: skips people who are away too; hands on again when the new person adds away dates', () => {
  var w = ap_world({today: '2026-11-23', rows: [ap_row('s9', 'MLJC', '2027-01-04T13:30:00Z', ['an'])], away: {an: [['2027-01-04', '2027-01-04']], bo: [['2027-01-02', '2027-01-06']]}}), W = w.W;
  var st = load_auto_state('MLJC');
  auto_recheck('MLJC', w.c, '2026-11-23', st);
  assert.deepStrictEqual(W.on('2027-01-04').presenter_ids, ['cy']);
  W.away.cy = [['2027-01-04', '2027-01-04']]; W.day('2026-11-24');
  auto_recheck('MLJC', w.c, '2026-11-24', st);
  assert.deepStrictEqual(W.on('2027-01-04').presenter_ids, ['di']);
  assert.strictEqual(W.to('cy@x')[0].subject, 'Handed on: presenting at MLJC on Mon 4 Jan 2027');
  assert.ok(W.to('di@x')[0].text.indexOf('You take over from Cy X') >= 0);
  W.day('2026-11-25');
  assert.deepStrictEqual(auto_recheck('MLJC', w.c, '2026-11-25', st), []);
  assert.deepStrictEqual(W.mails, []);
});
ap_t('autopilot away check: nobody free leaves the slot as it is and tells the organiser once', () => {
  var all = [['2027-01-01', '2027-01-08']];
  var w = ap_world({today: '2026-11-23', rows: [ap_row('s9', 'MLJC', '2027-01-04T13:30:00Z', ['an'])], away: {an: all, bo: all, cy: all, di: all}}), W = w.W;
  var st = load_auto_state('MLJC');
  auto_recheck('MLJC', w.c, '2026-11-23', st);
  assert.deepStrictEqual(W.on('2027-01-04').presenter_ids, ['an']);
  assert.deepStrictEqual(W.mails.map(m => m.to + ' ' + m.subject), ['org@x MLJC: nobody free for a slot']);
  assert.ok(W.mails[0].text.indexOf('Mon 4 Jan 2027 · MLJC: An X') >= 0);
  W.day('2026-11-24');
  auto_recheck('MLJC', w.c, '2026-11-24', st);
  assert.deepStrictEqual(W.mails, []);
});
ap_t('autopilot away check: cancelled slots and guest speakers are left alone; tea duty is checked apart from the talk', () => {
  var w = ap_world({auto: ['talks'], today: '2026-11-23',
                    rows: [ap_row('c1', 'Research Talk', '2027-01-04T15:00:00Z', ['an'], [], {title: 'Cancelled: retreat'}),
                           ap_row('g1', 'Research Talk', '2027-01-11T15:00:00Z', [], ['bo'], {guest: 'Prof Guest'}),
                           ap_row('r1', 'Research Talk', '2027-01-18T15:00:00Z', ['cy'], ['di'])],
                    away: {an: [['2027-01-01', '2027-01-30']], bo: [['2027-01-01', '2027-01-12']], di: [['2027-01-18', '2027-01-18']]}}), W = w.W;
  var get = id => W.rows.filter(r => r.id === id)[0];
  auto_recheck('talks', w.c, '2026-11-23', load_auto_state('talks'));
  assert.deepStrictEqual(get('c1').presenter_ids, ['an'], 'a cancelled talk is not touched');
  assert.deepStrictEqual([get('g1').guest, get('g1').tea_ids], ['Prof Guest', ['di']], 'An presents (cancelled) and Cy presents within a week, so Di');
  assert.deepStrictEqual([get('r1').presenter_ids, get('r1').tea_ids], [['cy'], ['bo']]);
  assert.strictEqual(W.to('an@x').length, 0);
  assert.deepStrictEqual(W.to('di@x').map(m => m.subject).sort(), ['Handed on: tea duty on Mon 18 Jan 2027', 'Tea duty on Mon 11 Jan 2027']);
});
ap_t('autopilot away check: two hand-overs in one morning; the second counts the first (fairness)', () => {
  var w = ap_world({today: '2026-11-23', rows: [ap_row('s1', 'MLJC', '2027-01-04T13:30:00Z', ['an']), ap_row('s2', 'MLJC', '2027-01-18T13:30:00Z', ['cy'])],
                    away: {an: [['2027-01-01', '2027-01-05']], cy: [['2027-01-18', '2027-01-18']]}}), W = w.W;
  auto_recheck('MLJC', w.c, '2026-11-23', load_auto_state('MLJC'));
  assert.deepStrictEqual([W.on('2027-01-04').presenter_ids, W.on('2027-01-18').presenter_ids], [['bo'], ['an']], 'Bo just got 4 Jan, so An (free on 18 Jan) is next');
  assert.strictEqual(W.mails.filter(m => m.to === 'org@x').length, 1, 'one summary for the organiser');
});
ap_t('autopilot away check: a guest speaker slot belongs to the guest, whoever else is on it', () => {
  var w = ap_world({today: '2026-11-23', rows: [ap_row('s1', 'MLJC', '2027-01-04T13:30:00Z', ['an'], [], {guest: 'Prof Guest'})], away: {an: [['2027-01-01', '2027-01-05']]}}), W = w.W;
  assert.deepStrictEqual(auto_recheck('MLJC', w.c, '2026-11-23', load_auto_state('MLJC')), []);
  assert.deepStrictEqual([W.on('2027-01-04').presenter_ids, W.mails], [['an'], []]);
});
ap_t('autopilot: a removed slot is dropped, never finalised, and never planned again', () => {
  var w = ap_world(), W = w.W;
  W.run('2026-11-20');
  W.rows = W.rows.filter(r => fmt_iso_date(r.start) !== '2026-12-14');   // the organiser removes 14 Dec
  W.run('2026-11-23');
  assert.deepStrictEqual(W.fin, ['2026-11-30', '2026-12-07', '2026-12-21']);
  assert.strictEqual(W.on('2026-12-14'), undefined);
  W.run('2026-11-30');
  assert.strictEqual(W.on('2026-12-14'), undefined);
});
ap_t('autopilot: fills dates that never had a slot, also before one added far ahead', () => {
  var w = ap_world({rows: [ap_row('x', 'MLJC', '2026-12-07T13:30:00Z', ['bo']), ap_row('b', 'MLJC', '2027-02-01T13:30:00Z', [], [], {title: 'Cancelled: retreat'})]}), W = w.W;
  W.run('2026-11-20');
  assert.deepStrictEqual(W.rows.filter(r => r.id.indexOf('new') === 0).map(r => fmt_iso_date(r.start)), ['2026-11-30', '2026-12-14', '2026-12-21']);
});
ap_t('away dates on the tea page: which of your slots the bot hands on and which need a swap', () => {
  var w = ap_world({auto: ['MLJC'], rows: [ap_row('a1', 'MLJC', '2027-01-04T13:30:00Z', ['an']), ap_row('a2', 'MLJC', '2026-12-07T13:30:00Z', ['an']),
                                           ap_row('a3', 'TNJC', '2027-01-05T13:30:00Z', ['an'])]}), W = w.W;
  W.day('2026-11-23');
  var note = away_clash_note('an', parse_iso_date('2026-12-01'), parse_iso_date('2027-01-10'), w.c);
  assert.ok(note.indexOf('hands this to the next free person and emails you both: presenting at MLJC on Mon 4 Jan 2027.') >= 0, note);
  assert.ok(note.indexOf('please ask someone to swap: presenting at TNJC on Tue 5 Jan 2027; presenting at MLJC on Mon 7 Dec 2026.') >= 0, note);
  assert.strictEqual(away_clash_note('bo', parse_iso_date('2026-12-01'), parse_iso_date('2027-01-10'), w.c), '');
});
t('autopilot: duty emails per kind of slot', () => {
  var d = new Date('2026-12-07T15:00:00Z');
  assert.strictEqual(duty_message(row({type: 'Research Talk', start: d}), 'presenter').subject, 'Your research talk on Mon 7 Dec 2026');
  assert.strictEqual(duty_message(row({type: 'Research Talk', start: d}), 'tea').text, 'You are on tea duty for the research talk on **Mon 7 Dec 2026, 15:00**.');
  assert.strictEqual(duty_message(row({type: 'TNJC', csnjc: true, start: d}), 'presenter').subject, 'You are presenting at TNJC (CSNJC) on Mon 7 Dec 2026');
  assert.strictEqual(duty_message(row({type: 'Coffee Cleaning', start: new Date(2026, 11, 7)}), 'tea').subject, 'Coffee cleaning in the week of Mon 7 Dec 2026');
  assert.strictEqual(duty_message(row({type: 'Just Tea', start: d}), 'tea').text, 'You are on tea duty on **Mon 7 Dec 2026, 15:00**.');
});
t('autopilot: coffee duty email says confirmed and daily emails, not calendar', () => {
  var saved = {send_mail: send_mail, tea_page_link_for: tea_page_link_for, auto_organiser: auto_organiser};
  try {
    var got = []; send_mail = (to, subj, blocks) => got.push(blocks.filter(b => typeof b === 'string').join(' ')); tea_page_link_for = () => 'https://page'; auto_organiser = () => 'org@x';
    var c = ctx(false); var today = '2026-11-24';
    duty_mail(row({type: 'Coffee Cleaning', title: '', presenter_ids: [], tea_ids: ['a'], start: new Date(2027, 0, 4)}), 'tea', 'a', c, today, {});
    duty_mail(row({type: 'Coffee Cleaning', title: '[Coffee Cleaning Tentative]', presenter_ids: [], tea_ids: ['a'], start: new Date(2027, 0, 4)}), 'tea', 'a', c, today, {live: '2026-11-27'});
    duty_mail(row({title: '', start: new Date(2027, 0, 5)}), 'presenter', 'a', c, today, {});
    assert.ok(/It is confirmed\\. You will get the usual reminders before, and an email every day of that week\\./.test(got[0]), got[0]);
    assert.ok(/It is confirmed on Fri 27 Nov 2026\\./.test(got[1]), got[1]);
    assert.ok(/It is on the calendar\\. You will get the usual reminders before\\./.test(got[2]), got[2]);
    assert.ok(!/calendar/.test(got[0] + got[1]));
  } finally { Object.keys(saved).forEach(k => { this[k] = saved[k]; }); }
});
t('autopilot: Monday nudges skip rotas on autopilot', () => {
  var saved = {send_mail: send_mail, last_scheduled_date: last_scheduled_date, start_of_today: start_of_today};
  try {
    var m = []; send_mail = (to, subj) => m.push(subj); last_scheduled_date = () => null; start_of_today = () => new Date(2026, 10, 23);
    daily_reminders({tnjc_admin_email: 'a', mljc_admin_email: 'b'}, {reminder_types: ['TNJC', 'MLJC'], auto_rotas: ['MLJC'], schedule_warning_days: 21, date_reminders: []});
    assert.deepStrictEqual(m, ['Time to schedule more TNJC slots']);
  } finally { Object.keys(saved).forEach(k => { this[k] = saved[k]; }); }
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
// The Cron Jobs (their own project) match away-date sheets and identity rows to people by the id in the address
// they keep (H2, column A): the site's since the move, the old Notion page's before
const cron = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'cron-jobs', 'SyncPeople.js'), 'utf8'), cron);
const cronIds = [['https://gatsbyunit.github.io/gatsby-teabot/rotas/?person=0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef'],
  ['https://www.notion.so/Abbe-Lena-0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef'], ['', '']]
  .filter(([u, id]) => cron.notion_id_from_url(u) !== id);
console.log((cronIds.length ? 'FAIL' : 'ok  ') + ' cron jobs: people found by the id in their address' + (cronIds.length ? ' (' + cronIds.map(x => x[0]) + ')' : ''));
if (cronIds.length) process.exitCode = 1;
// The cancelled-title pattern has copies where the bot's code can't be shared: all must be the same
const reCopies = ['apps-script/automation/Schedule.js', 'apps-script/cron-jobs/Utilities_TalkReminder.js', 'site/rotas/app.js', 'site/rotas/edit.js', 'mcp/server.js']
  .map(f => [f, (fs.readFileSync(path.join(__dirname, '..', f), 'utf8').match(/CANCELLED_TITLE_RE = (\/.+\/i);/) || [])[1]]);
const reBad = reCopies.filter(([, re]) => !re || re !== reCopies[0][1]).map(([f]) => f);
console.log((reBad.length ? 'FAIL' : 'ok  ') + ' cancelled-title pattern: the same in bot, Cron Jobs, site and MCP' + (reBad.length ? ' (differs: ' + reBad + ')' : ''));
if (reBad.length) process.exitCode = 1;
const ctx = vm.createContext({console, Buffer, assert, require_crypto: require('crypto'), Intl});
const out = vm.runInContext(stubs + src + tests, ctx);
console.log(out);
process.exit(out.includes('FAIL') || process.exitCode ? 1 : 0);
