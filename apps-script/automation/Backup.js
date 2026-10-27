// Snapshot of everything the bot touches, into a new spreadsheet in the bot's Drive:
// calendar events, the Notion databases (flattened + raw JSON), the constants sheet (token masked),
// the identity sheet and the form-response sheets. setup() runs it before doing anything else.

const RESPONSE_SHEETS = {
  'Change presenter responses': '1AwdUBzdb5aDjs6koyd3seyRuQaaxDZmbpu1Yc5mvgno',
  'Title-desc-zoom responses': '1XeSjwN9z9WnkW4_4E8Cocbr-bmGHIMwEPfKshbxKOCw',
  'Change email responses': '1r3d9RVVr_yNcB1qx9sVP05j6Z7iWU1kXIbeVOXvuXlo'
};
const CELL_LIMIT = 49000;

function backup_all(){
  var constants = get_global_constants();
  var ss = SpreadsheetApp.create('Gatsby Tea backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
  var summary = [['What', 'Rows', 'Note']];

  // calendar
  var cal = CalendarApp.getCalendarById(constants['google_calendar_id']);
  var events = cal.getEvents(new Date(2020, 0, 1), new Date(2029, 0, 1));
  var cal_rows = events.map(function(e){
    return [e.getId(), e.getTitle(), e.isAllDayEvent() ? 'all day' : '', e.getStartTime(), e.getEndTime(),
            cut(e.getDescription()), e.getLocation(), e.getCreators().join(', '), e.getDateCreated(), e.getLastUpdated()];
  });
  write_backup_tab(ss, 'Calendar', ['Event ID', 'Title', 'All day', 'Start', 'End', 'Description', 'Location', 'Creators', 'Created', 'Last updated'], cal_rows);
  summary.push(['Calendar ' + constants['google_calendar_id'], cal_rows.length, '2020 to 2028']);

  // Notion databases
  var dbs = {'Notion Schedule': constants['notion_talk_db_id'], 'Notion People': constants['notion_people_db_id'], 'Notion Rota rules': constants['notion_rota_rules_db_id']};
  Object.keys(dbs).forEach(function(name){
    if (!dbs[name]) return;
    var pages = notion_query(dbs[name], null, null, constants);
    var keys = {};
    pages.forEach(function(p){ Object.keys(p.properties).forEach(function(k){ keys[k] = true; }); });
    keys = Object.keys(keys).sort();
    var rows = pages.map(function(p){
      return [p.id, p.url, p.created_time, p.last_edited_time]
        .concat(keys.map(function(k){ return cut(flatten_notion_value(p.properties[k])); }))
        .concat([cut(JSON.stringify(p.properties))]);
    });
    write_backup_tab(ss, name, ['Page ID', 'URL', 'Created', 'Last edited'].concat(keys).concat(['Raw JSON']), rows);
    summary.push([name, rows.length, '']);
  });

  // sheets
  var const_values = SpreadsheetApp.openById(CONST_SHEET_ID).getSheets()[0].getDataRange().getValues().map(function(r){
    return r.map(function(v){ return /^(secret_|ntn_)/.test(String(v)) ? '(Notion token, masked)' : v; });
  });
  write_backup_tab(ss, 'Constants sheet', null, const_values);
  summary.push(['Constants sheet', const_values.length, 'Notion token masked']);
  copy_spreadsheet_tabs(ss, 'Identity', constants['identity_mapping_id'], summary);
  Object.keys(RESPONSE_SHEETS).forEach(function(name){ copy_spreadsheet_tabs(ss, name, RESPONSE_SHEETS[name], summary); });

  var first = ss.getSheets()[0];
  first.setName('Summary');
  first.getRange(1, 1, summary.length, 3).setValues(summary);
  ss.setActiveSheet(first);
  ss.moveActiveSheet(1);
  set_setting('LAST_BACKUP_ID', ss.getId());
  Logger.log('Backup: ' + ss.getUrl());
  summary.forEach(function(r){ Logger.log(r.join(' | ')); });
  return ss;
}

function copy_spreadsheet_tabs(ss, prefix, id, summary){
  try {
    SpreadsheetApp.openById(id).getSheets().forEach(function(sheet){
      var values = sheet.getDataRange().getValues().map(function(r){ return r.map(cut); });
      var name = prefix + (sheet.getIndex() > 1 ? ' – ' + sheet.getName() : '');
      write_backup_tab(ss, name, null, values);
      summary.push([name, values.length, '']);
    });
  } catch (e) {
    summary.push([prefix, 0, 'could not read: ' + e]);
  }
}

function write_backup_tab(ss, name, header, rows){
  var sheet = ss.insertSheet(name.slice(0, 99));
  var all = header ? [header].concat(rows) : rows;
  if (all.length === 0) return;
  var width = Math.max.apply(null, all.map(function(r){ return r.length; }));
  all = all.map(function(r){ while (r.length < width) r.push(''); return r; });
  sheet.getRange(1, 1, all.length, width).setValues(all);
  if (header) sheet.setFrozenRows(1);
}

function flatten_notion_value(v){
  if (!v) return '';
  switch (v.type){
    case 'title': case 'rich_text': return plain_text(v);
    case 'checkbox': return v.checkbox ? 'TRUE' : 'FALSE';
    case 'select': return v.select ? v.select.name : '';
    case 'multi_select': return v.multi_select.map(function(o){ return o.name; }).join(', ');
    case 'status': return v.status ? v.status.name : '';
    case 'date': return v.date ? v.date.start + (v.date.end ? ' → ' + v.date.end : '') : '';
    case 'relation': return v.relation.map(function(r){ return r.id; }).join(', ');
    case 'people': return v.people.map(function(p){ return p.name || p.id; }).join(', ');
    case 'formula': return v.formula ? String(v.formula[v.formula.type]) : '';
    case 'rollup': return JSON.stringify(v.rollup);
    case 'url': return v.url || '';
    case 'email': return v.email || '';
    case 'phone_number': return v.phone_number || '';
    case 'number': return v.number === null ? '' : v.number;
    case 'files': return v.files.map(function(f){ return f.name; }).join(', ');
    case 'created_time': return v.created_time;
    case 'last_edited_time': return v.last_edited_time;
    default: return JSON.stringify(v[v.type]);
  }
}

function cut(v){
  if (typeof v !== 'string') return v;
  return v.length > CELL_LIMIT ? v.slice(0, CELL_LIMIT) + ' …(truncated)' : v;
}
