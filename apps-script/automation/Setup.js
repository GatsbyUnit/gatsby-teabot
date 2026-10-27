// One-off and admin functions, run by hand from the Apps Script editor.
//
//   backup_all()                  snapshot of calendar, Notion and sheets into a new spreadsheet
//   setup()                       first run: authorises the script, takes a backup, adds the Automation tabs to
//                                 the constants sheet, creates the log sheet and the (closed) swap form,
//                                 installs triggers, does one dry-run sync
// Everyday switches (dry run / pause, which rotas) are cells in the constants sheet's Automation tab.
// One-off fixes: add a RunOnce.js with a single function, commit and deploy (deploy/deploy.py), open that
// file in the editor and Run, then delete it, commit and deploy again (the git history keeps what was run).
//   show_status()                 prints settings, links and installed triggers
//   add_guest_speaker_property()  adds the "Guest speaker" text field to the Notion Schedule database
//   go_live()                     DRY_RUN off: the sync starts writing to Notion / Calendar
//   close_old_forms()             closes the old swap, title / Zoom and change-email forms (they point to the page)
//   pause()                       DRY_RUN back on (kill switch); remove_triggers() stops everything

function setup(){
  backup_all();
  ensure_settings_tabs();
  ensure_log_sheet();
  install_triggers();
  run_sync();
  show_status();
}

function install_triggers(){
  remove_triggers();
  ScriptApp.newTrigger('run_sync').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('daily_maintenance').timeBased().everyDays(1).atHour(5).create();
  ScriptApp.newTrigger('run_daily_reminders').timeBased().everyDays(1).atHour(8).create();
}

function remove_triggers(){
  var ours = ['run_sync', 'refresh_swap_form', 'daily_maintenance', 'run_daily_reminders', 'on_swap_submit'];
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (ours.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

function add_guest_speaker_property(){
  var constants = get_global_constants();
  var props = {};
  props[GUEST_PROP] = {rich_text: {}};
  notion_request('patch', 'databases/' + constants['notion_talk_db_id'], {properties: props}, constants);
  Logger.log('Added "' + GUEST_PROP + '" to the Schedule database.');
}

function go_live(){
  set_setting('DRY_RUN', 'FALSE');
  Logger.log('DRY_RUN is off. The next hourly sync writes to Notion and the calendar for: ' + get_settings().SYNC_TYPES);
}

function pause(){
  set_setting('DRY_RUN', 'TRUE');
  Logger.log('DRY_RUN is on again: the bot only watches and reports.');
}

function show_status(){
  var s = get_settings();
  Logger.log('Mode: ' + (s.dry_run ? 'DRY RUN (watching only)' : 'LIVE'));
  Logger.log('Watched: ' + s.SYNC_TYPES + ' | live: ' + s.LIVE_TYPES + ' | organiser reminders: ' + s.REMINDER_TYPES);
  Logger.log('Settings: ' + SpreadsheetApp.openById(CONST_SHEET_ID).getUrl() + ' (tabs "' + SETTINGS_TAB + '" and "' + REMINDERS_TAB + '")');
  if (s.LOG_SHEET_ID) Logger.log('Log: ' + SpreadsheetApp.openById(s.LOG_SHEET_ID).getUrl());
  if (s.LAST_BACKUP_ID) Logger.log('Last backup: ' + SpreadsheetApp.openById(s.LAST_BACKUP_ID).getUrl());
  if (s.PAGE_URL) Logger.log('Tea page: ' + s.PAGE_URL);
  ScriptApp.getProjectTriggers().forEach(function(t){
    Logger.log('Trigger: ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')');
  });
}

// daily: personal-page links for new people
function daily_maintenance(){
  var constants = get_global_constants();
  try {
    ensure_tokens(constants);
  } catch (err) {
    notify_error('Daily maintenance', err, constants);
    throw err;
  }
}

// Stops the old Google Forms (swap, title / Zoom request, change email) from taking responses; they now
// point people to the tea page, which does all of it.
const OLD_FORM_RESPONSE_SHEETS = {
  'swap': '1AwdUBzdb5aDjs6koyd3seyRuQaaxDZmbpu1Yc5mvgno',
  'title / Zoom request': '1XeSjwN9z9WnkW4_4E8Cocbr-bmGHIMwEPfKshbxKOCw',
  'change email': '1r3d9RVVr_yNcB1qx9sVP05j6Z7iWU1kXIbeVOXvuXlo'
};

function close_old_forms(){
  var url = page_url(get_settings());
  Object.keys(OLD_FORM_RESPONSE_SHEETS).forEach(function(name){
    var form = FormApp.openByUrl(SpreadsheetApp.openById(OLD_FORM_RESPONSE_SHEETS[name]).getFormUrl());
    form.setCustomClosedFormMessage('This form has been replaced by the tea page, where you can swap your slots, add your talk title, request Zoom and set your away dates: ' + url);
    form.setAcceptingResponses(false);
    Logger.log('Closed the old ' + name + ' form (form id ' + form.getId() + '): ' + form.getPublishedUrl());
  });
}
