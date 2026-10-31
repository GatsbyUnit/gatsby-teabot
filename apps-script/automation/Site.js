// Server side of the Gatsby Rotas site (site/rotas/ on GitHub Pages): the members' pages (guides, toolbox) and
// the rota views, with editing for the tsars.
//
// The pages live here now, no longer on Notion: one row per page in the "Gatsby Rotas pages" sheet in the bot's
// Drive (made on first use; its version history is the pages' history). They were imported once from the
// published Notion site. The rota data (schedule, people, rota rules) still comes live from the Notion
// databases, and edits to it are written back there.
//
// Signing in: the visitor picks their name and gets a link by email (?signin=<code>, valid for an hour).
// Opening it hands the browser the unit key (PAGE_KEY) and the person's tea-page token, which it keeps for
// six months. The tea page's remembered personal code signs people in as well (same address). The key
// opens the pages; the token says who is asking, which decides what they may edit.

const SITE = {
  slugs: ['home', 'tea-system', 'tnjc', 'mljc', 'coffee', 'away-dates', 'talk-title', 'change-presenter'],
  views: ['schedule', 'people', 'rota-rules'],
  notion_site: 'https://gcnu.notion.site',
  history_days: 400,
  rule_order: ['Faculty', 'Postdoc', 'PhD student', 'PhD student: joint', 'Staff', 'CRS', 'Visitor'],
  link_ttl: 3600,
  cell: 45000  // a sheet cell holds 50,000 characters; longer pages continue in the next cells
};

// what the pages are made of (see renderBlock in site/rotas/app.js)
const SITE_BLOCK_TYPES = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote', 'callout', 'code', 'hr', 'columns',
  'column', 'table', 'image', 'bookmark', 'page', 'view', 'group'];
const SITE_TEXT_TYPES = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote', 'callout', 'code'];
const SITE_NEW_TYPES = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote'];
const SITE_CONTAINERS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote', 'callout', 'columns', 'column', 'group'];

function site_url(settings){
  return page_url(settings).replace(/\/?$/, '/') + 'rotas/';
}

// ---- signing in ----

// everyone who can be sent a link: active, with a registered address
function api_site_people(){
  var constants = get_global_constants();
  var people = load_people(constants);
  return identity_rows(constants).rows
    .filter(function(r){ return r.id && r.email && people[r.id] && people[r.id].active; })
    .map(function(r){ return {id: r.id, name: people[r.id].name || r.name}; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); });
}

function api_site_request_link(person_id){
  var code = new_token();
  var id = normalise_id(String(person_id || '').trim());
  var sent = send_personal_link(id, 'Your sign-in link for the Gatsby Rotas', function(){
    return site_link_blocks(site_url(get_settings()) + '?signin=' + code);
  });
  CacheService.getScriptCache().put('signin:' + code, id, SITE.link_ttl);
  return sent;
}

function site_link_blocks(url){
  return [
    'You asked to sign in to the Gatsby Rotas: the talk, tea and coffee rotas and the guides to them.',
    {link: 'Open the Gatsby Rotas', url: url},
    'Or copy this address into your browser: ' + url,
    'The link works for one hour. Once you have opened it, that browser remembers you for six months. If you did not ask for it, you can ignore this email.'
  ];
}

// the code from the emailed link -> {key, token, person, name}; null once it has expired
function api_site_sign_in(code){
  if (!/^[0-9a-f]{40}$/.test(String(code || ''))) return null;
  var id = CacheService.getScriptCache().get('signin:' + code);
  if (!id) return null;
  var constants = get_global_constants();
  var find = function(){ return identity_rows(constants).rows.filter(function(r){ return r.id === id; })[0]; };
  var row = find();
  if (row && !row.token){ ensure_tokens(constants); row = find(); }
  return site_session(row, constants);
}

// signs in with the tea page's personal code, which the browser may remember from there
function api_site_sign_in_token(token){
  var constants = get_global_constants();
  return site_session(identity_for_token(String(token || ''), constants), constants);
}

