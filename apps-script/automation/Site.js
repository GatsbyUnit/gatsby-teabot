// Server side of the Gatsby Rotas site (site/rotas/ on GitHub Pages): the members' pages and the rota views,
// read live from Notion, and editing for the tsars, written straight back into Notion. Notion stays the
// source; the site shows it, so the two cannot drift apart.
//
// Signing in: the visitor picks their name and gets a link by email (?signin=<code>, valid for an hour).
// Opening it hands the browser the unit key (PAGE_KEY) and the person's tea-page token, which it keeps for
// six months. The tea page's remembered personal code signs people in as well (same address). The key
// opens the pages; the token says who is asking, which decides what they may edit.

const SITE = {
  // Notion pages shown on the site (normalised id -> slug). Their subpages stay on Notion.
  pages: {
    'e3f4410c97a74e1784b67521e91f4dab': 'home',
    '2444835e8eab46fa9a7c792877e09620': 'tea-system',
    '931a171f12c64142a466c952d3994532': 'tnjc',
    '556a292407ac488e91ef3b70a69768ce': 'mljc',
    'cb2adc1a95294900a825b366d65b369b': 'coffee',
    'f8f2d7cf80544059ab354525ec3b7b4f': 'away-dates',
    '7fb927c4b1d34b40b847256bd680cddc': 'talk-title',
    '29a2c61888664740b1ebdd872b7cab11': 'change-presenter'
  },
  // linked database views inside those pages -> the site's own views
  views: {
    '0acde385337e4550bdb181c27fe525b1': 'schedule',
    'a1c0ef91b43e4ecc8f18ec908e547c36': 'people',
    '13409d62cb7a419a90b82e46c3fc9b0c': 'rota-rules',
    'ea0a3044c5b34e8b80460c58985c0600': 'coffee-duties'
  },
  coffee_duties_db: '85959555eca741878ba550e95de76439',
  notion_site: 'https://gcnu.notion.site',
  history_days: 400,
  rule_order: ['Faculty', 'Postdoc', 'PhD student', 'PhD student: joint', 'Staff', 'CRS', 'Visitor'],
  link_ttl: 3600
};

// Notion block type <-> the site's block type
const SITE_TYPES = {
  paragraph: 'p', heading_1: 'h1', heading_2: 'h2', heading_3: 'h3', bulleted_list_item: 'ul',
  numbered_list_item: 'ol', to_do: 'todo', toggle: 'toggle', quote: 'quote', callout: 'callout', code: 'code'
};
const NOTION_TYPES = Object.keys(SITE_TYPES).reduce(function(o, k){ o[SITE_TYPES[k]] = k; return o; }, {});
const SITE_CONTAINERS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote', 'callout', 'columns', 'column', 'table', 'group'];

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
// and the rota organisers (their rota's slots and membership; pages for all of them).
function site_rights(token, constants){
  var me = token ? identity_for_token(String(token), constants) : null;
  var email = me ? me.email.toLowerCase() : '';
  var none = {person: me ? me.id : '', pages: false, rules: false, people: [], slots: [], coffee_duties: false, add_people: false};
  if (!email) return none;
  var is = function(key){ return String(constants[key] || '').toLowerCase() === email; };
  if (is('admin_email')){
    return {person: me.id, pages: true, rules: true, people: ['all'], slots: ALL_TYPES.slice(), coffee_duties: true, add_people: true};
  }
  var r = {person: me.id, pages: false, rules: false, people: [], slots: [], coffee_duties: false, add_people: false};
  if (is('tnjc_admin_email')){ r.slots.push('TNJC'); r.people.push('TNJC', 'CSNJC'); }
  if (is('mljc_admin_email')){ r.slots.push('MLJC'); r.people.push('MLJC'); }
  if (is('coffee_admin_email')){ r.slots.push('Coffee Cleaning'); r.people.push('Coffee'); r.coffee_duties = true; }
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
    pages: site_pages(constants),
    data: site_data(constants),
    me: me ? site_rights(token, constants) : null
  };
}

// CacheService keeps at most 100 KB per entry: bigger values go in numbered pieces
function cache_put_big(key, value, seconds){
  var s = JSON.stringify(value).replace(/[\u007f-\uffff]/g, function(c){ return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); });
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
  if (what === 'pages' || what === 'all') cache.remove('site:pages:fresh');
  if (what === 'data' || what === 'all'){ cache.remove('site:data'); cache.remove(PEOPLE_CACHE_KEY); }
}

