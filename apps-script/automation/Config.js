// Where things live:
//  - the shared constants sheet, first tab: IDs, emails and the Notion token (read by the old scripts too)
//  - the same spreadsheet, "Automation" tab: this project's switches, one row per setting with a
//    description; "Automation reminders" tab: dated reminders for organisers. Edit them there.
//  - Script Properties: only things the script manages itself (IDs of the form and log it created,
//    last-seen calendar state). Nobody needs to edit these.

const CONST_SHEET_ID = '1ZH80lgLYGEfc4d_lp4awKlKyMEUqnbMS122Cgf4wyl4';
const SETTINGS_TAB = 'Automation';
const REMINDERS_TAB = 'Automation reminders';

// response sheet of the "Edit Talk Title / Description" form, used to find the form itself
const TITLE_FORM_RESPONSE_SHEET_ID = '1XeSjwN9z9WnkW4_4E8Cocbr-bmGHIMwEPfKshbxKOCw';

// old swap form, used for links until the dropdown form is live
const OLD_SWAP_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdhhA06B3jW4vdns7FTCop02oyIrW40PzaouHNrSN09aWn49Q/viewform';
const OLD_SWAP_FORM_ENTRIES = { date: 'entry.1526923741', slot_type: 'entry.129875296', duty: 'entry.918272115' };

// [key, default, description shown in the Automation tab]
const SETTINGS = [
  ['DRY_RUN', 'TRUE', 'TRUE = the bot only watches and emails what it would do. FALSE = it updates Notion and the calendar. Set back to TRUE to pause it at any time.'],
  ['SYNC_TYPES', 'TNJC', 'Rotas the bot watches: it compares calendar and Notion and emails the rota organiser about differences (comma-separated Notion types, e.g. TNJC, MLJC, Coffee Cleaning).'],
  ['LIVE_TYPES', 'TNJC', 'Of the watched rotas, the ones the bot may actually change (fix titles, record hand edits, add links). The others are only reported. Ignored while DRY_RUN is TRUE.'],
  ['REMINDER_TYPES', 'TNJC', 'Rotas whose organiser gets a Monday reminder when the schedule is running out.'],
  ['SCHEDULE_WARNING_DAYS', '21', 'Send that reminder when the schedule ends within this many days.'],
  ['LOOKBACK_DAYS', '60', 'How far back hand edits of past calendar events are copied into Notion (keeps the rota fair).'],
  ['SWAP_HORIZON_DAYS', '120', 'How far ahead the swap form lists slots.'],
  ['LINKS_IN_EVENTS', 'TRUE', 'Add "swap your slot" and "edit title" links to upcoming calendar events.'],
  ['GO_LIVE_ON', '', 'Optional date (YYYY-MM-DD). While DRY_RUN is TRUE, the bot switches itself live on this date and emails the organiser. Clear it to cancel.'],
  ['HANDBOOK_URL', '', 'Link to the organiser handbook, included in reminder emails.'],
  ['PAGE_URL', '', 'Address of the personal tea page (set when it is deployed; also read by the reminder emails of the old Cron Jobs).'],
  ['FAVICON_URL', '', 'Optional browser-tab icon of the tea page: an image address ending in .png (a Drive image shared by link: https://lh3.googleusercontent.com/d/<file id>#.png). Kept here rather than in the public repo.']
];

// managed by the script itself, kept in Script Properties
const MACHINE_KEYS = ['LOG_SHEET_ID', 'SWAP_FORM_ID', 'LAST_BACKUP_ID'];

var settings_cache = null;

function get_global_constants(){
  var sheet = SpreadsheetApp.openById(CONST_SHEET_ID).getSheets()[0];
  var constants = {
    'admin_email': sheet.getRange(2, 2).getValue(),
    'mljc_admin_email': sheet.getRange(3, 2).getValue(),
    'tnjc_admin_email': sheet.getRange(4, 2).getValue(),
    'coffee_admin_email': sheet.getRange(5, 2).getValue(),
    'unit_wide_email': sheet.getRange(7, 2).getValue(),
    'mljc_email': sheet.getRange(8, 2).getValue(),
    'tnjc_email': sheet.getRange(9, 2).getValue(),
    'csnjc_email': sheet.getRange(10, 2).getValue(),
    'gatsby_zoom_link': sheet.getRange(11, 2).getValue(),
    'identity_mapping_id': sheet.getRange(19, 2).getValue(),
    'google_calendar_id': sheet.getRange(20, 2).getValue(),
    'notion_token': sheet.getRange(21, 2).getValue(),
    'notion_people_db_id': sheet.getRange(22, 2).getValue(),
    'notion_rota_rules_db_id': sheet.getRange(23, 2).getValue(),
    'notion_talk_db_id': sheet.getRange(24, 2).getValue(),
    'notion_site_url': sheet.getRange(25, 2).getValue(),
    'coffee_email': sheet.getRange(26, 2).getValue(),
    'gatsby_admin_email': sheet.getRange(28, 2).getValue(),   // unit admin (Zoom set-up)
  };
  return constants;
}