function site_session(row, constants){
  if (!row || !row.token) return null;
  var person = load_people(constants)[row.id];
  if (!person || !person.active) return null;
  return {key: get_settings().PAGE_KEY || '', token: row.token, person: row.id, name: person.name};
}

// What the holder of this token may change on the site. Tsars are the tea tsar (admin_email, everything)
// and the rota organisers (the pages, their rota's slots and membership).
function site_rights(token, constants){
  var me = token ? identity_for_token(String(token), constants) : null;
  var email = me ? me.email.toLowerCase() : '';
  var r = {person: me ? me.id : '', pages: false, rules: false, people: [], slots: [], add_people: false, tea_tsar: false};
  if (!email) return r;
  var is = function(key){ return String(constants[key] || '').toLowerCase() === email; };
  if (is('admin_email')){
    return {person: me.id, pages: true, rules: true, people: ['all'], slots: ALL_TYPES.slice(), add_people: true, tea_tsar: true};
  }
  if (is('tnjc_admin_email')){ r.slots.push('TNJC'); r.people.push('TNJC', 'CSNJC'); }
  if (is('mljc_admin_email')){ r.slots.push('MLJC'); r.people.push('MLJC'); }
  if (is('coffee_admin_email')){ r.slots.push('Coffee Cleaning'); r.people.push('Coffee'); }
  r.pages = r.slots.length > 0;
  return r;
}

// ---- what the site shows ----

// {pages, data, me}; null without the unit key or a valid token
function api_site_bundle(key, token){
  var constants = get_global_constants();
  var settings = get_settings();
  var me = token ? identity_for_token(String(token), constants) : null;
  if (!me && (!settings.PAGE_KEY || String(key || '') !== settings.PAGE_KEY)) return null;
  return {
    generated: new Date().toISOString(),
    pages: site_pages(),
    data: site_data(constants),
    me: me ? site_rights(token, constants) : null
  };
}

// CacheService keeps at most 100 KB per entry: bigger values go in numbered pieces, as ASCII (it counts bytes)
function cache_put_big(key, value, seconds){
  var s = JSON.stringify(value).replace(/[\u007f-￿]/g, function(c){ return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); });
  var parts = {}, n = 0;
  for (var i = 0; i < s.length; i += 90000) parts[key + ':' + n++] = s.slice(i, i + 90000);
  parts[key] = String(n);
  CacheService.getScriptCache().putAll(parts, seconds);
}

function cache_get_big(key){
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0);
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + ':' + i);
  var got = cache.getAll(keys);
  var s = '';
  for (var j = 0; j < n; j++){
    if (got[keys[j]] == null) return null;
    s += got[keys[j]];
  }
  return JSON.parse(s);
}

function site_forget(what){
  var cache = CacheService.getScriptCache();
  if (what === 'pages') cache.remove('site:pages');
  if (what === 'data'){ cache.remove('site:data'); cache.remove(PEOPLE_CACHE_KEY); }
}

// ---- the pages ----

const SITE_PAGES_HEADER = ['Page', 'Notion id', 'Title', 'Icon', 'Saved', 'Saved by', 'Content (JSON; edit on the site, not here)'];

function site_pages_sheet(){
  var id = PropertiesService.getScriptProperties().getProperty('SITE_PAGES_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id).getSheets()[0];
  var ss = SpreadsheetApp.create('Gatsby Rotas pages');
  var sheet = ss.getSheets()[0].setName('Pages');
  sheet.appendRow(SITE_PAGES_HEADER);
  sheet.setFrozenRows(1);
  set_setting('SITE_PAGES_SHEET_ID', ss.getId());
  return sheet;
}

// {slug: {id, slug, title, icon, saved, by, blocks}}, from the sheet (cached for five minutes)
function site_pages(fresh){
  if (!fresh){
    var cached = cache_get_big('site:pages');
    if (cached) return cached;
  }
  var sheet = site_pages_sheet();
  var last = sheet.getLastRow(), width = sheet.getLastColumn();
  var out = {};
  if (last > 1){
    sheet.getRange(2, 1, last - 1, width).getValues().forEach(function(r){
      if (!r[0]) return;
      var json = r.slice(6).join('');
      out[r[0]] = {id: String(r[1]), slug: String(r[0]), title: String(r[2]), icon: String(r[3]),
                   saved: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ''), by: String(r[5] || ''),
                   blocks: json ? JSON.parse(json) : []};
    });
  }
  cache_put_big('site:pages', out, 300);
  return out;
}

