// Server side of the personal tea page. The page itself is the separate "Gatsby Tea Page" project
// (apps-script/page), which uses this project as a library: a web page can call every top-level function
// of its own project, so the page project contains nothing but doGet and thin wrappers around the api_*
// functions below, each of which checks the visitor's token.
//
// Tokens live in column D of the identity sheet (the old scripts only use A–C). Anyone holding a link
// can act as that person: the same trust as the old forms, where you type someone's email address.

const TOKEN_COL = 4;

// ---- tokens ----

function identity_rows(constants){
  var sheet = SpreadsheetApp.openById(constants['identity_mapping_id']).getSheets()[0];
  var last = sheet.getLastRow();
  var values = last > 1 ? sheet.getRange(2, 1, last - 1, TOKEN_COL).getValues() : [];
  return {sheet: sheet, rows: values.map(function(r, i){
    return {row: i + 2, id: id_from_notion_url(r[0]), name: String(r[1]), email: String(r[2]).trim(), token: String(r[3]).trim()};
  })};
}

function ensure_tokens(constants){
  var ident = identity_rows(constants);
  if (ident.sheet.getRange(1, TOKEN_COL).getValue() === '') ident.sheet.getRange(1, TOKEN_COL).setValue('Personal page token (tea bot)');
  var made = 0;
  ident.rows.forEach(function(r){
    if (r.id && r.email && !r.token){
      ident.sheet.getRange(r.row, TOKEN_COL).setValue(new_token());
      made++;
    }
  });
  return made;
}

function new_token(){
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
}

function identity_for_token(token, constants){
  if (!/^[0-9a-f]{40}$/.test(token)) return null;
  return identity_rows(constants).rows.filter(function(r){ return r.token === token; })[0] || null;
}

function page_url(settings){
  return settings.PAGE_URL || ScriptApp.getService().getUrl();
}

function personal_link(token, settings){
  return page_url(settings) + '?t=' + token;
}

// ---- page API (called from Page.html via google.script.run) ----

function page_context(token){
  var constants = get_global_constants();
  var me = identity_for_token(token, constants);
  if (!me) throw new Error('This link is not valid any more. You can ask for a new one on the page without a link.');
  var ctx = make_context(constants, get_settings());
  if (!ctx.people[me.id]) throw new Error('Your Notion entry could not be found. Please ask the tea tsar.');
  ctx.me = ctx.people[me.id];
  ctx.me_identity = me;
  return ctx;
}

