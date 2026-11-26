// Swaps go through straight away, whether someone hands their slot to a colleague or takes over a colleague's
// slot from their own tea page: the slot changes on the site and the calendar, and both people get one email
// with a link to undo it, in case it was a mistake (the link opens a page with an Undo button, as mail scanners
// open links). Either of them can undo until the slot starts, as long as nobody has changed the slot since. Undo
// records live in Script Properties (swapundo:<code>) until used or the slot has passed.
//
// Until 26 Nov 2026 a swap needed the other person's OK first (swap requests, swapreq:<code>). Requests made
// before then can still be answered, withdrawn and are reminded about as before, until they lapse with their slot.

const SWAP_REQUEST_PREFIX = 'swapreq:';
const SWAP_UNDO_PREFIX = 'swapundo:';
const SWAP_CONFIRM_HOURS = 24;

function swap_requests(){
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function(k){ return k.indexOf(SWAP_REQUEST_PREFIX) === 0; }).map(function(k){ return JSON.parse(all[k]); });
}

function swap_request(code){
  var raw = /^[0-9a-f]{32}$/.test(String(code)) ? PropertiesService.getScriptProperties().getProperty(SWAP_REQUEST_PREFIX + code) : null;
  return raw ? JSON.parse(raw) : null;
}

function save_swap_request(req){
  PropertiesService.getScriptProperties().setProperty(SWAP_REQUEST_PREFIX + req.code, JSON.stringify(req));
}

function drop_swap_request(code){
  PropertiesService.getScriptProperties().deleteProperty(SWAP_REQUEST_PREFIX + code);
}

function duty_word(row, duty){
  return duty === 'tea' ? (row.type === 'Coffee Cleaning' ? 'coffee duty' : 'tea duty') : row.type + ' talk';
}

function slot_table(row){
  var rows = [['Slot', fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)) + ', ' + row.type]];
  if (row.title && !is_tentative(row)) rows.push(['Title', row.title]);
  return {table: rows};
}

// a swap from someone's tea page: straight away (apply_swap emails both, with the undo link); an old open
// request for the same duty is dropped, as it no longer applies
function request_swap(row, duty, from_id, to_id, ctx, how){
  var res = apply_swap(row, duty, from_id, to_id, ctx, how);
  swap_requests().filter(function(r){ return r.row_id === row.id && r.duty === duty && r.from === from_id; }).forEach(function(r){ drop_swap_request(r.code); });
  return res;
}

// ---- taking over someone else's slot (from your own tea page) ----

const TAKE_OVER_WEEKS = 8;

// confirmed upcoming slots of the next weeks with a duty me could do (same rules as scheduling) and someone
// else on it; me on the slot already (either duty): left out
function takeable_slots(ctx){
  var me = ctx.me, today = start_of_today();
  var pages = notion_query(ctx.constants['notion_talk_db_id'], {and: [
    {property: 'Date', date: {on_or_after: fmt_iso_date(today)}},
    {property: 'Date', date: {before: fmt_iso_date(add_days(today, 7 * TAKE_OVER_WEEKS))}}
  ]}, [{property: 'Date', direction: 'ascending'}], ctx.constants);
  var out = [];
  pages.map(to_row).forEach(function(row){
    if (!row.start || row.start.getTime() <= Date.now() || is_tentative(row) || is_cancelled_title(row.title) || !is_live(ctx, row.type)) return;
    if (row.presenter_ids.indexOf(me.id) >= 0 || row.tea_ids.indexOf(me.id) >= 0) return;
    ['presenter', 'tea'].forEach(function(duty){
      if (!can_do_duty(me, row, duty)) return;
      (duty === 'tea' ? row.tea_ids : row.presenter_ids).forEach(function(id){
        if (!ctx.people[id]) return;
        out.push({row_id: row.id, duty: duty, from: id, from_name: ctx.people[id].name, type: row.type + (row.csnjc ? ' (CSNJC)' : ''),
                  when: row.type === 'Coffee Cleaning' ? 'Week of ' + fmt_day(row.start) : fmt_day(row.start) + ', ' + fmt_time(row.start),
                  duty_label: duty_label(row, duty),
                  title: duty === 'presenter' ? row.title : ''});
      });
    });
  });
  return out;
}

