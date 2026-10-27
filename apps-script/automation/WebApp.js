// Server side of the personal tea page. The page itself is the separate "Gatsby Tea Page" project
// (apps-script/page), which uses this project as a library: a web page can call every top-level function
// of its own project, so the page project contains nothing but doGet and thin wrappers around the api_*
// functions below, each of which checks the visitor's token.
//
// Tokens live in column D of the identity sheet (the old scripts only use A–C). Anyone holding a link
// can act as that person: the same trust as the old forms, where you type someone's email address.

const TOKEN_COL = 4;
const AWAY_CAL_COL = 5;

// ---- tokens ----

function identity_rows(constants){
  var sheet = SpreadsheetApp.openById(constants['identity_mapping_id']).getSheets()[0];
  var last = sheet.getLastRow();
  var values = last > 1 ? sheet.getRange(2, 1, last - 1, AWAY_CAL_COL).getValues() : [];
  return {sheet: sheet, rows: values.map(function(r, i){
    return {row: i + 2, id: id_from_notion_url(r[0]), name: String(r[1]), email: String(r[2]).trim(), token: String(r[3]).trim(), away_calendar: String(r[4] || '').trim()};
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
        can_zoom: duty === 'presenter' && !is_tentative(row),
        cancelled: is_cancelled_title(row.title),
        can_cancel: duty === 'presenter' && can_cancel(row, ctx)
      });
    };
    if (row.presenter_ids.indexOf(me.id) >= 0) add('presenter');
    if (row.tea_ids.indexOf(me.id) >= 0) add('tea');
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
  var seminars = load_rows('External Seminar', today, add_days(today, 90), ctx).map(function(r){
    return {row_id: r.id, when: fmt_day(r.start) + ', ' + fmt_time(r.start), title: r.title && !is_tentative(r) ? r.title : ''};
  });
  return {
    name: me.name, email: ctx.me_identity.email, duties: duties, people: people,
    away: read_away(me), has_away_sheet: !!me.away_sheet, away_calendar: ctx.me_identity.away_calendar,
    organiser: organiser, seminars: seminars, zoom_admin: zoom_admin_name(ctx),
    notion_url: ctx.constants['notion_site_url']
  };
}