function api_state(token){
  var ctx = page_context(token);
  var me = ctx.me;
  var today = start_of_today();
  var pages = notion_query(ctx.constants['notion_talk_db_id'], {and: [
    {property: 'Date', date: {on_or_after: fmt_iso_date(today)}},
    {or: [{property: 'Presenter', relation: {contains: hyphenate_id(me.id)}}, {property: 'Tea', relation: {contains: hyphenate_id(me.id)}}]}
  ]}, [{property: 'Date', direction: 'ascending'}], ctx.constants);
  var duties = [];
  pages.map(to_row).forEach(function(row){
    if (!row.start) return;
    var when = row.type === 'Coffee Cleaning' ? 'Week of ' + fmt_day(row.start) : fmt_day(row.start) + ', ' + fmt_time(row.start);
    var add = function(duty){
      duties.push({
        row_id: row.id, type: row.type + (row.csnjc ? ' (CSNJC)' : ''), when: when, duty: duty,
        duty_label: duty === 'presenter' ? 'Presenting' : (row.type === 'Coffee Cleaning' ? 'Coffee cleaning' : 'Tea duty'),
        title: is_tentative(row) ? '' : row.title, description: row.description,
        tentative: is_tentative(row), live: is_live(ctx, row.type),
        can_title: duty === 'presenter' && !is_tentative(row),
        cancelled: is_cancelled_title(row.title),
        usual: Object.keys(ctx.people).filter(function(id){ return id !== me.id && can_do_duty(ctx.people[id], row, duty); }),
        can_cancel: duty === 'presenter' && can_cancel(row, ctx)
      });
    };
    if (row.presenter_ids.indexOf(me.id) >= 0) add('presenter');
    if (row.tea_ids.indexOf(me.id) >= 0) add('tea');
  });
  var requests = swap_requests();
  duties.forEach(function(d){
    var out = requests.filter(function(r){ return r.row_id === d.row_id && r.duty === d.duty && r.from === me.id; })[0];
    if (out) d.pending = {code: out.code, to: names_of([out.to], ctx.people)[0], created: out.created};
  });
  var incoming = requests.filter(function(r){ return r.to === me.id && r.start > Date.now(); }).map(function(r){
    var d = new Date(r.start);
    return {code: r.code, from: names_of([r.from], ctx.people)[0], what: r.duty === 'tea' ? (r.type === 'Coffee Cleaning' ? 'coffee duty' : 'tea duty') : r.type + ' talk',
            when: fmt_day(d) + (r.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(d))};
  });
  var people = Object.keys(ctx.people).map(function(id){ return ctx.people[id]; })
    .filter(function(p){ return p.active && p.name && p.id !== me.id; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); })
    .map(function(p){ return {id: p.id, name: p.name}; });
  var organiser = Object.keys(ROTAS).filter(function(rota){ return is_organiser(ctx, rota); }).map(function(rota){
    var tentative = tentative_rows(rota, ctx).filter(function(r){ return r.start >= start_of_today(); });
    var range = next_range(rota, ctx);
    return {rota: rota, label: ROTAS[rota].label, tentative: tentative.length,
            empty: tentative.filter(function(r){ return !r.presenter_ids.length && !r.tea_ids.length; }).length,
            from: range.from, to: range.to,
            tea_from: rota === 'talks' ? range.from : '', tea_to: rota === 'talks' ? fmt_iso_date(add_days(parse_iso_date(range.from), 27)) : ''};
  });
  return {
    name: me.name, email: ctx.me_identity.email, duties: duties, people: people, incoming: incoming,
    away: read_away(me), has_away_sheet: !!me.away_sheet,
    organiser: organiser, badge: royal_badge(ctx),
    notion_url: ctx.constants['notion_site_url']
  };
}

function api_swap(token, row_id, duty, to_id){
  var ctx = page_context(token);
  var row = to_row(notion_get_page(row_id, ctx.constants));
  var ids = duty === 'tea' ? row.tea_ids : row.presenter_ids;
  if (ids.indexOf(ctx.me.id) < 0) throw new Error('This is not your slot (any more). Please reload the page.');
  return request_swap(row, duty, ctx.me.id, normalise_id(to_id), ctx);
}

// the page opened from a swap-request email (the code in the link is the only key)
function api_swap_request(code){
  var ctx = make_context(get_global_constants(), get_settings());
  return swap_request_info(code, ctx);
}

function api_answer_swap(code, accept){
  var ctx = make_context(get_global_constants(), get_settings());
  var lock = LockService.getScriptLock();
  lock.waitLock(120 * 1000);   // the hourly sync can hold it for a minute or two
  try {
    return answer_swap(code, accept === true, ctx);
  } finally {
    lock.releaseLock();
  }
}

// the requester takes a request back, or the asked person answers from their own page
function api_withdraw_swap(token, code){
  var ctx = page_context(token);
  var req = swap_request(code);
  if (!req || req.from !== ctx.me.id) throw new Error('This request has already been answered or withdrawn.');
  drop_swap_request(code);
  log_row(ctx, 'swap', req.type, new Date(req.start), 'swap request withdrawn', ctx.me.name);
  return 'Withdrawn. The slot stays yours.';
}

function api_answer_swap_mine(token, code, accept){
  var ctx = page_context(token);
  var req = swap_request(code);
  if (!req || req.to !== ctx.me.id) throw new Error('This request has already been answered or withdrawn.');
  return api_answer_swap(code, accept);
}

// Cancelling is a last resort; the page offers it only behind "Swap" and asks for a reason.
function can_cancel(row, ctx){
  return PRESENTER_TYPES.indexOf(row.type) >= 0 && is_live(ctx, row.type) && !is_tentative(row) && !is_cancelled_title(row.title) &&
    row.presenter_ids.length === 1 && row.start.getTime() > Date.now();
}

