// Reading the Notion Schedule database, and the calendar title formats the old scripts use.

const TZ = 'Europe/London';
const GUEST_PROP = 'Guest speaker';
const ALL_TYPES = ['TNJC', 'MLJC', 'Coffee Cleaning', 'Research Talk', 'Tea Talk', 'Just Tea', 'Leaving Tea', 'External Seminar'];
const PRESENTER_TYPES = ['Research Talk', 'Tea Talk', 'MLJC', 'TNJC'];
const TEA_TYPES = ['Research Talk', 'Tea Talk', 'Just Tea', 'External Seminar', 'Leaving Tea', 'Coffee Cleaning'];
const GUEST_TYPES = ['TNJC', 'MLJC'];

// which Notion relations a slot's calendar title shows
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
function is_cancelled_title(title){
  return /\bcancel(?:l?ed)?\b|\bno\s+(?:tnjc|mljc|csnjc|talk|tea|journal club)\b/i.test(String(title));
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

// the calendar title shows the same people as Notion, whatever the exact formatting
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