// Several Notion GETs at once, three at a time (Notion allows about three requests a second).
function notion_get_all(paths, constants){
  var out = [];
  for (var i = 0; i < paths.length; i += 3){
    var batch = paths.slice(i, i + 3);
    var responses = UrlFetchApp.fetchAll(batch.map(function(p){
      return {url: 'https://api.notion.com/v1/' + p, method: 'get', muteHttpExceptions: true,
              headers: {'Authorization': 'Bearer ' + constants['notion_token'], 'Notion-Version': NOTION_VERSION}};
    }));
    responses.forEach(function(res, j){
      var code = res.getResponseCode();
      if (code === 200) out.push(JSON.parse(res.getContentText()));
      else if (code === 429 || code >= 500) out.push(notion_request('get', batch[j], null, constants));  // retries
      else out.push({error: code, message: res.getContentText().slice(0, 300)});
    });
  }
  return out;
}

// The pages, rebuilt only where Notion says they changed (each page's last_edited_time), checked at most every
// five minutes. A page Notion will not show the bot (not shared with the integration) comes back as {error}.
// force: a slug to read afresh in any case (just edited).
function site_pages(constants, force){
  var cache = CacheService.getScriptCache();
  var stored = cache_get_big('site:pages') || {};
  if (force) delete stored[force];
  if (!force && cache.get('site:pages:fresh') && Object.keys(stored).length) return stored;
  var ids = Object.keys(SITE.pages);
  var metas = notion_get_all(ids.map(function(id){ return 'pages/' + id; }), constants);
  var out = {};
  ids.forEach(function(id, i){
    var slug = SITE.pages[id], meta = metas[i];
    if (meta.error){
      out[slug] = {id: id, slug: slug, error: meta.error === 404 ? 'The bot cannot see this Notion page. Share it with the bot\'s Notion connection.' : 'Notion answered ' + meta.error + '.'};
      return;
    }
    // Notion rounds last_edited_time to the minute, so pages are also read afresh every hour
    var old = stored[slug];
    if (old && !old.error && old.edited === meta.last_edited_time && Date.now() - old.built < 3600e3){ out[slug] = old; return; }
    try {
      out[slug] = {id: id, slug: slug, title: rich_plain(meta.properties && meta.properties.title && meta.properties.title.title),
                   icon: meta.icon && meta.icon.type === 'emoji' ? meta.icon.emoji : '', edited: meta.last_edited_time,
                   built: Date.now(), blocks: read_site_blocks(id, constants)};
    } catch (e) {
      out[slug] = old && !old.error ? old : {id: id, slug: slug, error: String(e.message || e)};
    }
  });
  cache_put_big('site:pages', out, 21600);
  cache.put('site:pages:fresh', '1', 300);
  return out;
}

function rich_plain(rt){
  return (rt || []).map(function(t){ return t.plain_text; }).join('');
}

// All blocks under a page, level by level (children of several blocks fetched together).
function read_site_blocks(page_id, constants){
  var root = {children: null};
  var pending = [{id: page_id, node: root, cursor: null}];
  while (pending.length){
    var batch = pending.splice(0, pending.length);
    var paths = batch.map(function(p){ return 'blocks/' + p.id + '/children?page_size=100' + (p.cursor ? '&start_cursor=' + p.cursor : ''); });
    var results = notion_get_all(paths, constants);
    results.forEach(function(res, i){
      var p = batch[i];
      if (res.error) throw new Error('Notion would not show the blocks of ' + p.id + ' (' + res.error + ')');
      p.node.children = (p.node.children || []).concat(res.results.filter(function(b){ return !b.archived && !b.in_trash; }).map(function(b){
        var node = to_site_block(b);
        if (b.has_children && SITE_CONTAINERS.indexOf(node.type) >= 0){
          node.children = [];
          pending.push({id: normalise_id(b.id), node: node, cursor: null});
        }
        return node;
      }));
      if (res.has_more) pending.push({id: p.id, node: p.node, cursor: res.next_cursor});
    });
  }
  return finish_site_blocks(root.children || []);
}

