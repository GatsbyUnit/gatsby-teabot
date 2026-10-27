// "Gatsby Tea Automation log" spreadsheet in the bot's Drive: what the bot did (or would do) and the
// currently open calendar/Notion mismatches.

const LOG_TAB = 'Log';
const MISMATCH_TAB = 'Mismatches';

function ensure_log_sheet(){
  var id = PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.create('Gatsby Tea Automation log');
  var log = ss.getSheets()[0].setName(LOG_TAB);
  log.appendRow(['When', 'Job', 'Mode', 'Type', 'Slot', 'Action', 'Detail']);
  log.setFrozenRows(1);
  ss.insertSheet(MISMATCH_TAB).appendRow(['Checked', 'Type', 'Slot', 'Calendar title', 'Notion says', 'Notion page']);
  set_setting('LOG_SHEET_ID', ss.getId());
  return ss;
}

function log_row(ctx, job, type, date, action, detail){
  var mode = ctx.settings.dry_run ? 'dry run' : (type && !is_live(ctx, type) ? 'watching' : 'live');
  ctx.log.getSheetByName(LOG_TAB).appendRow([new Date(), job, mode, type, date ? fmt_day(date) : '', action, detail]);
}

function write_mismatches(mismatches, ctx){
  var sheet = ctx.log.getSheetByName(MISMATCH_TAB);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
  if (mismatches.length === 0) return;
  var now = new Date();
  sheet.getRange(2, 1, mismatches.length, 6).setValues(mismatches.map(function(m){
    return [now, m.row.type, fmt_day(m.row.start), m.actual, m.expected, m.row.url];
  }));
}