function api_swap(token, row_id, duty, to_id){
  var ctx = page_context(token);
  var row = to_row(notion_get_page(row_id, ctx.constants));
  var ids = duty === 'tea' ? row.tea_ids : row.presenter_ids;
  if (ids.indexOf(ctx.me.id) < 0) throw new Error('This is not your slot (any more). Please reload the page.');
  return apply_swap(row, duty, ctx.me.id, normalise_id(to_id), ctx);
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
  send_mail(row.email, 'Your tea page', page_link_blocks(personal_link(row.token, get_settings())), constants);
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

function api_create_slots(token, rota, ranges){
  var ctx = page_context(token);
  if (!SLOT_PLANS[rota] || !is_organiser(ctx, rota)) throw new Error('Only the organiser of this rota can do that.');
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try {
    var r = create_slots(rota, ranges || {}, ctx);
    var msg = r.created.length ? 'Created ' + r.created.length + ' tentative slots. Delete the ones you do not need in Notion (holidays, closures, deadlines), then fill them.' : 'No new slots were needed.';
    if (r.skipped.length) msg += ' (' + r.skipped.length + ' already existed and were left alone.)';
    return msg;
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

// Zoom is set up by the unit admin (constants row 28), on request: for your own talk, or for an external seminar
function api_request_zoom(token, row_id, reason){
  var ctx = page_context(token);
  var row = to_row(notion_get_page(row_id, ctx.constants));
  var own = row.presenter_ids.indexOf(ctx.me.id) >= 0;
  if (!own && row.type !== 'External Seminar') throw new Error('You can request Zoom for your own talks and for external seminars.');
  if (row.start < start_of_today()) throw new Error('That talk is in the past.');
  var admin = ctx.constants['gatsby_admin_email'];
  if (!admin) throw new Error('No unit admin address is set (constants sheet, row 28). Please ask the tea tsar.');
  send_mail(admin, 'Zoom request: ' + row.type + ' on ' + fmt_day(row.start), [
    ctx.me.name + ' asks for Zoom to be set up for this talk.',
    {table: [['Talk', row.type + (row.title && !is_tentative(row) ? ': ' + row.title : '')], ['When', fmt_day(row.start) + ', ' + fmt_time(row.start)],
             ['Presenter', names_of(row.presenter_ids, ctx.people).join(', ') || row.guest || '–'], ['Requested by', ctx.me.name + ' (' + ctx.me_identity.email + ')'],
             ['Reason', String(reason || '').slice(0, 500) || '–']]},
    'Reply to this email to reach ' + ctx.me.name.split(' ')[0] + '.'
  ], ctx.constants, {reply_to: ctx.me_identity.email});
  log_row(ctx, 'page', row.type, row.start, 'zoom request', ctx.me.name);
  return 'Sent to ' + zoom_admin_name(ctx) + ', who sets up Zoom. Replies come straight to you.';
}

// Opt-in: a Google Calendar of the person's choice, shared with the bot as free/busy only. Every busy day
// in it counts as away (for the page and for scheduling). '' turns it off.
function api_set_away_calendar(token, calendar_id){
  var ctx = page_context(token);
  calendar_id = String(calendar_id || '').trim();
  if (calendar_id){
    if (calendar_id.toLowerCase() === String(ctx.constants['google_calendar_id']).toLowerCase()) throw new Error('That is the tea calendar itself; please pick one of your own calendars.');
    calendar_busy_ranges(calendar_id, start_of_today(), add_days(start_of_today(), 30));   // throws if the bot cannot see it
  }
  var ident = identity_rows(ctx.constants);
  if (ident.sheet.getRange(1, AWAY_CAL_COL).getValue() === '') ident.sheet.getRange(1, AWAY_CAL_COL).setValue('Away calendar (tea bot)');
  ident.sheet.getRange(ctx.me_identity.row, AWAY_CAL_COL).setValue(calendar_id);
  CacheService.getScriptCache().remove(PEOPLE_CACHE_KEY);
  log_row(ctx, 'page', '', null, 'away calendar', ctx.me.name + (calendar_id ? ': on' : ': off'));
  return calendar_id ? 'Connected. Busy days in that calendar now count as away dates.' : 'Disconnected. Only the away dates you enter here count now.';
}

// busy days of a calendar shared with the bot (free/busy is enough), as [{from, to}] (yyyy-MM-dd, inclusive)
function calendar_busy_ranges(calendar_id, from, to){
  var res = Calendar.Freebusy.query({timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{id: calendar_id}]});
  var cal = res.calendars && res.calendars[calendar_id];
  if (!cal || (cal.errors && cal.errors.length)){
    throw new Error('The bot cannot see that calendar yet. In Google Calendar, open the calendar\'s settings, under "Share with specific people" add gatsby.teabot@gmail.com with "See only free/busy", then try again.');
  }
  return busy_to_day_ranges(cal.busy || []);
}

function busy_to_day_ranges(busy){
  return busy.map(function(b){
    var start = new Date(b.start), end = new Date(new Date(b.end).getTime() - 1);   // end is exclusive
    return {from: fmt_iso_date(start), to: fmt_iso_date(end < start ? start : end)};
  });
}

function zoom_admin_name(ctx){
  var admin = String(ctx.constants['gatsby_admin_email'] || '').toLowerCase();
  var hit = Object.keys(ctx.people).map(function(id){ return ctx.people[id]; }).filter(function(p){ return p.email.toLowerCase() === admin; })[0];
  return hit ? hit.name.split(' ')[0] : 'the unit admin';
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

// upcoming away ranges: from the person's sheet (columns B from, C to, D reason, from row 2; removable)
// and, if connected, busy days from their away calendar (shown, not removable here)
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
  if (person.away_calendar){
    try {
      calendar_busy_ranges(person.away_calendar, today, add_days(today, 180)).forEach(function(r){
        var f = parse_iso_date(r.from), t = parse_iso_date(r.to);
        out.push({row: 0, from: r.from, to: r.to, label: fmt_day(f) + (r.to !== r.from ? ' – ' + fmt_day(t) : ''), reason: 'from your calendar', calendar: true});
      });
    } catch (e) {
      out.push({row: 0, from: '', to: '', label: 'Your away calendar cannot be read at the moment', reason: '', calendar: true});
    }
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

function page_link_blocks(url){
  return [
    'Here is your personal page for the Gatsby tea system. You can swap your slots, add your talk title and set your away dates there.',
    {link: 'Open my tea page', url: url},
    'Bookmark it. Keep it to yourself: anyone with this link can act as you in the tea system.'
  ];
}
