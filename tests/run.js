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
function ev(title){ return {title: title, getTitle(){ return this.title; }, setTitle(x){ this.title = x; }}; }
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
function cal_stub(){ return { getEventById: () => null, createEvent: (t, s, e, o) => { created.push(t); return {getId: () => 'new1', getDescription: () => o.description, setDescription: function(){}, getTitle: () => t}; }, createAllDayEvent: (t) => { created.push('allday:' + t); return {getId: () => 'new2', getDescription: () => '', setDescription: function(){}}; } }; }
t('first look: slot without event is left alone', () => { var c = ctx(false); c.baseline = true; c.no_event = []; c.cal = cal_stub(); created = []; var out = sync_row(row({gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(out.no_event, true); assert.strictEqual(created.length, 0); assert.strictEqual(patched.length, 0); });
t('known slot without event stays alone', () => { var c = ctx(false); c.baseline = false; c.no_event = ['r1']; c.cal = cal_stub(); created = []; var out = sync_row(row({gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(created.length, 0); assert.strictEqual(out.no_event, true); });
t('newly confirmed slot gets an event', () => { var c = ctx(false); c.baseline = false; c.no_event = []; c.cal = cal_stub(); c.constants.gatsby_zoom_link = 'z'; created = []; var out = sync_row(row({gcal_id: '', start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.deepStrictEqual(created, ['TNJC: Nikolai Petrov']); assert.strictEqual(patched[0]['GCal ID'].rich_text[0].text.content, 'new1'); assert.strictEqual(mailed.length, 0); });
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
// apply_swap
t('swap: Notion, calendar title, one email to both', () => { var c = ctx(false); var e = ev('TNJC: Nikolai Petrov'); c.cal = {getEventById: () => e}; var r = row({}); var msg = apply_swap(r, 'presenter', 'b', 'a', c); assert.strictEqual(patched[0].Presenter.relation[0].id.replace(/-/g, ''), 'a'); assert.strictEqual(e.title, 'TNJC: Lena Weber'); assert.strictEqual(mailed.length, 1); assert.ok(mailed[0].startsWith('nikolai@x,lena@x'), mailed[0]); assert.ok(msg.startsWith('Done')); });
t('swap refused for a slot that is not theirs', () => { var c = ctx(false); assert.throws(() => apply_swap(row({}), 'presenter', 'a', 'c', c), /changed/); assert.strictEqual(patched.length, 0); });
t('swap refused for tentative', () => { var c = ctx(false); assert.throws(() => apply_swap(row({title: '[TNJC Tentative]'}), 'presenter', 'b', 'a', c), /tentative/); });
t('relabelled talk agrees', () => assert.ok(titles_agree(parse_title('UPGRADE TALK: Nikolai Petrov TEA: Lena Weber', 'Research Talk'), row({type: 'Research Talk', presenter_ids: ['b'], tea_ids: ['a']}), people)));
t('rotation talk agrees', () => assert.ok(titles_agree(parse_title('ROTATION TALK: Nikolai Petrov TEA: Lena Weber', 'Tea Talk'), row({type: 'Tea Talk', presenter_ids: ['b'], tea_ids: ['a']}), people)));
t('tea-only title compares tea only', () => assert.ok(titles_agree(parse_title('TEA: Lena Weber', 'Tea Talk'), row({type: 'Tea Talk', presenter_ids: ['b'], tea_ids: ['a']}), people)));
t('cancellations recognised', () => { ['No MLJC — CANCELLED', 'TEA TALK: CANCELLED TEA: X', 'TEA TALK: Cancelled TEA: Y', 'TNJC cancelled', 'No TNJC this week'].forEach(x => assert.ok(is_cancelled_title(x), x)); ['TNJC: Lena Weber', 'RESEARCH TALK: Cancela TEA: X'].forEach(x => assert.ok(!is_cancelled_title(x), x)); });
t('cancelled event: no change, no finding', () => { var c = ctx(false); c.baseline = false; c.no_event = []; var e = ev('No TNJC — CANCELLED'); c.cal = {getEventById: () => Object.assign(e, {getDescription: () => '', setDescription: function(){}})}; var out = sync_row(row({start: new Date(Date.now() + 5 * 864e5)}), c, start_of_today()); assert.strictEqual(out.finding, undefined); assert.strictEqual(e.title, 'No TNJC — CANCELLED'); assert.strictEqual(patched.length, 0); });
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
// network blips
t('Notion call retries after a network exception', () => { var calls = 0; var saved = UrlFetchApp_stub(() => { calls++; if (calls < 3) throw new Error('Address unavailable'); return {getResponseCode: () => 200, getContentText: () => '{"ok":1}'}; }); Utilities.sleep = function(){}; var r = real_notion_request('get', 'x', null, {notion_token: 't'}); assert.strictEqual(r.ok, 1); assert.strictEqual(calls, 3); });
t('hourly sync emails only after 3 failures in a row', () => { var m = []; send_mail = function(to, subj){ m.push(subj); }; clear_failures('Calendar sync'); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 0); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 1); clear_failures('Calendar sync'); notify_error('Calendar sync', new Error('x'), {tnjc_admin_email: 'a'}, 3); assert.strictEqual(m.length, 1); });
t('other jobs email on the first failure', () => { var m = []; send_mail = function(to, subj){ m.push(subj); }; notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'a'}); assert.strictEqual(m.length, 1); });
// away calendar and error mails
t('busy blocks become away days (end exclusive)', () => assert.deepStrictEqual(JSON.parse(JSON.stringify(busy_to_day_ranges([{start: '2026-12-24T00:00:00Z', end: '2026-12-27T00:00:00Z'}, {start: '2026-11-10T09:00:00Z', end: '2026-11-10T17:00:00Z'}]))), [{from: '2026-12-24', to: '2026-12-26'}, {from: '2026-11-10', to: '2026-11-10'}]));
t('errors go to the TNJC organiser with the tea tsar in cc', () => { var m = []; send_mail = function(to, subj, b, c, o){ m.push([to, o && o.cc]); }; notify_error('Daily maintenance', new Error('x'), {tnjc_admin_email: 'lena@x', admin_email: 'tsar@x'}); assert.deepStrictEqual(m[0], ['lena@x', 'tsar@x']); });
results.join('\\n');
`;
// SECURITY: a web page can call every top-level function of its project, so the page project may only
// contain doGet, token-checked api_* wrappers and authorize
const pageSrc = fs.readdirSync(path.join(__dirname, '..', 'apps-script', 'page')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'page', f), 'utf8')).join('\n');
const pageFns = [...pageSrc.matchAll(/^\s*function\s+(\w+)/gm)].map(m => m[1]);
const extra = pageFns.filter(n => !(n === 'doGet' || n === 'authorize' || /^api_/.test(n)));
const autoApis = [...src.matchAll(/^function (api_\w+)\(/gm)].map(m => m[1]);
const missing = autoApis.filter(n => pageFns.indexOf(n) < 0);
console.log((extra.length || missing.length ? 'FAIL' : 'ok  ') + ' page project exposes only doGet, api_* and authorize' + (extra.length ? ' (extra: ' + extra + ')' : '') + (missing.length ? ' (missing wrappers: ' + missing + ')' : ''));
if (extra.length || missing.length) process.exitCode = 1;
const ctx = vm.createContext({console, Buffer, assert, require_crypto: require('crypto'), Intl});
const out = vm.runInContext(stubs + src + tests, ctx);
console.log(out);
process.exit(out.includes('FAIL') ? 1 : 0);
