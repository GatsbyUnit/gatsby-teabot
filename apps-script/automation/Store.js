// Where the rota data lives: the Notion databases (Schedule, People, Rota rules) or, after the move, the
// "Gatsby Rotas data" sheet in the bot's Drive, one tab per database. The rest of the code keeps speaking
// Notion's API (notion_request in Notion.js): with STORE = sheet (Automation tab) the same calls are answered
// from the sheet, in Notion's format, so nothing else had to change. The Cron Jobs come through here too
// (store_fetch).
//
// The move, step by step (docs/next-steps.md, "Moving off Notion"):
//   1. store_import_from_notion()  copies all three databases into the sheet (run it from the editor). From then
//                                  on every change written to Notion is copied into the sheet as well.
//   2. store_check()               compares the two and logs any difference.
//   3. STORE = sheet               the sheet is read from now on. With NOTION_MIRROR = TRUE every change still goes
//                                  to Notion first, so STORE = notion switches back without losing anything.
//
// Sheet layout: a header row; columns id, archived, created, edited, icon, then one per Notion property (dates
// take two: "<name>" and "<name> end"; relations hold person/slot ids, comma-separated). Everything is stored
// as plain text. The Schema tab keeps each database's property types and choices.

const STORE_TABS = {notion_talk_db_id: 'Schedule', notion_people_db_id: 'People', notion_rota_rules_db_id: 'Rota rules'};
const STORE_META = ['id', 'archived', 'created', 'edited', 'icon'];
const STORE_TYPES = ['title', 'rich_text', 'select', 'checkbox', 'date', 'relation', 'url', 'number', 'email', 'phone_number'];
var store_cache = null;  // what this run has read of the sheet: {ss, schema, tabs (read when needed), where: id -> row}

function store_mode(){
  return String(get_settings().STORE || 'notion').trim().toLowerCase() === 'sheet' ? 'sheet' : 'notion';
}