// tables keep their rows as cells, not as blocks
function finish_site_blocks(blocks){
  return blocks.map(function(b){
    if (b.type === 'table'){
      b.rows = (b.children || []).map(function(r){ return {id: r.id, cells: r.cells || []}; });
      delete b.children;
    } else if (b.children){
      b.children = finish_site_blocks(b.children);
    }
    return b;
  });
}

// One Notion block -> the site's compact form: {id, type, rt (rich text), ...}
function to_site_block(b){
  var id = normalise_id(b.id), t = b.type, v = b[t] || {};
  if (SITE_TYPES[t]){
    var out = {id: id, type: SITE_TYPES[t], rt: to_site_rich(v.rich_text)};
    if (/^heading_/.test(t) && v.is_toggleable) out.toggle = true;
    if (t === 'to_do') out.checked = !!v.checked;
    if (t === 'callout') out.icon = v.icon && v.icon.type === 'emoji' ? v.icon.emoji : '';
    if (v.color && v.color !== 'default') out.color = v.color;
    return out;
  }
  if (t === 'divider') return {id: id, type: 'hr'};
  if (t === 'column_list') return {id: id, type: 'columns'};
  if (t === 'column') return {id: id, type: 'column'};
  if (t === 'table') return {id: id, type: 'table', header: !!v.has_column_header};
  if (t === 'table_row') return {id: id, type: 'row', cells: (v.cells || []).map(to_site_rich)};
  if (t === 'image'){
    var src = v.type === 'external' ? v.external.url : site_image_url(v.file.url, id);
    return {id: id, type: 'image', url: src, caption: to_site_rich(v.caption)};
  }
  if (t === 'bookmark' || t === 'embed' || t === 'link_preview') return {id: id, type: 'bookmark', url: v.url, caption: to_site_rich(v.caption)};
  if (t === 'child_page') return {id: id, type: 'page', page: id, title: v.title};
  if (t === 'link_to_page') return {id: id, type: 'page', page: normalise_id(v.page_id || v.database_id || '')};
  if (t === 'synced_block') return {id: id, type: 'group'};
  if (SITE.views[id]) return {id: id, type: 'view', view: SITE.views[id]};
  return {id: id, type: 'unsupported', what: t};
}

// Files Notion hosts come with addresses that expire after an hour; the published site's image proxy
// signs them afresh on every request.
function site_image_url(url, block_id){
  return SITE.notion_site + '/image/' + encodeURIComponent(String(url).split('?')[0]) + '?table=block&id=' + hyphenate_id(block_id) + '&cache=v2';
}

// Notion rich text -> [{text, b, i, s, u, code, href, page, color}] (only the marks that are set)
function to_site_rich(rich){
  return (rich || []).map(function(r){
    var a = r.annotations || {}, o = {text: r.plain_text};
    if (a.bold) o.b = true;
    if (a.italic) o.i = true;
    if (a.strikethrough) o.s = true;
    if (a.underline) o.u = true;
    if (a.code) o.code = true;
    if (a.color && a.color !== 'default') o.color = a.color;
    if (r.type === 'mention' && r.mention.type === 'page') o.page = normalise_id(r.mention.page.id);
    else if (r.type === 'equation'){ o.text = r.equation.expression; o.code = true; }
    else if (r.href) o.href = r.href;
    return o;
  });
}

// ...and back, for writing
function to_notion_rich(rt){
  var out = [];
  (rt || []).forEach(function(o){
    var annotations = {bold: !!o.b, italic: !!o.i, strikethrough: !!o.s, underline: !!o.u, code: !!o.code, color: o.color || 'default'};
    if (o.page && /^[0-9a-f]{32}$/.test(o.page)){
      out.push({type: 'mention', mention: {page: {id: hyphenate_id(o.page)}}, annotations: annotations});
      return;
    }
    var text = String(o.text || '');
    var href = o.href ? notion_href(o.href) : null;
    for (var i = 0; i < text.length; i += 1900){
      out.push({type: 'text', text: {content: text.slice(i, i + 1900), link: href ? {url: href} : null}, annotations: annotations});
    }
  });
  return out.slice(0, 100);
}