function api_cancel(token, row_id, reason){
  var ctx = page_context(token);
  var row = to_row(notion_get_page(row_id, ctx.constants));
  if (row.presenter_ids.indexOf(ctx.me.id) < 0) throw new Error('This is not your talk (any more). Please reload the page.');
  if (row.presenter_ids.length > 1) throw new Error('You share this slot with someone else. Please ask the organiser.');
  if (!can_cancel(row, ctx)) throw new Error('This talk can\'t be cancelled here. Please ask the organiser.');
  reason = String(reason || '').trim().slice(0, 1000);
  if (reason.length < 10) throw new Error('Please say briefly who you asked and why nobody can take over.');
  cancel_slot(row, ctx, {source: 'page', by: ctx.me.name, reason: reason});
  return 'Cancelled. The organiser has been told, and you will be scheduled again soon.';
}

function api_title(token, row_id, title, description){
  var ctx = page_context(token);
  var row = to_row(notion_get_page(row_id, ctx.constants));
  if (row.presenter_ids.indexOf(ctx.me.id) < 0) throw new Error('Only the presenter can change the title.');
  if (is_tentative(row)) throw new Error('This slot is still tentative. You can add a title once it is confirmed.');
  title = String(title || '').trim().slice(0, 300);
  description = String(description || '').trim().slice(0, 6000);
  notion_patch_page(row.id, {
    'Title': {title: title ? [{text: {content: title}}] : []},
    'Description': {rich_text: chunk_text(description)}
  }, ctx.constants);
  row.title = title;
  row.description = description;
  var event = row.gcal_id ? ctx.cal.getEventById(row.gcal_id) : null;
  if (event){
    event.setDescription(event_description(row, ctx));
    if (ctx.settings.links_in_events) ensure_links(event, row, ctx);
  }
  log_row(ctx, 'page', row.type, row.start, 'title', ctx.me.name + ': ' + title);
  return 'Saved. Notion and the calendar now show the new title' + (description ? ' and description.' : '.');
}

function api_add_away(token, from, to, reason){
  var ctx = page_context(token);
  var sheet = away_sheet(ctx.me);
  var f = parse_iso_date(from), t = parse_iso_date(to);
  if (!f || !t) throw new Error('Please pick both dates.');
  if (t < f) throw new Error('The end date is before the start date.');
  if (t < start_of_today()) throw new Error('That range is in the past.');
  var last = Math.max(sheet.getLastRow(), 1);
  var values = sheet.getRange(1, 2, last + 1, 2).getValues();
  var row = 2;
  while (row <= values.length && (values[row - 1][0] !== '' || values[row - 1][1] !== '')) row++;
  sheet.getRange(row, 2, 1, 3).setValues([[f, t, String(reason || '').slice(0, 200)]]);
  log_row(ctx, 'page', '', null, 'away dates', ctx.me.name + ': added ' + from + ' to ' + to);
  return 'Added. The scheduler will not give you duties from ' + fmt_day(f) + ' to ' + fmt_day(t) + '.';
}

function api_remove_away(token, row_number){
  var ctx = page_context(token);
  var sheet = away_sheet(ctx.me);
  var row = Number(row_number);
  var current = read_away(ctx.me).filter(function(a){ return a.row === row && !a.calendar; })[0];
  if (!current) throw new Error('That entry has changed in the meantime. Please reload the page.');
  sheet.getRange(row, 2, 1, 3).deleteCells(SpreadsheetApp.Dimension.ROWS);
  log_row(ctx, 'page', '', null, 'away dates', ctx.me.name + ': removed ' + current.from + ' to ' + current.to);
  return 'Removed.';
}

