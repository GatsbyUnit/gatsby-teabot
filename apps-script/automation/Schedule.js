// Reading the Schedule table of the rota data, and the calendar title formats the old scripts use.

const TZ = 'Europe/London';
const GUEST_PROP = 'Guest speaker';
const ALL_TYPES = ['TNJC', 'MLJC', 'Coffee Cleaning', 'Research Talk', 'Tea Talk', 'Just Tea', 'Leaving Tea', 'External Seminar'];
const PRESENTER_TYPES = ['Research Talk', 'Tea Talk', 'MLJC', 'TNJC'];
const TEA_TYPES = ['Research Talk', 'Tea Talk', 'Just Tea', 'External Seminar', 'Leaving Tea', 'Coffee Cleaning'];
const GUEST_TYPES = ['TNJC', 'MLJC'];
// rotas that are not on the gatsby.tea calendar (coffee: the people on duty get an email every day of their week
// instead, and the site shows who is on); the bot removes the calendar events of their upcoming slots
const OFF_CALENDAR_TYPES = ['Coffee Cleaning'];
function on_calendar(type){ return OFF_CALENDAR_TYPES.indexOf(type) < 0; }
// slots an organiser can cancel by deleting or renaming the calendar event
const CALENDAR_CANCEL_TYPES = PRESENTER_TYPES.concat(['Just Tea']);

// which relations (people) a slot's calendar title shows
function roles_for_type(type){
  if (type === 'TNJC' || type === 'MLJC') return ['Presenter'];
  if (type === 'Coffee Cleaning' || type === 'Just Tea') return ['Tea'];
  return ['Presenter', 'Tea'];
}

function load_rows(type, from_date, to_date, ctx){
  var and = [
    {property: 'Type', select: {equals: type}},
    {property: 'Date', date: {on_or_after: fmt_iso_date(from_date)}}
  ];
  if (to_date) and.push({property: 'Date', date: {on_or_before: fmt_iso_date(to_date)}});
  var pages = notion_query(ctx.constants['notion_talk_db_id'], {and: and}, [{property: 'Date', direction: 'ascending'}], ctx.constants);
  return pages.map(to_row).filter(function(r){ return r.start !== null; });
}

function to_row(page){
  var p = page.properties;
  var date = p['Date'] && p['Date'].date;
  var relation_ids = function(name){
    return (p[name] && p[name].relation ? p[name].relation : []).map(function(r){ return normalise_id(r.id); });
  };
  return {
    id: normalise_id(page.id),
    url: page.url,
    type: p['Type'] && p['Type'].select ? p['Type'].select.name : '',
    title: plain_text(p['Title']),
    description: plain_text(p['Description']),
    start: date ? new Date(date.start) : null,
    end: date && date.end ? new Date(date.end) : null,
    presenter_ids: relation_ids('Presenter'),
    tea_ids: relation_ids('Tea'),
    csnjc: !!(p['CSNJC'] && p['CSNJC'].checkbox),
    water_filter: !!(p['Water filter (coffee only)'] && p['Water filter (coffee only)'].checkbox),
    gcal_id: plain_text(p['GCal ID']).trim(),
    guest: p[GUEST_PROP] ? plain_text(p[GUEST_PROP]).trim() : ''
  };
}

function is_tentative(row){
  return /\[[^\]]*Tentative\]/i.test(row.title);
}

// The format the finalizing scripts create events with. (The old swap-form handler writes slightly
// different variants, e.g. "JUST TEA. TEA: X"; parse_title accepts those too, so they are never rewritten.)
function format_title(row, people){
  var presenters = row.guest ? [row.guest] : names_of(row.presenter_ids, people);
  var tea = names_of(row.tea_ids, people);
  var type = row.type;
  if (type === 'TNJC') return 'TNJC' + (row.csnjc ? ' (CSNJC)' : '') + ': ' + presenters.join(', ');
  if (type === 'MLJC') return 'MLJC: ' + presenters.join(', ');
  if (type === 'Coffee Cleaning') return 'Coffee Duty This Week: ' + tea.join(', ');
  if (type === 'Just Tea') return 'JUST TEA: ' + tea.join(', ');
  if (ALL_TYPES.indexOf(type) >= 0) return type.toUpperCase() + ': ' + presenters.join(', ') + ' TEA: ' + tea.join(', ');
  return null;
}

// Reads names back out of a calendar title: {csnjc, roles: {Presenter: [...], Tea: [...]}}, only the
// roles the title shows. null if the title does not follow any known format.
function parse_title(title, type){
  var t = String(title).trim();
  var m;
  if (type === 'TNJC' || type === 'MLJC'){
    m = t.match(/^(TNJC|MLJC)\s*(\(\s*CSNJC\s*\))?\s*[:\-–]\s*(.*)$/i);
    if (!m || m[1].toUpperCase() !== type) return null;
    return {csnjc: !!m[2], roles: {Presenter: split_names(m[3], true)}};
  }
  if (type === 'Coffee Cleaning'){
    m = t.match(/^Coffee\s+Duty(?:\s+This\s+Week)?\s*[:\-–]\s*(.*)$/i);
    return m ? {csnjc: false, roles: {Tea: split_names(m[1], false)}} : null;
  }
  if (type === 'Just Tea'){
    m = t.match(/^JUST\s+TEA\s*[:.]\s*(?:TEA\s*:\s*)?(.*)$/i);
    return m ? {csnjc: false, roles: {Tea: split_names(m[1], false)}} : null;
  }
  if (ALL_TYPES.indexOf(type) >= 0){
    // organisers relabel talks by hand ("UPGRADE TALK", "ROTATION TALK", ...): any label is fine
    m = t.match(/^TEA\s*:\s*(.*)$/i);
    if (m) return {csnjc: false, roles: {Tea: split_names(m[1], false)}};
    m = t.match(/^([^:]{1,40}?)\s*[:.]\s*(.*?)\s*\bTEA\s*:\s*(.*)$/i);
    if (m) return {csnjc: false, roles: {Presenter: split_names(m[2], true), Tea: split_names(m[3], false)}};
    m = t.match(/^([^:]{1,40}?)\s*:\s*(.*)$/);
    return m ? {csnjc: false, roles: {Presenter: split_names(m[2], true)}} : null;
  }
  return null;
}