// me takes over from_id's duty: straight away, both emailed with the undo link
function take_over(row, duty, from_id, ctx){
  var me = ctx.me;
  if (row.presenter_ids.indexOf(me.id) >= 0 || row.tea_ids.indexOf(me.id) >= 0) throw new Error('You are already on this slot.');
  if (!row.start || row.start.getTime() <= Date.now()) throw new Error('This slot is already over.');
  request_swap(row, duty, from_id, me.id, ctx, {taken: true});
  return 'Done: the ' + duty_word(row, duty) + ' on ' + fmt_day(row.start) + ' is yours now. You both got an email, with a link to undo it in case it was a mistake.';
}

// ---- undoing a swap (link in the "Swap done" email) ----

function new_swap_undo(row, duty, from_id, to_id){
  var u = {code: Utilities.getUuid().replace(/-/g, ''), row_id: row.id, duty: duty, from: from_id, to: to_id,
           created: Date.now(), start: row.start.getTime(), type: row.type};
  PropertiesService.getScriptProperties().setProperty(SWAP_UNDO_PREFIX + u.code, JSON.stringify(u));
  return u.code;
}

function swap_undo(code){
  var raw = /^[0-9a-f]{32}$/.test(String(code)) ? PropertiesService.getScriptProperties().getProperty(SWAP_UNDO_PREFIX + code) : null;
  return raw ? JSON.parse(raw) : null;
}

function drop_swap_undo(code){
  PropertiesService.getScriptProperties().deleteProperty(SWAP_UNDO_PREFIX + code);
}

function swap_undos(){
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function(k){ return k.indexOf(SWAP_UNDO_PREFIX) === 0; }).map(function(k){ return JSON.parse(all[k]); });
}

var SWAP_UNDO_GONE = 'This swap has already been undone, or its slot is over.';

// the undo record and its slot, checked: the slot is still upcoming and still as the swap left it
function swap_undo_check(code, ctx){
  var u = swap_undo(code);
  if (!u) throw new Error(SWAP_UNDO_GONE);
  var row = to_row(notion_get_page(u.row_id, ctx.constants));
  if (!row.start || row.start.getTime() <= Date.now()){ drop_swap_undo(code); throw new Error(SWAP_UNDO_GONE); }
  var ids = u.duty === 'tea' ? row.tea_ids : row.presenter_ids;
  if (ids.indexOf(u.to) < 0 || ids.indexOf(u.from) >= 0 || (u.duty !== 'tea' && is_cancelled_title(row.title))){
    drop_swap_undo(code);
    throw new Error('This slot has changed since the swap, so it can\'t be undone here. Please ask the organiser.');
  }
  return {u: u, row: row};
}

// what the undo page shows
function swap_undo_info(code, ctx){
  var c = swap_undo_check(code, ctx), u = c.u, row = c.row;
  return {from: names_of([u.from], ctx.people)[0], to: names_of([u.to], ctx.people)[0], what: duty_word(row, u.duty),
          when: fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)), type: row.type,
          title: row.title && !is_tentative(row) ? row.title : ''};
}