// Notion's own links come as "/<page id>#<block id>": the API wants a full address back
function notion_href(href){
  href = String(href);
  if (/^\/[0-9a-f]{32}/.test(href)) return 'https://www.notion.so' + href;
  if (!/^(https?:|mailto:)/i.test(href)) throw new Error('Links need a full address (https://…): ' + href);
  return href;
}

// ---- the rota data ----

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
  var duties = [], frequencies = [];
  try {
    duties = notion_query(SITE.coffee_duties_db, null, null, constants).map(site_coffee_duty)
      .sort(function(a, b){ return a.n - b.n; });
    var freq = notion_get_database(SITE.coffee_duties_db, constants).properties['Frequency'];
    frequencies = freq && freq.select ? freq.select.options.map(function(o){ return o.name; }) : [];
  } catch (e) { Logger.log('coffee duties: ' + e); }
  var people_db = notion_get_database(constants['notion_people_db_id'], constants);
  var rules_schema = notion_get_database(rules_db, constants).properties;
  var options = function(prop){ return prop && prop.select ? prop.select.options.map(function(o){ return o.name; }) : []; };
  var data = {
    generated: new Date().toISOString(),
    schedule: schedule, people: people, rota_rules: rules, coffee_duties: duties,
    options: {
      types: ALL_TYPES, presenter_types: PRESENTER_TYPES, tea_types: TEA_TYPES, guest_types: GUEST_TYPES,
      positions: options(people_db.properties['Position']),
      rules: {research: options(rules_schema['Research Duty']), tea_talk: options(rules_schema['Tea Talk Duty']), tea: options(rules_schema['Tea Duty'])},
      frequencies: frequencies
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
    photo: photo[0], photo_alt: photo[1]
  };
}

// People's photos are their Notion page icons. Through the published site's image proxy (small, and signed
// afresh for uploaded files). Resized copies on ucl.ac.uk go stale; photo_alt is the original upload.
function site_photo(page){
  var icon = page.icon;
  if (!icon || icon.type === 'emoji') return [null, null];
  var url = icon.type === 'external' ? icon.external.url : icon.file.url.split('?')[0];
  var proxy = function(u){ return SITE.notion_site + '/image/' + encodeURIComponent(u) + '?table=block&id=' + page.id + '&width=240&cache=v2'; };
  var original = icon.type === 'external' && /\/styles\/[^\/]+\/public\//.test(url) ? url.replace(/\/styles\/[^\/]+\/public\//, '/').split('?')[0] : null;
  return [proxy(url), original ? proxy(original) : null];
}

function site_rule(page){
  var p = page.properties, sel = function(name){ return p[name] && p[name].select ? p[name].select.name : ''; };
  return {id: normalise_id(page.id), position: plain_text(p['Type']), research: sel('Research Duty'), tea_talk: sel('Tea Talk Duty'), tea: sel('Tea Duty')};
}

function site_coffee_duty(page){
  var p = page.properties;
  return {id: normalise_id(page.id), n: Number(plain_text(p['ID'])) || 0,
          frequency: p['Frequency'] && p['Frequency'].select ? p['Frequency'].select.name : '',
          content: plain_text(p['Content'])};
}

// ---- editing (tsars) ----

function site_editor(token, need){
  var constants = get_global_constants();
  var rights = site_rights(token, constants);
  if (!rights.person) throw new Error('Please sign in again.');
  if (need && !need(rights)) throw new Error('Only the tsars can change this.');
  return {constants: constants, rights: rights};
}