function save_site_page(sheet, page, by){
  var json = JSON.stringify(page.blocks || []);
  var cells = [];
  for (var i = 0; i < json.length; i += SITE.cell) cells.push(json.slice(i, i + SITE.cell));
  var slugs = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function(r){ return r[0]; }) : [];
  var at = slugs.indexOf(page.slug);
  var row = at >= 0 ? at + 2 : sheet.getLastRow() + 1;
  var width = Math.max(sheet.getLastColumn(), 6 + cells.length);
  if (width > 6) sheet.getRange(row, 7, 1, width - 6).clearContent();
  // plain text, so Sheets never reads the JSON as a formula or a number
  sheet.getRange(row, 1, 1, 6 + cells.length).setNumberFormat('@')
    .setValues([[page.slug, page.id || '', page.title || '', page.icon || '', new Date().toISOString(), by].concat(cells)]);
}

// A tsar's edits to one page, applied in order:
//   {op: 'update', id, rt, checked?}             new text for a block
//   {op: 'cells', id, cells: [rt, …]}            new text for a table row
//   {op: 'insert', tmp, parent, after, type, rt}   a new block under parent (the page or a block), right after
//                                                 `after`, or first when after is empty; parent and after may
//                                                 name an earlier insert's tmp
//   {op: 'delete', id}
//   {op: 'title', title}
// Returns the page as it is now.
function api_site_edit_page(token, slug, ops){
  var ed = site_editor(token, function(r){ return r.pages; });
  if (!Array.isArray(ops) || ops.length > 300) throw new Error('Too many changes at once: please save in smaller steps.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var page = site_pages(true)[slug];
    if (!page) throw new Error('Unknown page.');
    apply_site_ops(page, ops, function(){ return Utilities.getUuid().replace(/-/g, ''); });
    save_site_page(site_pages_sheet(), page, site_name(ed));
    site_forget('pages');
  } finally {
    lock.releaseLock();
  }
  log_site_edit(ed, 'page ' + slug + ': ' + ops.length + ' change' + (ops.length === 1 ? '' : 's'));
  return site_pages()[slug];
}

function apply_site_ops(page, ops, new_id){
  var index = {};
  var walk = function(list){
    list.forEach(function(b){
      index[b.id] = {block: b, list: list};
      (b.rows || []).forEach(function(r){ index[r.id] = {block: r, list: b.rows, row: true}; });
      if (b.children) walk(b.children);
    });
  };
  walk(page.blocks);
  var made = {};
  var find = function(id){
    id = made[id] || String(id || '');
    if (!index[id]) throw new Error('That part of the page has changed or gone. Reload and try again.');
    return index[id];
  };
  var forget = function(b){ delete index[b.id]; (b.rows || []).forEach(forget); (b.children || []).forEach(forget); };
  ops.forEach(function(op){
    if (op.op === 'title'){
      var title = String(op.title || '').trim();
      if (!title) throw new Error('A page needs a title.');
      page.title = title.slice(0, 200);
    } else if (op.op === 'update'){
      var hit = find(op.id);
      if (hit.row || SITE_TEXT_TYPES.indexOf(hit.block.type) < 0) throw new Error('This part of the page cannot be edited here.');
      hit.block.rt = clean_site_rich(op.rt);
      if (hit.block.type === 'todo') hit.block.checked = !!op.checked;
    } else if (op.op === 'cells'){
      var row = find(op.id);
      if (!row.row) throw new Error('Not a table row.');
      row.block.cells = (op.cells || []).slice(0, 20).map(clean_site_rich);
    } else if (op.op === 'delete'){
      var gone = find(op.id);
      gone.list.splice(gone.list.indexOf(gone.block), 1);
      forget(gone.block);
    } else if (op.op === 'insert'){
      if (SITE_NEW_TYPES.indexOf(op.type) < 0) throw new Error('Unknown kind of block: ' + op.type);
      var parent = made[op.parent] || String(op.parent || '');
      var list;
      if (parent === page.id) list = page.blocks;
      else {
        var p = find(parent);
        if (p.row || SITE_CONTAINERS.indexOf(p.block.type) < 0) throw new Error('Blocks cannot go there.');
        list = p.block.children = p.block.children || [];
      }
      var block = {id: new_id(), type: op.type, rt: clean_site_rich(op.rt)};
      if (op.type === 'todo') block.checked = false;
      if (op.type === 'toggle') block.children = [];
      var at = 0;
      if (op.after){
        var a = find(op.after);
        at = list.indexOf(a.block) + 1;
        if (!at) throw new Error('That part of the page has changed. Reload and try again.');
      }
      list.splice(at, 0, block);
      index[block.id] = {block: block, list: list};
      made[op.tmp] = block.id;
    } else {
      throw new Error('Unknown change: ' + op.op);
    }
  });
  return page;
}