// the slot goes back to the person who handed it over; both are emailed (no undo link: they can swap again)
function undo_swap(code, ctx){
  var c = swap_undo_check(code, ctx), u = c.u, row = c.row;
  validate_swap(row, u.duty, u.to, u.from, ctx, true);
  replace_on_duty(row, u.duty, u.to, u.from, ctx);
  drop_swap_undo(code);
  drop_passed(row.id, u.duty, u.from);   // a hand-on undone: it may come back to them
  var from_name = names_of([u.from], ctx.people)[0], to_name = names_of([u.to], ctx.people)[0];
  log_row(ctx, 'swap', row.type, row.start, 'swap undone', (u.duty === 'tea' ? 'tea: ' : '') + to_name + ' -> ' + from_name);
  var organiser = admin_email_for_type(row.type, ctx.constants);
  var both = emails_of([u.from, u.to], ctx.people);
  send_mail(both.length ? both.join(',') : organiser, with_emoji(row, u.duty, 'Swap undone: ' + fmt_day(row.start) + ' ' + row.type), [
    'The swap was undone, so the ' + duty_word(row, u.duty) + ' is back with ' + from_name + '. The site and the shared calendar are updated.',
    {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['Back with', from_name], ['Instead of', to_name]]},
    '[Open on the site](' + row.url + ')'
  ], ctx.constants, {reply_to: organiser, as: both.length ? undefined : row.type});
  return 'Undone: the ' + duty_word(row, u.duty) + ' on ' + fmt_day(row.start) + ' is back with ' + from_name + '. You both got an email.';
}

// what the answer page shows
function swap_request_info(code, ctx){
  var req = swap_request(code);
  if (!req) throw new Error('This request has already been answered or withdrawn.');
  var row = to_row(notion_get_page(req.row_id, ctx.constants));
  return {from: names_of([req.from], ctx.people)[0], to: names_of([req.to], ctx.people)[0], what: duty_word(row, req.duty),
          when: fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)), type: row.type,
          title: row.title && !is_tentative(row) ? row.title : ''};
}

function answer_swap(code, accept, ctx){
  var req = swap_request(code);
  if (!req) throw new Error('This request has already been answered or withdrawn.');
  var row = to_row(notion_get_page(req.row_id, ctx.constants));
  var from = ctx.people[req.from], to = ctx.people[req.to];
  if (!accept){
    drop_swap_request(code);
    send_mail(from.email || admin_email_for_type(row.type, ctx.constants), to.name + ' can\'t take over your ' + duty_word(row, req.duty), [
      to.name + ' declined your swap request, so the slot is still yours. Please ask someone else on your tea page.',
      slot_table(row)
    ], ctx.constants, {reply_to: to.email || undefined, as: from.email ? undefined : row.type});
    log_row(ctx, 'swap', row.type, row.start, 'swap declined', from.name + ' -> ' + to.name);
    return 'Declined. ' + from.name.split(' ')[0] + ' has been told.';
  }
  if (row.start.getTime() <= Date.now()){
    drop_swap_request(code);
    throw new Error('This slot is already over.');
  }
  apply_swap(row, req.duty, req.from, req.to, ctx);   // checks the slot is still theirs; emails both
  drop_swap_request(code);
  return 'Thanks! The ' + duty_word(row, req.duty) + ' on ' + fmt_day(row.start) + ' is yours now. You both got an email.';
}

// hourly: remind requesters once after a day without an answer; requests and undo links for past slots lapse
function remind_swap_requests(ctx){
  var now = Date.now();
  swap_undos().forEach(function(u){ if (u.start <= now) drop_swap_undo(u.code); });
  prune_passed(now);
  var tokens = {};
  identity_rows(ctx.constants).rows.forEach(function(r){ if (r.id && r.token) tokens[r.id] = r.token; });
  swap_requests().forEach(function(req){
    if (req.start <= now){ drop_swap_request(req.code); return; }
    if (req.reminded || now - req.created < SWAP_CONFIRM_HOURS * 3600 * 1000) return;
    var from = ctx.people[req.from], to = ctx.people[req.to];
    if (from && from.email){
      send_mail(from.email, to.name + ' has not answered your swap request yet', [
        'A day ago you asked ' + to.name + ' to take over your ' + (req.duty === 'tea' ? 'duty' : 'talk') + ' on ' + fmt_day(new Date(req.start)) + ' (' + req.type + '). They have not answered yet, so the slot is still yours.',
        'You could remind them, or ask someone else on your tea page (that replaces this request).',
        {link: 'Open my tea page', url: tokens[req.from] ? personal_link(tokens[req.from], ctx.settings) : page_link(ctx.settings)}
      ], ctx.constants, {reply_to: to.email || undefined});
    }
    req.reminded = true;
    save_swap_request(req);
  });
}