// Applies a tsar's edits to one page, in order:
//   {op: 'update', id, rt, checked?}            new text for a block (same type)
//   {op: 'cells', id, cells: [rt, …]}           new text for a table row
//   {op: 'insert', tmp, parent, after, type, rt}  a new block; parent/after may name an earlier tmp
//   {op: 'delete', id}
//   {op: 'title', title}                        the page's own title
// Every block must belong to that page. Returns the page as it is now.
function api_site_edit_page(token, slug, ops){
  var ed = site_editor(token, function(r){ return r.pages; });
  var constants = ed.constants;
  var page_id = Object.keys(SITE.pages).filter(function(id){ return SITE.pages[id] === slug; })[0];
  if (!page_id) throw new Error('Unknown page.');
  if (!Array.isArray(ops) || ops.length > 200) throw new Error('Too many changes at once: please save in smaller steps.');
  var known = {}, fresh = false;
  var learn = function(blocks){
    known = {};
    known[page_id] = 'page';
    (function walk(list){ list.forEach(function(b){
      known[b.id] = b.type;
      (b.rows || []).forEach(function(r){ known[r.id] = 'row'; });
      if (b.children) walk(b.children);
    }); })(blocks || []);
  };
  learn((site_pages(constants)[slug] || {}).blocks);
  var made = {};
  var resolve = function(id){
    id = String(id || '');
    if (made[id]) return made[id];
    if (!known[normalise_id(id)] && !fresh){ learn(read_site_blocks(page_id, constants)); fresh = true; }
    if (!known[normalise_id(id)]) throw new Error('That block is not on this page any more. Reload and try again.');
    return normalise_id(id);
  };
  ops.forEach(function(op){
    if (op.op === 'title'){
      notion_request('patch', 'pages/' + page_id, {properties: {title: {title: chunk_text(String(op.title || '').trim())}}}, constants);
    } else if (op.op === 'update'){
      var id = resolve(op.id), type = NOTION_TYPES[known[id]];
      if (!type) throw new Error('This block cannot be edited here.');
      var body = {};
      body[type] = {rich_text: to_notion_rich(op.rt)};
      if (type === 'to_do') body[type].checked = !!op.checked;
      notion_request('patch', 'blocks/' + id, body, constants);
    } else if (op.op === 'cells'){
      var row = resolve(op.id);
      if (known[row] !== 'row') throw new Error('Not a table row.');
      notion_request('patch', 'blocks/' + row, {table_row: {cells: (op.cells || []).map(to_notion_rich)}}, constants);
    } else if (op.op === 'insert'){
      var ntype = NOTION_TYPES[op.type];
      if (!ntype || ntype === 'code') throw new Error('Unknown kind of block: ' + op.type);
      var block = {object: 'block', type: ntype};
      block[ntype] = {rich_text: to_notion_rich(op.rt)};
      var req = {children: [block]};
      if (op.after) req.after = hyphenate_id(resolve(op.after));
      var results = notion_request('patch', 'blocks/' + resolve(op.parent) + '/children', req, constants).results || [];
      var created = results.filter(function(b){ return b.type === ntype; });
      // with "after", Notion may answer with the parent's children; the new block is the one right after it
      var after = req.after ? normalise_id(req.after) : null;
      var idx = after ? results.map(function(b){ return normalise_id(b.id); }).indexOf(after) : -1;
      var mine = idx >= 0 && results[idx + 1] ? results[idx + 1] : created[created.length - 1];
      if (!mine) throw new Error('Notion did not confirm the new block. Reload the page to see what was saved.');
      made[op.tmp] = normalise_id(mine.id);
      known[made[op.tmp]] = op.type;
    } else if (op.op === 'delete'){
      notion_request('delete', 'blocks/' + resolve(op.id), null, constants);
    } else {
      throw new Error('Unknown change: ' + op.op);
    }
  });
  log_site_edit(ed, 'page ' + slug + ': ' + ops.length + ' change' + (ops.length === 1 ? '' : 's'));
  return site_pages(constants, slug)[slug];
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

// A coffee cleaning duty's text and how often (coffee tsar, tea tsar)
function api_site_save_coffee_duty(token, duty){
  var ed = site_editor(token, function(r){ return r.coffee_duties; });
  var props = {'Content': {rich_text: chunk_text(String(duty.content || '').slice(0, 2000))}};
  if (duty.frequency) props['Frequency'] = {select: {name: String(duty.frequency)}};
  var page = notion_patch_page(hyphenate_id(duty.id), props, ed.constants);
  site_forget('data');
  log_site_edit(ed, 'coffee duty ' + duty.id);
  return site_coffee_duty(page);
}

// in the bot's log sheet, so edits made on the site can be traced
function log_site_edit(ed, what){
  try {
    var people = load_people(ed.constants);
    var who = people[ed.rights.person] ? people[ed.rights.person].name : ed.rights.person;
    ensure_log_sheet().getSheetByName(LOG_TAB).appendRow([new Date(), 'site edit', 'live', '', '', who, what]);
  } catch (e) { Logger.log('site edit log: ' + e); }
}