// rich text as the site writes it: [{text, b, i, s, u, code, color, href | page}], nothing else
function clean_site_rich(rt){
  return (Array.isArray(rt) ? rt : []).slice(0, 300).map(function(r){
    r = r || {};
    var o = {text: String(r.text == null ? '' : r.text).slice(0, 5000)};
    ['b', 'i', 's', 'u', 'code'].forEach(function(k){ if (r[k]) o[k] = true; });
    if (r.color && /^(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?$/.test(r.color)) o.color = r.color;
    if (r.page && /^[0-9a-f]{32}$/.test(r.page)) o.page = r.page;
    else if (r.href && /^(https?:\/\/|mailto:|\/[0-9a-f]{32}|#)/i.test(String(r.href))) o.href = String(r.href).slice(0, 2000);
    return o;
  }).filter(function(o){ return o.text; });
}

// a whole page, as imported: only the kinds of block the site knows, with only their own fields
function clean_site_blocks(blocks, depth){
  if ((depth || 0) > 12) throw new Error('Pages nest too deeply.');
  return (Array.isArray(blocks) ? blocks : []).filter(function(b){ return b && SITE_BLOCK_TYPES.indexOf(b.type) >= 0; }).map(function(b){
    var o = {id: /^[0-9a-z-]{1,40}$/i.test(String(b.id)) ? String(b.id) : Utilities.getUuid().replace(/-/g, ''), type: b.type};
    if (SITE_TEXT_TYPES.indexOf(b.type) >= 0) o.rt = clean_site_rich(b.rt);
    if (b.toggle) o.toggle = true;
    if (b.type === 'todo') o.checked = !!b.checked;
    if (b.type === 'callout') o.icon = String(b.icon || '').slice(0, 8);
    if (b.type === 'table'){
      o.header = !!b.header;
      o.rows = (b.rows || []).slice(0, 200).map(function(r){ return {id: String(r.id), cells: (r.cells || []).slice(0, 20).map(clean_site_rich)}; });
    }
    if (b.type === 'image' || b.type === 'bookmark'){
      var url = String(b.url || '');
      if (!/^(https:\/\/|img\/[\w.-]+$)/.test(url)) return null;
      o.url = url;
      o.caption = clean_site_rich(b.caption);
    }
    if (b.type === 'page'){ o.page = /^[0-9a-f]{32}$/.test(b.page) ? b.page : ''; if (b.title) o.title = String(b.title).slice(0, 200); }
    if (b.type === 'view'){
      if (SITE.views.indexOf(b.view) < 0) return null;
      o.view = b.view;
    }
    if (b.children && SITE_CONTAINERS.indexOf(b.type) >= 0) o.children = clean_site_blocks(b.children, (depth || 0) + 1);
    return o;
  }).filter(Boolean);
}

// The pages, all at once: the one-off move from Notion (any tsar, while there are none yet), or a restore
// (tea tsar, replace = true). pages: {slug: {id, title, icon, blocks}}.
function api_site_import_pages(token, pages, replace){
  var ed = site_editor(token, function(r){ return r.pages; });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = site_pages_sheet();
    var have = site_pages(true);
    if (Object.keys(have).length && !(replace && ed.rights.tea_tsar)) throw new Error('The pages are already here; only the tea tsar can replace them all.');
    var slugs = Object.keys(pages || {}).filter(function(s){ return SITE.slugs.indexOf(s) >= 0; });
    if (!slugs.length) throw new Error('No pages to import.');
    slugs.forEach(function(slug){
      var p = pages[slug];
      save_site_page(sheet, {slug: slug, id: String(p.id || ''), title: String(p.title || slug).slice(0, 200),
                             icon: String(p.icon || '').slice(0, 8), blocks: clean_site_blocks(p.blocks)}, site_name(ed));
    });
    site_forget('pages');
  } finally {
    lock.releaseLock();
  }
  log_site_edit(ed, 'imported ' + slugs.length + ' pages');
  return Object.keys(site_pages());
}

// ---- the rota data (Notion) ----

function site_data(constants){
  var cached = cache_get_big('site:data');
  if (cached) return cached;
  var since = fmt_iso_date(add_days(start_of_today(), -SITE.history_days));
  var schedule = notion_query(constants['notion_talk_db_id'], {property: 'Date', date: {on_or_after: since}},
                              [{property: 'Date', direction: 'ascending'}], constants)
    .map(site_slot).filter(function(s){ return s.start && ALL_TYPES.indexOf(s.type) >= 0; });
  var people = notion_query(constants['notion_people_db_id'], null, null, constants).map(site_person);
  var rules_db = constants['notion_rota_rules_db_id'];
  var rules = notion_query(rules_db, null, null, constants).map(site_rule)
    .sort(function(a, b){ return rule_rank(a.position) - rule_rank(b.position); });
  var people_db = notion_get_database(constants['notion_people_db_id'], constants);
  var rules_schema = notion_get_database(rules_db, constants).properties;
  var options = function(prop){ return prop && prop.select ? prop.select.options.map(function(o){ return o.name; }) : []; };
  var data = {
    generated: new Date().toISOString(),
    schedule: schedule, people: people, rota_rules: rules,
    options: {
      types: ALL_TYPES, presenter_types: PRESENTER_TYPES, tea_types: TEA_TYPES, guest_types: GUEST_TYPES,
      positions: options(people_db.properties['Position']),
      rules: {research: options(rules_schema['Research Duty']), tea_talk: options(rules_schema['Tea Talk Duty']), tea: options(rules_schema['Tea Duty'])}
    }
  };
  cache_put_big('site:data', data, 300);
  return data;
}

function rule_rank(position){
  var i = SITE.rule_order.indexOf(position);
  return i < 0 ? 99 : i;
}

// a Notion date property -> London time ("2026-11-02T13:30:00+00:00"), or the plain day when it has no time
function site_date(s){
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return Utilities.formatDate(new Date(s), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function site_slot(page){
  var p = page.properties, date = p['Date'] && p['Date'].date;
  var ids = function(name){ return (p[name] && p[name].relation || []).map(function(r){ return normalise_id(r.id); }); };
  return {
    id: normalise_id(page.id),
    type: p['Type'] && p['Type'].select ? p['Type'].select.name : '',
    title: plain_text(p['Title']),
    start: date ? site_date(date.start) : null,
    end: date ? site_date(date.end) : null,
    presenter: ids('Presenter'),
    tea: ids('Tea'),
    guest: p[GUEST_PROP] ? plain_text(p[GUEST_PROP]).trim() : '',
    description: plain_text(p['Description']),
    csnjc: !!(p['CSNJC'] && p['CSNJC'].checkbox),
    water_filter: !!(p['Water filter (coffee only)'] && p['Water filter (coffee only)'].checkbox)
  };
}

function site_person(page){
  var p = page.properties, box = function(name){ return !!(p[name] && p[name].checkbox); };
  var join = p['Join Date'] && p['Join Date'].date;
  var photo = site_photo(page);
  return {
    id: normalise_id(page.id),
    name: plain_text(p['Name']).trim(),
    position: p['Position'] && p['Position'].select ? p['Position'].select.name : '',
    active: box('Active'),
    rotas: ['TNJC', 'CSNJC', 'MLJC', 'Coffee'].filter(box),
    excluded: [['research', 'Excluded from research talk'], ['tea_talk', 'Excluded from tea talk'], ['tea', 'Excluded from tea']]
      .filter(function(x){ return box(x[1]); }).map(function(x){ return x[0]; }),
    joined: join ? join.start : null,
    photo: photo[0], photo_alt: photo.slice(1)
  };
}

// People's photos are their Notion page icons: first through the published Notion site's image proxy (small;
// gone once that site is unpublished), then straight from where they are. Resized copies on ucl.ac.uk go
// stale, so their original upload comes last. Uploaded icons have addresses that work for an hour.
function site_photo(page){
  var icon = page.icon;
  if (!icon || icon.type === 'emoji') return [null];
  var direct = icon.type === 'external' ? icon.external.url : icon.file.url;
  var bare = direct.split('?')[0];
  var out = [SITE.notion_site + '/image/' + encodeURIComponent(icon.type === 'external' ? direct : bare) + '?table=block&id=' + page.id + '&width=240&cache=v2', direct];
  if (icon.type === 'external' && /\/styles\/[^\/]+\/public\//.test(bare)) out.push(bare.replace(/\/styles\/[^\/]+\/public\//, '/'));
  return out;
}

function site_rule(page){
  var p = page.properties, sel = function(name){ return p[name] && p[name].select ? p[name].select.name : ''; };
  return {id: normalise_id(page.id), position: plain_text(p['Type']), research: sel('Research Duty'), tea_talk: sel('Tea Talk Duty'), tea: sel('Tea Duty')};
}

// ---- editing the rota data (tsars) ----

function site_editor(token, need){
  var constants = get_global_constants();
  var rights = site_rights(token, constants);
  if (!rights.person) throw new Error('Please sign in again.');
  if (need && !need(rights)) throw new Error('Only the tsars can change this.');
  return {constants: constants, rights: rights};
}

function site_name(ed){
  var p = load_people(ed.constants)[ed.rights.person];
  return p ? p.name : ed.rights.person;
}

// A slot, new (no id) or changed: {id?, type, title, start, end, presenter: [ids], tea: [ids], guest,
// description, csnjc, water_filter}. start/end: "2026-11-02T13:30" (London) or "2026-11-02" (whole days).
function api_site_save_slot(token, slot){
  var ed = site_editor(token);
  var constants = ed.constants;
  var allowed = function(type){ return ed.rights.slots.indexOf(type) >= 0; };
  if (!slot || ALL_TYPES.indexOf(slot.type) < 0) throw new Error('Please pick what kind of slot this is.');
  if (!allowed(slot.type)) throw new Error('Only the ' + slot.type + ' tsar or the tea tsar can change these slots.');
  if (slot.id){
    var current = site_slot(notion_get_page(hyphenate_id(slot.id), constants));
    if (!allowed(current.type)) throw new Error('Only the ' + current.type + ' tsar or the tea tsar can change this slot.');
  }
  var people = load_people(constants);
  var ids = function(list){
    return (list || []).map(function(id){
      id = normalise_id(id);
      if (!people[id]) throw new Error('Unknown person.');
      return {id: hyphenate_id(id)};
    });
  };
  var props = {
    'Title': {title: chunk_text(String(slot.title || '').slice(0, 300))},
    'Type': {select: {name: slot.type}},
    'Date': {date: site_notion_date(slot.start, slot.end)},
    'Presenter': {relation: ids(slot.presenter)},
    'Tea': {relation: ids(slot.tea)},
    'Description': {rich_text: chunk_text(String(slot.description || '').slice(0, 4000))},
    'CSNJC': {checkbox: !!slot.csnjc},
    'Water filter (coffee only)': {checkbox: !!slot.water_filter}
  };
  props[GUEST_PROP] = {rich_text: chunk_text(String(slot.guest || '').slice(0, 200))};
  var page = slot.id
    ? notion_patch_page(hyphenate_id(slot.id), props, constants)
    : notion_request('post', 'pages', {parent: {database_id: constants['notion_talk_db_id']}, properties: props}, constants);
  site_forget('data');
  log_site_edit(ed, (slot.id ? 'changed ' : 'added ') + slot.type + ' slot ' + slot.start);
  return site_slot(page);
}

function site_notion_date(start, end){
  var day = /^\d{4}-\d{2}-\d{2}$/, minute = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  var conv = function(s){
    s = String(s || '');
    if (day.test(s)) return s;
    if (minute.test(s)) return Utilities.formatDate(Utilities.parseDate(s, TZ, "yyyy-MM-dd'T'HH:mm"), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return null;
  };
  var a = conv(start), b = end ? conv(end) : null;
  if (!a) throw new Error('Please give the date (and time).');
  if (end && !b) throw new Error('Please check the end time.');
  return {start: a, end: b};
}

// A person, new (no id, tea tsar only) or changed. Rota tsars may only tick their own rota.
function api_site_save_person(token, person){
  var ed = site_editor(token);
  var constants = ed.constants, may = ed.rights.people, all = may.indexOf('all') >= 0;
  if (!person) throw new Error('Nothing to save.');
  if (!person.id && !ed.rights.add_people) throw new Error('Only the tea tsar can add people.');
  if (!all && !may.length) throw new Error('Only the tsars can change this.');
  var props = {};
  ['TNJC', 'CSNJC', 'MLJC', 'Coffee'].forEach(function(r){
    if (all || may.indexOf(r) >= 0) props[r] = {checkbox: (person.rotas || []).indexOf(r) >= 0};
  });
  if (all){
    var name = String(person.name || '').trim();
    if (!name) throw new Error('Please give the name.');
    props['Name'] = {title: chunk_text(name.slice(0, 200))};
    props['Position'] = person.position ? {select: {name: String(person.position)}} : {select: null};
    props['Active'] = {checkbox: !!person.active};
    [['research', 'Excluded from research talk'], ['tea_talk', 'Excluded from tea talk'], ['tea', 'Excluded from tea']].forEach(function(x){
      props[x[1]] = {checkbox: (person.excluded || []).indexOf(x[0]) >= 0};
    });
    props['Join Date'] = {date: person.joined && /^\d{4}-\d{2}-\d{2}$/.test(person.joined) ? {start: person.joined} : null};
  }
  var page = person.id
    ? notion_patch_page(hyphenate_id(person.id), props, constants)
    : notion_request('post', 'pages', {parent: {database_id: constants['notion_people_db_id']}, properties: props}, constants);
  site_forget('data');
  log_site_edit(ed, (person.id ? 'changed ' : 'added ') + 'person ' + (person.name || person.id));
  return site_person(page);
}

// One line of "You are added to the rota when" (tea tsar)
function api_site_save_rule(token, rule){
  var ed = site_editor(token, function(r){ return r.rules; });
  var map = {research: 'Research Duty', tea_talk: 'Tea Talk Duty', tea: 'Tea Duty'};
  var props = {};
  Object.keys(map).forEach(function(k){ if (rule && k in rule) props[map[k]] = rule[k] ? {select: {name: String(rule[k])}} : {select: null}; });
  var page = notion_patch_page(hyphenate_id(rule.id), props, ed.constants);
  site_forget('data');
  log_site_edit(ed, 'rota rule ' + rule.id);
  return site_rule(page);
}

// in the bot's log sheet, so edits made on the site can be traced
function log_site_edit(ed, what){
  try {
    ensure_log_sheet().getSheetByName(LOG_TAB).appendRow([new Date(), 'site edit', 'live', '', '', site_name(ed), what]);
  } catch (e) { Logger.log('site edit log: ' + e); }
}