function api_change_email(token, new_email){
  var ctx = page_context(token);
  new_email = String(new_email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(new_email)) throw new Error('That does not look like an email address.');
  var taken = identity_rows(ctx.constants).rows.some(function(r){ return r.email.toLowerCase() === new_email.toLowerCase(); });
  if (taken) throw new Error('That address is already registered.');
  var code = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('email:' + code, JSON.stringify({id: ctx.me.id, email: new_email}), 6 * 3600);
  send_mail(new_email, 'Confirm your new email for the tea system', [
    'Hi ' + ctx.me.name + ', please confirm that you want the Gatsby tea system to use this address from now on.',
    {link: 'Confirm this address', url: page_url(ctx.settings) + '?confirm=' + code},
    'The link works for 6 hours. If you did not ask for this, just ignore this email.'
  ], ctx.constants);
  return 'We sent a confirmation link to ' + new_email + '. Your address changes once you click it.';
}

function api_confirm_email(code){
  var raw = CacheService.getScriptCache().get('email:' + code);
  if (!raw) throw new Error('This confirmation link has expired or was already used.');
  var req = JSON.parse(raw);
  var constants = get_global_constants();
  var ident = identity_rows(constants);
  var mine = ident.rows.filter(function(r){ return r.id === req.id; })[0];
  if (!mine) throw new Error('Your entry could not be found. Please ask the tea tsar.');
  var old_email = mine.email;
  ident.sheet.getRange(mine.row, 3).setValue(req.email);
  CacheService.getScriptCache().remove('email:' + code);
  CacheService.getScriptCache().remove(PEOPLE_CACHE_KEY);
  if (old_email && old_email.toLowerCase() !== req.email.toLowerCase()){
    send_mail(old_email, 'Your tea system email was changed', ['The Gatsby tea system now uses ' + req.email + ' for you instead of this address. If this was not you, reply to this email.'], constants, {reply_to: constants['admin_email']});
  }
  return 'Done: the tea system now uses ' + req.email + '. Your personal link stays the same.';
}

// The page without a personal link lists the registered people by name; the link goes only to the chosen
// person's registered address, which the page shows half hidden. Limited to 3 links per person per 6 hours
// and 40 per hour overall, so nobody can flood inboxes.
function api_link_people(){
  var constants = get_global_constants();
  var people = load_people(constants);
  return identity_rows(constants).rows
    .filter(function(r){ return r.id && r.email && people[r.id] && people[r.id].active; })
    .map(function(r){ return {id: r.id, name: people[r.id].name || r.name}; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); });
}

function api_request_link(person_id){
  return send_personal_link(person_id, 'Your tea page', page_link_blocks);
}

// emails the chosen person (only ever to their registered address) a mail built around their personal link;
// rate-limited, as anyone can ask
function send_personal_link(person_id, subject, make_blocks){
  person_id = normalise_id(String(person_id || '').trim());
  if (!/^[0-9a-f]{32}$/.test(person_id)) throw new Error('Please pick your name.');
  var cache = CacheService.getScriptCache();
  var total = Number(cache.get('linkreq:all') || 0);
  if (total >= 40) throw new Error('Too many links were requested in the last hour. Please try again later.');
  var key = 'linkreq:' + person_id;
  var count = Number(cache.get(key) || 0);
  if (count >= 3) throw new Error('Your link was already sent several times today. Please check your inbox (and spam).');
  var constants = get_global_constants();
  var find = function(){ return identity_rows(constants).rows.filter(function(r){ return r.id === person_id; })[0]; };
  var row = find();
  if (!row || !row.email) throw new Error('There is no registered email for this name. Please ask the tea tsar.');
  if (!row.token){
    ensure_tokens(constants);
    row = find();
  }
  cache.put(key, String(count + 1), 6 * 3600);
  cache.put('linkreq:all', String(total + 1), 3600);
  send_mail(row.email, subject, make_blocks(personal_link(row.token, get_settings())), constants);
  return 'Sent to ' + mask_email(row.email) + '. Check your inbox (and spam).';
}

// "jan.bauer@ucl.ac.uk" -> "ja•••r@u•••.ac.uk"
function mask_email(email){
  var at = String(email).lastIndexOf('@');
  if (at < 1) return '•••';
  var local = email.slice(0, at), domain = email.slice(at + 1);
  var shown = local.length <= 2 ? local.charAt(0) + '•••' : local.slice(0, 2) + '•••' + (local.length > 4 ? local.slice(-1) : '');
  var dot = domain.indexOf('.');
  return shown + '@' + domain.charAt(0) + '•••' + (dot > 0 ? domain.slice(dot) : '');
}

