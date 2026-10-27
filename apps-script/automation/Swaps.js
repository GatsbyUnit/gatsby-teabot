// Swap requests: a swap needs the other person's OK. They get an email with a link to a page where they accept
// or decline (a button, not the link itself: mail scanners open links). The request also shows on both tea
// pages. No answer within a day: the requester is reminded once. A slot less than 24 hours away is swapped
// straight away, as there is no time to wait. Requests live in Script Properties until answered, withdrawn or
// the slot has passed.

const SWAP_REQUEST_PREFIX = 'swapreq:';
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

function request_swap(row, duty, from_id, to_id, ctx){
  validate_swap(row, duty, from_id, to_id, ctx);
  if (row.start.getTime() - Date.now() < SWAP_CONFIRM_HOURS * 3600 * 1000){
    return apply_swap(row, duty, from_id, to_id, ctx).replace('. You both', ' straight away, as the slot is less than a day away. You both');
  }
  var to = ctx.people[to_id], from = ctx.people[from_id];
  if (!to.email) throw new Error(to.name + ' has no registered email, so they cannot confirm. Please ask the organiser.');
  // one open request per slot, duty and person: a new one replaces the old
  swap_requests().filter(function(r){ return r.row_id === row.id && r.duty === duty && r.from === from_id; }).forEach(function(r){ drop_swap_request(r.code); });
  var req = {code: Utilities.getUuid().replace(/-/g, ''), row_id: row.id, duty: duty, from: from_id, to: to_id,
             created: Date.now(), start: row.start.getTime(), type: row.type, reminded: false};
  save_swap_request(req);
  var url = page_url(ctx.settings) + '?swap=' + req.code;
  send_mail(to.email, from.name + ' asks you to take over their ' + duty_word(row, duty) + ' on ' + fmt_day(row.start), [
    from.name + ' asks whether you can take over their ' + duty_word(row, duty) + '.',
    slot_table(row),
    {link: 'Accept or decline', url: url},
    'Or copy this address into your browser: ' + url,
    'Nothing changes until you accept. If you can\'t, please decline, so ' + from.name.split(' ')[0] + ' can ask someone else.'
  ], ctx.constants, {reply_to: from.email || admin_email_for_type(row.type, ctx.constants)});
  log_row(ctx, 'swap', row.type, row.start, 'swap requested', (duty === 'tea' ? 'tea: ' : '') + from.name + ' -> ' + to.name);
  return 'Asked ' + to.name + ' to confirm. Nothing changes until they accept; you will get an email either way.';
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
    ], ctx.constants, {reply_to: to.email || undefined});
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

// hourly: remind requesters once after a day without an answer; requests for past slots lapse
function remind_swap_requests(ctx){
  var now = Date.now();
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
        {link: 'Open my tea page', url: tokens[req.from] ? personal_link(tokens[req.from], ctx.settings) : page_url(ctx.settings)}
      ], ctx.constants, {reply_to: to.email || undefined});
    }
    req.reminded = true;
    save_swap_request(req);
  });
}