// events marked as cancelled by hand are left alone (no change, no email)
// A label written by hand ("UPGRADE TALK: …", "ROTATION TALK: …") survives when the bot rewrites the names
// of a talk's event (after a swap or an edit on the site).
function keep_label(current, expected, type){
  if (!current || ['Research Talk', 'Tea Talk', 'Leaving Tea', 'External Seminar'].indexOf(type) < 0) return expected;
  var label = String(current).trim().match(/^([^:]{1,40}?)\s*:/);
  var own = String(expected).match(/^([^:]{1,40}?)\s*:/);
  if (!label || !own || /^TEA$/i.test(label[1]) || is_cancelled_title(current)) return expected;
  return label[1] + expected.slice(own[1].length);
}

const CANCELLED_TITLE = 'Cancelled';

// The calendar title of a cancelled slot: "No TNJC — CANCELLED", "TEA TALK: CANCELLED TEA: Lena Weber".
function cancelled_title(row, people){
  if (row.type === 'TNJC' || row.type === 'MLJC') return 'No ' + row.type + ' — CANCELLED';
  var tea = names_of(row.tea_ids, people);
  return row.type.toUpperCase() + ': CANCELLED' + (tea.length ? ' TEA: ' + tea.join(', ') : '');
}

// cancelled titles, also misspelt (canceled, cancelld, canclled, cancellation…), "called off", "No TNJC/talk/tea…";
// the same pattern is in the Cron Jobs (Utilities_TalkReminder.js), the site (rotas/app.js, rotas/edit.js) and the
// MCP server; tests/run.js checks the copies agree
const CANCELLED_TITLE_RE = /\bcan?c+[ae]?l+(?:e?d|ation|ing)?\b|\bcalled\s+off\b|\bno\s+(?:tnjc|mljc|csnjc|jc|talk|research\s+talk|tea|seminar|journal\s+club)\b/i;

// one emoji per kind of slot ("Tea": tea duty), the same on the site (rotas/app.js), the tea page (index.html) and
// in the bot's email subjects; tests/run.js checks the copies agree
const TYPE_EMOJI = {"Research Talk": "🧪", "Tea Talk": "🎤", "External Seminar": "🎓", "Leaving Tea": "👋", "Just Tea": "🫖", "MLJC": "🤖", "TNJC": "🧠", "CSNJC": "🧠", "Coffee Cleaning": "☕", "Tea": "🍵"};

// the emoji for what someone does in a slot: tea duty 🍵 (coffee ☕), else the slot's own
function duty_emoji(row, role){
  if (row.type === 'Coffee Cleaning') return TYPE_EMOJI['Coffee Cleaning'];
  if (role === 'tea' && row.type !== 'Just Tea') return TYPE_EMOJI['Tea'];
  return TYPE_EMOJI[row.csnjc ? 'CSNJC' : row.type] || '';
}

function with_emoji(row, role, subject){
  var e = duty_emoji(row, role);
  return e ? e + ' ' + subject : subject;
}

function is_cancelled_title(title){
  return CANCELLED_TITLE_RE.test(String(title));
}

function split_names(s, strip_guest){
  return String(s).split(/\s*(?:,|&|\/|\band\b)\s*/i)
    .map(function(n){ return strip_guest ? n.replace(/^guest(\s+speaker)?\s*[:\-–]?\s*/i, '').trim() : n.trim(); })
    .filter(function(n){ return n !== ''; });
}

function notion_role_names(row, role, people){
  if (role === 'Presenter') return row.guest ? row.guest.split(/\s*,\s*/) : names_of(row.presenter_ids, people);
  return names_of(row.tea_ids, people);
}

// the calendar title shows the same people as the slot, whatever the exact formatting
function titles_agree(parsed, row, people){
  return Object.keys(parsed.roles).every(function(role){
    return same_names(parsed.roles[role], notion_role_names(row, role, people));
  });
}

function same_names(a, b){
  var norm = function(list){ return list.map(normalise_name).sort().join('|'); };
  return norm(a) === norm(b);
}

function notion_fingerprint(row){
  return JSON.stringify([row.presenter_ids.slice().sort(), row.tea_ids.slice().sort(), row.guest, row.csnjc]);
}

function notion_text_fingerprint(row){
  return JSON.stringify([is_tentative(row) ? '' : row.title || '', row.description || '']);
}

function start_of_today(){
  var s = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-');
  return new Date(+s[0], +s[1] - 1, +s[2]);
}

function add_days(date, n){
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function fmt_iso_date(date){
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

function fmt_day(date){
  return Utilities.formatDate(date, TZ, 'EEE d MMM yyyy');
}

function fmt_time(date){
  return Utilities.formatDate(date, TZ, 'HH:mm');
}