function get_settings(){
  if (settings_cache) return settings_cache;
  var tab = read_settings_tab();
  var props = PropertiesService.getScriptProperties().getProperties();
  var s = {};
  SETTINGS.forEach(function(row){
    var k = row[0];
    s[k] = (k in tab && String(tab[k]).trim() !== '') ? String(tab[k]).trim() : row[1];
  });
  MACHINE_KEYS.forEach(function(k){ s[k] = props[k] || ''; });
  s.dry_run = s.DRY_RUN.toLowerCase() !== 'false';
  s.sync_types = split_list(s.SYNC_TYPES);
  s.live_types = split_list(s.LIVE_TYPES);
  s.reminder_types = split_list(s.REMINDER_TYPES);
  s.lookback_days = parseInt(s.LOOKBACK_DAYS, 10);
  s.swap_horizon_days = parseInt(s.SWAP_HORIZON_DAYS, 10);
  s.schedule_warning_days = parseInt(s.SCHEDULE_WARNING_DAYS, 10);
  s.links_in_events = s.LINKS_IN_EVENTS.toLowerCase() === 'true';
  s.date_reminders = read_reminders_tab();
  settings_cache = s;
  return s;
}

function set_setting(key, value){
  settings_cache = null;
  if (MACHINE_KEYS.indexOf(key) >= 0){
    PropertiesService.getScriptProperties().setProperty(key, String(value));
    return;
  }
  var sheet = ensure_settings_tabs().getSheetByName(SETTINGS_TAB);
  var keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function(r){ return r[0]; });
  var i = keys.indexOf(key);
  if (i < 0) throw new Error('Unknown setting ' + key);
  sheet.getRange(i + 1, 2).setValue(value);
}

function read_settings_tab(){
  var sheet = SpreadsheetApp.openById(CONST_SHEET_ID).getSheetByName(SETTINGS_TAB);
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function(r){ if (r[0]) out[r[0]] = r[1]; });
  return out;
}

// rows of {month, day, type, subject, body}; blank rows ignored
function read_reminders_tab(){
  var sheet = SpreadsheetApp.openById(CONST_SHEET_ID).getSheetByName(REMINDERS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues()
    .filter(function(r){ return r[0] && r[1] && r[3]; })
    .map(function(r){ return {month: Number(r[0]), day: Number(r[1]), type: String(r[2]).trim() || 'TNJC', subject: String(r[3]), body: String(r[4])}; });
}

// creates the two tabs in the constants spreadsheet if missing, and adds any settings that are new
function ensure_settings_tabs(){
  var ss = SpreadsheetApp.openById(CONST_SHEET_ID);
  var sheet = ss.getSheetByName(SETTINGS_TAB);
  if (!sheet){
    sheet = ss.insertSheet(SETTINGS_TAB, ss.getSheets().length);
    sheet.appendRow(['Setting', 'Value', 'What it does']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 190);
    sheet.setColumnWidth(2, 140);
    sheet.setColumnWidth(3, 620);
  }
  var existing = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function(r){ return r[0]; });
  SETTINGS.forEach(function(row){
    if (existing.indexOf(row[0]) < 0) sheet.appendRow(row);
  });
  sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setNumberFormat('@');  // keep TRUE/FALSE and lists as typed

  var rem = ss.getSheetByName(REMINDERS_TAB);
  if (!rem){
    rem = ss.insertSheet(REMINDERS_TAB, ss.getSheets().length);
    rem.appendRow(['Month', 'Day', 'Rota (organiser who gets it)', 'Subject', 'Text']);
    rem.getRange(1, 1, 1, 5).setFontWeight('bold');
    rem.setFrozenRows(1);
    rem.setColumnWidth(4, 320);
    rem.setColumnWidth(5, 620);
    DEFAULT_DATE_REMINDERS.forEach(function(r){ rem.appendRow([r.month, r.day, r.type, r.subject, r.body]); });
  }
  settings_cache = null;
  return ss;
}

// whether the bot may write for this rota right now
function is_live(ctx, type){
  return !ctx.settings.dry_run && ctx.settings.live_types.indexOf(type) >= 0;
}

function split_list(str){
  return String(str).split(',').map(function(x){ return x.trim(); }).filter(function(x){ return x !== ''; });
}

function admin_email_for_type(type, constants){
  if (type === 'TNJC') return constants['tnjc_admin_email'];
  if (type === 'MLJC') return constants['mljc_admin_email'];
  if (type === 'Coffee Cleaning') return constants['coffee_admin_email'];
  return constants['admin_email'];
}