function store_spreadsheet(create){
  var id = PropertiesService.getScriptProperties().getProperty('STORE_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  if (!create) return null;
  var ss = SpreadsheetApp.create('Gatsby Rotas data');
  set_setting('STORE_SHEET_ID', ss.getId());
  return ss;
}

// which tab holds this Notion database
function store_tab_of(db_id, constants){
  var want = normalise_id(db_id);
  var key = Object.keys(STORE_TABS).filter(function(k){ return normalise_id(constants[k] || '') === want; })[0];
  if (!key) throw new Error('The rota data sheet does not know the database ' + db_id + '.');
  return STORE_TABS[key];
}

// ---- reading the sheet ----

// the sheet and its schema; tabs are read when first needed, once per run
function store_load(constants){
  if (store_cache) return store_cache;
  var ss = store_spreadsheet(false);
  if (!ss) throw new Error('There is no rota data sheet yet: run store_import_from_notion() first.');
  var schema = {};
  var stab = ss.getSheetByName('Schema');
  stab.getRange(1, 1, stab.getLastRow(), 3).getValues().forEach(function(r){ if (r[0]) schema[r[0]] = {db: String(r[1]), properties: JSON.parse(r[2])}; });
  store_cache = {ss: ss, schema: schema, tabs: {}, where: {}, constants: constants};
  return store_cache;
}

function store_tab(s, name){
  if (s.tabs[name]) return s.tabs[name];
  var sheet = s.ss.getSheetByName(name);
  var values = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues() : [[]];
  var tab = {name: name, sheet: sheet, header: values[0].map(String), col: {}, pages: [],
             rows: values.slice(1).map(function(r){ return r.map(function(v){ return v === null ? '' : String(v); }); })};
  tab.header.forEach(function(h, i){ tab.col[h] = i; });
  tab.rows.forEach(function(r, i){ if (r[0]) s.where[r[0]] = {tab: name, i: i}; });
  s.tabs[name] = tab;
  return tab;
}

// the row as a Notion page, made once per run
function store_page_at(s, tab, i){
  return tab.pages[i] || (tab.pages[i] = store_page(tab, tab.rows[i], s));
}

function store_rt(text){
  return text ? [{type: 'text', text: {content: text, link: null}, plain_text: text, href: null,
                  annotations: {bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default'}}] : [];
}

// one row -> a Notion page
function store_page(tab, row, store){
  var c = function(h){ var i = tab.col[h]; return i == null ? '' : row[i]; };
  var props = store.schema[tab.name].properties;
  var out = {};
  Object.keys(props).forEach(function(name){
    var t = props[name].type, v = c(name), p = {id: props[name].id || name, type: t};
    if (t === 'title' || t === 'rich_text') p[t] = store_rt(v);
    else if (t === 'select') p.select = v ? {name: v, color: 'default'} : null;
    else if (t === 'checkbox') p.checkbox = v === 'TRUE' || v === 'true';
    else if (t === 'date') p.date = v ? {start: v, end: c(name + ' end') || null, time_zone: null} : null;
    else if (t === 'relation'){ p.relation = v ? v.split(',').map(function(id){ return {id: hyphenate_id(id.trim())}; }) : []; p.has_more = false; }
    else if (t === 'number') p.number = v === '' ? null : Number(v);
    else p[t] = v || null;
    out[name] = p;
  });
  var id = c('id');
  return {object: 'page', id: hyphenate_id(id), created_time: c('created'), last_edited_time: c('edited'), archived: c('archived') === 'TRUE',
          in_trash: c('archived') === 'TRUE', url: 'https://www.notion.so/' + id, icon: c('icon') ? JSON.parse(c('icon')) : null,
          parent: {type: 'database_id', database_id: hyphenate_id(store.schema[tab.name].db)}, properties: out};
}

// Notion property values (as Notion sends or receives them) -> the cells of a row
function store_cells(tab, props_in, row, store){
  var props = store.schema[tab.name].properties;
  var set = function(h, v){ var i = tab.col[h]; if (i != null) row[i] = v; };
  Object.keys(props_in || {}).forEach(function(name){
    var def = props[name], v = props_in[name];
    if (!def || v == null) return;
    var t = def.type;
    if (t === 'title' || t === 'rich_text'){
      var parts = v[t] || v.title || v.rich_text || [];
      set(name, parts.map(function(x){ return x.plain_text != null ? x.plain_text : (x.text && x.text.content) || ''; }).join(''));
    } else if (t === 'select') set(name, v.select ? v.select.name : '');
    else if (t === 'checkbox') set(name, v.checkbox ? 'TRUE' : 'FALSE');
    else if (t === 'date'){ set(name, v.date ? v.date.start || '' : ''); set(name + ' end', v.date ? v.date.end || '' : ''); }
    else if (t === 'relation') set(name, (v.relation || []).map(function(r){ return normalise_id(r.id); }).join(','));
    else if (t === 'number') set(name, v.number == null ? '' : String(v.number));
    else if (STORE_TYPES.indexOf(t) >= 0) set(name, v[t] == null ? '' : String(v[t]));
  });
  return row;
}

function store_write_row(tab, i){
  tab.pages[i] = null;
  tab.sheet.getRange(i + 2, 1, 1, tab.header.length).setNumberFormat('@').setValues([tab.rows[i]]);
}

// ---- answering Notion's API from the sheet ----

// method, path and payload as for api.notion.com/v1/; the answer as Notion gives it
function store_request(method, path, payload, constants){
  method = String(method).toLowerCase();
  var m;
  if (method === 'post' && (m = path.match(/^databases\/([\w-]+)\/query$/))) return store_query(m[1], payload || {}, constants);
  if (method === 'get' && (m = path.match(/^databases\/([\w-]+)$/))) return store_database(m[1], constants);
  if (method === 'get' && (m = path.match(/^pages\/([\w-]+)$/))) return store_get(m[1], constants);
  // changes: to Notion first while it is mirrored (it hands out the ids of new pages), then here
  if (store_mirrored()){
    try {
      var out = notion_http(method, path, payload, constants);
      store_mirror(out, constants);
      return out.object === 'page' ? store_get(out.id, constants) : out;
    } catch (e) {
      Logger.log('Notion mirror failed, writing the sheet only: ' + e);
    }
  }
  if (method === 'patch' && (m = path.match(/^pages\/([\w-]+)$/))) return store_patch(m[1], payload || {}, constants);
  if (method === 'post' && path === 'pages') return store_create(payload || {}, constants);
  if (method === 'patch' && (m = path.match(/^databases\/([\w-]+)$/))) return store_alter(m[1], payload || {}, constants);
  throw new Error('The rota data sheet cannot answer ' + method + ' ' + path + '.');
}

function store_mirrored(){
  return String(get_settings().NOTION_MIRROR || 'TRUE').trim().toUpperCase() !== 'FALSE';
}

function store_find(id, constants){
  var s = store_load(constants);
  id = normalise_id(id);
  var names = ['Schedule', 'People', 'Rota rules'];
  for (var k = 0; k < names.length && !s.where[id]; k++) store_tab(s, names[k]);
  var hit = s.where[id];
  if (!hit) throw new Error('Notion get pages/' + id + ' failed (404): not in the rota data sheet');
  return {s: s, tab: s.tabs[hit.tab], i: hit.i};
}

function store_get(id, constants){
  var f = store_find(id, constants);
  return store_page_at(f.s, f.tab, f.i);
}

function store_patch(id, payload, constants){
  var f = store_find(id, constants);
  var row = f.tab.rows[f.i];
  store_cells(f.tab, payload.properties, row, f.s);
  if ('archived' in payload || 'in_trash' in payload) row[f.tab.col['archived']] = (payload.archived || payload.in_trash) ? 'TRUE' : '';
  row[f.tab.col['edited']] = new Date().toISOString();
  store_write_row(f.tab, f.i);
  return store_page_at(f.s, f.tab, f.i);
}

function store_create(payload, constants, id){
  var s = store_load(constants);
  var tab = store_tab(s, store_tab_of(payload.parent.database_id, constants));
  var row = tab.header.map(function(){ return ''; });
  var now = new Date().toISOString();
  row[0] = id || Utilities.getUuid().replace(/-/g, '');
  row[tab.col['created']] = now;
  row[tab.col['edited']] = now;
  if (payload.icon) row[tab.col['icon']] = JSON.stringify(payload.icon);
  store_cells(tab, payload.properties, row, s);
  tab.rows.push(row);
  s.where[row[0]] = {tab: tab.name, i: tab.rows.length - 1};
  store_write_row(tab, tab.rows.length - 1);
  return store_page(tab, row, s);
}

function store_database(db_id, constants){
  var s = store_load(constants);
  var name = store_tab_of(db_id, constants);
  var props = s.schema[name].properties, out = {};
  Object.keys(props).forEach(function(k){
    var p = {id: props[k].id || k, name: k, type: props[k].type};
    p[props[k].type] = props[k].options ? {options: props[k].options.map(function(o){ return {name: o, color: 'default'}; })} : {};
    out[k] = p;
  });
  return {object: 'database', id: hyphenate_id(s.schema[name].db), title: store_rt(name), properties: out};
}

// a new property (Setup.js adds "Guest speaker" this way)
function store_alter(db_id, payload, constants){
  var s = store_load(constants);
  var name = store_tab_of(db_id, constants);
  var tab = store_tab(s, name), props = s.schema[name].properties;
  Object.keys(payload.properties || {}).forEach(function(k){
    var type = Object.keys(payload.properties[k]).filter(function(t){ return STORE_TYPES.indexOf(t) >= 0; })[0];
    if (!type || props[k]) return;
    props[k] = {type: type};
    [k].concat(type === 'date' ? [k + ' end'] : []).forEach(function(h){
      tab.header.push(h);
      tab.col[h] = tab.header.length - 1;
      tab.rows.forEach(function(r){ r.push(''); });
      tab.pages = [];
      tab.sheet.getRange(1, tab.header.length).setValue(h);
    });
  });
  store_save_schema(s);
  return store_database(db_id, constants);
}

function store_save_schema(s){
  var stab = s.ss.getSheetByName('Schema');
  var rows = Object.keys(s.schema).map(function(name){ return [name, s.schema[name].db, JSON.stringify(s.schema[name].properties)]; });
  stab.clearContents();
  stab.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
}

function store_query(db_id, body, constants){
  var s = store_load(constants);
  var tab = store_tab(s, store_tab_of(db_id, constants));
  var pages = [];
  tab.rows.forEach(function(r, i){
    if (!r[0] || r[tab.col['archived']] === 'TRUE') return;
    var page = store_page_at(s, tab, i);
    if (store_match(page, body.filter)) pages.push(page);
  });
  (body.sorts || []).slice().reverse().forEach(function(sort){
    var dir = sort.direction === 'descending' ? -1 : 1;
    pages.sort(function(a, b){
      var x = store_sort_key(a, sort), y = store_sort_key(b, sort);
      return x < y ? -dir : x > y ? dir : 0;
    });
  });
  var from = Number(body.start_cursor || 0), size = Math.min(Number(body.page_size || 100), 100);
  var more = from + size < pages.length;
  return {object: 'list', results: pages.slice(from, from + size), has_more: more, next_cursor: more ? String(from + size) : null};
}

function store_sort_key(page, sort){
  if (sort.timestamp) return page[sort.timestamp] || '';
  var p = page.properties[sort.property];
  if (!p) return '';
  if (p.type === 'date') return p.date ? new Date(p.date.start).getTime() : -Infinity;
  if (p.type === 'checkbox') return p.checkbox ? 1 : 0;
  if (p.type === 'number') return p.number == null ? -Infinity : p.number;
  if (p.type === 'select') return p.select ? p.select.name : '';
  return plain_text(p).toLowerCase();
}

// Notion's filter language, as far as the bot and the Cron Jobs use it
function store_match(page, f){
  if (!f) return true;
  if (f.and) return f.and.every(function(g){ return store_match(page, g); });
  if (f.or) return f.or.some(function(g){ return store_match(page, g); });
  var p = page.properties[f.property];
  var kind = Object.keys(f).filter(function(k){ return k !== 'property' && k !== 'type'; })[0];
  var cond = f[kind] || {};
  if (!p) return !!cond.is_empty;
  if (kind === 'checkbox'){
    if ('equals' in cond) return p.checkbox === cond.equals;
    if ('does_not_equal' in cond) return p.checkbox !== cond.does_not_equal;
  }
  if (kind === 'select'){
    var name = p.select ? p.select.name : '';
    if ('equals' in cond) return name === cond.equals;
    if ('does_not_equal' in cond) return name !== cond.does_not_equal;
    if (cond.is_empty) return !name;
    if (cond.is_not_empty) return !!name;
  }
  if (kind === 'title' || kind === 'rich_text' || kind === 'url' || kind === 'email' || kind === 'phone_number'){
    var text = p.type === 'title' || p.type === 'rich_text' ? plain_text(p) : String(p[p.type] || '');
    var low = text.toLowerCase();
    if ('equals' in cond) return text === cond.equals;
    if ('does_not_equal' in cond) return text !== cond.does_not_equal;
    if ('contains' in cond) return low.indexOf(String(cond.contains).toLowerCase()) >= 0;
    if ('does_not_contain' in cond) return low.indexOf(String(cond.does_not_contain).toLowerCase()) < 0;
    if ('starts_with' in cond) return low.indexOf(String(cond.starts_with).toLowerCase()) === 0;
    if (cond.is_empty) return !text;
    if (cond.is_not_empty) return !!text;
  }
  if (kind === 'relation'){
    var ids = (p.relation || []).map(function(r){ return normalise_id(r.id); });
    if ('contains' in cond) return ids.indexOf(normalise_id(cond.contains)) >= 0;
    if ('does_not_contain' in cond) return ids.indexOf(normalise_id(cond.does_not_contain)) < 0;
    if (cond.is_empty) return !ids.length;
    if (cond.is_not_empty) return ids.length > 0;
  }
  if (kind === 'number'){
    var n = p.number;
    if ('equals' in cond) return n === cond.equals;
    if ('greater_than' in cond) return n != null && n > cond.greater_than;
    if ('less_than' in cond) return n != null && n < cond.less_than;
    if (cond.is_empty) return n == null;
  }
  if (kind === 'date'){
    var start = p.date ? p.date.start : '';
    if (cond.is_empty) return !start;
    if (cond.is_not_empty) return !!start;
    if (!start) return false;
    var ops = {equals: 0, before: -1, after: 1, on_or_before: -2, on_or_after: 2};
    for (var op in ops){
      if (!(op in cond)) continue;
      var v = String(cond[op]);
      // a plain day compares with the slot's day in London; a time compares with the moment
      var a = /^\d{4}-\d{2}-\d{2}$/.test(v) ? store_day(start) : new Date(start).getTime();
      var b = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).getTime();
      if (ops[op] === 0) return a === b;
      if (ops[op] === -1) return a < b;
      if (ops[op] === 1) return a > b;
      if (ops[op] === -2) return a <= b;
      return a >= b;
    }
  }
  throw new Error('The rota data sheet cannot filter by ' + JSON.stringify(f) + '.');
}

function store_day(start){
  return /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : Utilities.formatDate(new Date(start), TZ, 'yyyy-MM-dd');
}

// ---- keeping the sheet in step with Notion ----

// a page Notion just returned (after a change made there): the sheet gets the same row
function store_mirror(out, constants){
  try {
    if (!out || out.object !== 'page' || !out.parent || !out.parent.database_id) return;
    if (!PropertiesService.getScriptProperties().getProperty('STORE_SHEET_ID')) return;
    var s = store_load(constants);
    var tab = store_tab(s, store_tab_of(out.parent.database_id, constants));
    var id = normalise_id(out.id), hit = s.where[id];
    var row = hit ? tab.rows[hit.i] : tab.header.map(function(){ return ''; });
    store_row_from_page(tab, out, row, s);
    if (hit) store_write_row(tab, hit.i);
    else {
      tab.rows.push(row);
      s.where[id] = {tab: tab.name, i: tab.rows.length - 1};
      store_write_row(tab, tab.rows.length - 1);
    }
  } catch (e) {
    Logger.log('Could not copy the change into the rota data sheet: ' + e);
  }
}

function store_row_from_page(tab, page, row, s){
  row[0] = normalise_id(page.id);
  row[tab.col['archived']] = page.archived || page.in_trash ? 'TRUE' : '';
  row[tab.col['created']] = page.created_time || '';
  row[tab.col['edited']] = page.last_edited_time || '';
  row[tab.col['icon']] = page.icon ? JSON.stringify(page.icon) : '';
  store_cells(tab, page.properties, row, s);
  return row;
}

// The Cron Jobs' calls to api.notion.com (they keep their own request code): answered by Notion or the sheet
function store_fetch(url, params){
  var path = String(url).replace('https://api.notion.com/v1/', '');
  var method = String(params.method || 'get').toLowerCase();
  var constants = get_global_constants();
  if (store_mode() === 'notion'){
    var res = UrlFetchApp.fetch(url, params);
    if (res.getResponseCode() === 200 && method !== 'get' && !/\/query$/.test(path)) store_mirror(JSON.parse(res.getContentText()), constants);
    return res;
  }
  var reply = function(code, body){ var text = JSON.stringify(body); return {getResponseCode: function(){ return code; }, getContentText: function(){ return text; }}; };
  try {
    return reply(200, store_request(method, path, params.payload ? JSON.parse(params.payload) : null, constants));
  } catch (e) {
    return reply(500, {object: 'error', message: String(e.message || e)});
  }
}

// ---- the move ----

// Copies the three Notion databases into the sheet (all rows, history included: the fair rota counts past
// turns). Run from the editor; safe to run again (it starts the tabs afresh).
function store_import_from_notion(){
  var constants = get_global_constants();
  ensure_settings_tabs();
  var ss = store_spreadsheet(true);
  var schema = {};
  var summary = [];
  Object.keys(STORE_TABS).forEach(function(k){
    var name = STORE_TABS[k], db = constants[k];
    var info = notion_http('get', 'databases/' + db, null, constants);
    var props = {};
    Object.keys(info.properties).forEach(function(p){
      var def = info.properties[p];
      if (STORE_TYPES.indexOf(def.type) < 0) return;  // formulas, rollups and back-links stay behind
      props[p] = {id: def.id, type: def.type};
      if (def.type === 'select') props[p].options = def.select.options.map(function(o){ return o.name; });
    });
    schema[name] = {db: normalise_id(db), properties: props};
    var header = STORE_META.slice();
    Object.keys(props).forEach(function(p){ header.push(p); if (props[p].type === 'date') header.push(p + ' end'); });
    var pages = [], body = {page_size: 100};
    while (true){
      var res = notion_http('post', 'databases/' + db + '/query', body, constants);
      pages = pages.concat(res.results);
      if (!res.has_more) break;
      body.start_cursor = res.next_cursor;
    }
    var tab = {name: name, header: header, col: {}};
    header.forEach(function(h, i){ tab.col[h] = i; });
    var rows = pages.map(function(page){ return store_row_from_page(tab, page, header.map(function(){ return ''; }), {schema: schema}); });
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.clear();
    sheet.getRange(1, 1, rows.length + 1, header.length).setNumberFormat('@').setValues([header].concat(rows));
    sheet.setFrozenRows(1);
    summary.push(name + ': ' + rows.length);
  });
  if (!ss.getSheetByName('Schema')) ss.insertSheet('Schema');
  store_save_schema({ss: ss, schema: schema});
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  store_cache = null;
  Logger.log('Copied into "Gatsby Rotas data": ' + summary.join(', '));
  return summary.join(', ');
}

// Compares Notion with the sheet, row by row and field by field; logs and returns the differences.
function store_check(){
  var constants = get_global_constants();
  store_cache = null;
  var s = store_load(constants);
  var out = [];
  Object.keys(STORE_TABS).forEach(function(k){
    var name = STORE_TABS[k], tab = store_tab(s, name), db = constants[k];
    var notion = [], body = {page_size: 100};
    while (true){
      var res = notion_http('post', 'databases/' + db + '/query', body, constants);
      notion = notion.concat(res.results);
      if (!res.has_more) break;
      body.start_cursor = res.next_cursor;
    }
    var seen = {};
    notion.forEach(function(page){
      var id = normalise_id(page.id);
      seen[id] = true;
      var hit = s.where[id];
      if (!hit){ out.push(name + ': ' + id + ' is missing from the sheet'); return; }
      var want = store_row_from_page(tab, page, tab.header.map(function(){ return ''; }), s);
      var have = tab.rows[hit.i];
      tab.header.forEach(function(h, i){
        if (h === 'edited' || h === 'created' || h === 'icon') return;
        if (String(want[i]) !== String(have[i])) out.push(name + ' ' + id + ' ' + h + ': Notion "' + want[i] + '", sheet "' + have[i] + '"');
      });
    });
    tab.rows.forEach(function(r){ if (r[0] && !seen[r[0]] && r[tab.col['archived']] !== 'TRUE') out.push(name + ': ' + r[0] + ' is only in the sheet'); });
  });
  Logger.log(out.length ? out.length + ' differences:\n' + out.slice(0, 200).join('\n') : 'Notion and the rota data sheet agree.');
  return out;
}