function api_finalise(token, rota, email_group){
  var ctx = page_context(token);
  if (!ROTAS[rota] || !is_organiser(ctx, rota)) throw new Error('Only the organiser of this rota can do that.');
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try {
    var n = finalise_rota(rota, !!email_group, ctx);
    return n === 0 ? 'There were no tentative slots to finalise.' : 'Finalised ' + n + ' slots: they are on the calendar now' + (email_group ? ' and the group has been emailed.' : '.');
  } finally {
    lock.releaseLock();
  }
}

// One step for organisers: create the slots for the dates (bank holidays skipped, existing slots kept) and
// fill every empty one fairly. They stay tentative until the organiser has checked them and finalises.
function api_plan_slots(token, rota, ranges){
  var ctx = page_context(token);
  if (!SLOT_PLANS[rota] || !is_organiser(ctx, rota)) throw new Error('Only the organiser of this rota can do that.');
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try {
    var made = create_slots(rota, ranges || {}, ctx);
    var res = fill_slots(rota, ctx);
    res.created = made.created.length;
    res.existing = made.skipped.length;
    res.holidays = made.holidays || [];
    return res;
  } finally {
    lock.releaseLock();
  }
}

function api_fill_slots(token, rota){
  var ctx = page_context(token);
  if (!SLOT_PLANS[rota] || !is_organiser(ctx, rota)) throw new Error('Only the organiser of this rota can do that.');
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try {
    return fill_slots(rota, ctx);
  } finally {
    lock.releaseLock();
  }
}

// ---- helpers ----

function is_organiser(ctx, rota){
  var email = ctx.me_identity.email.toLowerCase();
  var admin = String(ctx.constants[ROTAS[rota].admin] || '').toLowerCase();
  var tsar = String(ctx.constants['admin_email'] || '').toLowerCase();
  return email !== '' && (email === admin || email === tsar);
}

function away_sheet(person){
  if (!person.away_sheet) throw new Error('You do not have an away-dates sheet yet. Please ask the tea tsar.');
  return SpreadsheetApp.openByUrl(person.away_sheet).getSheets()[0];
}

// upcoming away ranges from the person's sheet (columns B from, C to, D reason, from row 2)
function read_away(person){
  var today = start_of_today();
  var out = [];
  if (person.away_sheet){
    try {
      var sheet = away_sheet(person);
      var last = sheet.getLastRow();
      if (last >= 2){
        out = sheet.getRange(2, 2, last - 1, 3).getValues().map(function(r, i){
          var f = to_date(r[0]), t = to_date(r[1]);
          return f && t ? {row: i + 2, from: fmt_iso_date(f), to: fmt_iso_date(t), label: fmt_day(f) + ' – ' + fmt_day(t), reason: String(r[2]), past: t < today} : null;
        }).filter(function(a){ return a && !a.past; });
      }
    } catch (e) { /* unreadable sheet: show nothing from it */ }
  }
  return out.sort(function(a, b){ return a.from < b.from ? -1 : 1; });
}

function to_date(v){
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v === '' || v === null) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parse_iso_date(s){
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// Notion rich text is limited to 2000 characters per piece
function chunk_text(s){
  var out = [];
  for (var i = 0; i < s.length; i += 1900) out.push({text: {content: s.slice(i, i + 1900)}});
  return out;
}

// The address is also written out in full: UCL's (Microsoft) mail filter distrusts links that hide behind a button.
function page_link_blocks(url){
  return [
    'You asked for your link on the Gatsby tea page. It opens your personal page, where you can swap your slots, add your talk title and set your away dates.',
    {link: 'Open my tea page', url: url},
    'Or copy this address into your browser: ' + url,
    'Bookmark it and keep it to yourself: anyone with it can act as you in the tea system. If you did not ask for it, you can ignore this email.'
  ];
}
