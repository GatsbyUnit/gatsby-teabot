// Cancellations. Cancelling is a last resort, so it is a little public and takes a tsar's signature.
//
// Someone cancelling their own duty on the tea page only asks: the cancellation is tentative until the tsar of that
// rota (the organiser; the tea tsar for talks and tea) signs it off from the link in their email (or their tea
// page). Until then the slot stays as it is and everyone turns up; nobody answering means it goes ahead (requests
// lapse when the slot starts). Requests: Script Properties cancelreq:<code>. A tsar cancelling (Rotas site, or a
// request for their own rota) needs nobody's signature.
//
// Once signed off, the people it affects hear it in one email:
//   a talk, a just tea: the group's list (unit-wide list; TNJC, CSNJC or MLJC list), cc whoever cancelled, the tea
//                       people and the organiser;
//   tea duty:           the presenter(s), cc whoever cancelled and the organiser (coffee: the organiser);
// mode 'reason' (default): who, their reason and, when they cancelled their own, what they could have done instead
// and how they knew in advance; mode 'neutral' (a private reason): only that it is cancelled and by whom; the
// reason then goes to the organiser alone. mode 'none' (tsars only): no announcement, the old emails.

const REASON_MARK = '⟨reason⟩';   // the reason's place in a preview (the page fills in what is typed)

function slot_word(row, role){
  if (row.type === 'Coffee Cleaning') return 'coffee cleaning';
  if (role === 'tea' && row.type !== 'Just Tea') return 'tea duty';
  return {'Research Talk': 'research talk', 'Tea Talk': 'tea talk', 'External Seminar': 'external seminar', 'Leaving Tea': 'leaving tea',
          'Just Tea': 'just tea', 'TNJC': row.csnjc ? 'CSNJC' : 'TNJC', 'MLJC': 'MLJC'}[row.type] || row.type;
}

function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

// who hears about it: {to: [emails], label (for the page), list: true when a group list}
function cancel_audience(row, role, ctx){
  var c = ctx.constants;
  if (role === 'tea' && row.type !== 'Just Tea'){
    var pres = emails_of(row.presenter_ids, ctx.people);
    return pres.length ? {to: pres, label: mail_names(row.presenter_ids, ctx.people).join(', ') + ' (presenting)'} : {to: [], label: 'the organiser'};
  }
  var key = row.type === 'TNJC' ? (row.csnjc && c['csnjc_email'] ? 'csnjc_email' : 'tnjc_email') : row.type === 'MLJC' ? 'mljc_email' : 'unit_wide_email';
  var list = String(c[key] || '').trim();
  var label = {tnjc_email: 'the TNJC list', csnjc_email: 'the CSNJC list', mljc_email: 'the MLJC list', unit_wide_email: 'the unit mailing list'}[key];
  return list ? {to: [list], label: label, list: true} : {to: [], label: 'the organiser'};
}

// how the person on duty knew in advance (lines for the email); only what the bot knows to have happened
function heard_in_advance(row, role, ctx){
  var out = [], now = Date.now(), day = 864e5;
  var event = null;
  try { event = row.gcal_id && ctx.cal ? ctx.cal.getEventById(row.gcal_id) : null; } catch (e) { event = null; }
  var created = null;
  try { created = event && event.getDateCreated ? event.getDateCreated() : null; } catch (e) { created = null; }
  // the autopilot emails whoever it pencils in; only claimed for slots that went on the calendar since it took over
  var rota = rota_of_type(row.type);
  var since = (ctx.settings.auto_rotas || []).indexOf(rota) >= 0 ? load_auto_state(rota).since : '';
  if (since && created && fmt_iso_date(created) >= since) out.push('An email from the tea bot when they were pencilled in (it plans about six weeks ahead).');
  if (created) out.push('On the shared calendar since **' + fmt_day(created) + '**.');
  if (row.type === 'Coffee Cleaning') return out;
  var two = now >= row.start.getTime() - 14 * day, one = now >= row.start.getTime() - 7 * day;
  if (two && one) out.push('Reminder emails to whoever is on duty, two weeks and one week before.');
  else if (two) out.push('A reminder email to whoever is on duty, two weeks before.');
  return out;
}

// what they could have done instead (lines for the email)
function could_have(row, role, first){
  var deadline = handon_deadline(row, role), today = fmt_iso_date(start_of_today());
  var d = fmt_day(parse_iso_date(deadline));
  return [
    today <= deadline
      ? 'Press "Can\'t make it" on their tea page (still possible until **' + d + '**): the bot hands it to the next person in line, and ' + first + ' keeps their turn.'
      : 'Press "Can\'t make it" on their tea page by **' + d + '**: the bot would have handed it to the next person in line, and ' + first + ' would have kept their turn.',
    'Agree it with a colleague and hand it over with Swap on their tea page, right up to the day.',
    'Ask around on Slack whether anyone can step in.'
  ];
}

// The announcement: {to, cc, subject, blocks}. by: {id} (cancelled their own) or {title} (a tsar, e.g. "The TNJC
// Tsar"); reason null: a preview, with REASON_MARK in its place.
// by.signed: the title of the tsar who signed it off; opts.drop_tea: a tsar cancelled the talk and the tea;
// opts.rank: the cancellation-league line (cancel_rank_line), for the version with the reason
function cancel_announcement(row, role, ctx, by, mode, reason, opts){
  opts = opts || {};
  var aud = cancel_audience(row, role, ctx);
  var organiser = admin_email_for_type(row.type, ctx.constants);
  var who = by.id ? mail_name(by.id, ctx.people) : by.title;
  var first = who;
  var what = slot_word(row, role) + (opts.drop_tea ? ' and the tea' : '');
  var coffee = row.type === 'Coffee Cleaning';
  var when = coffee ? 'the week of ' + fmt_day(row.start) : fmt_day(row.start) + ', ' + fmt_time(row.start);
  var talk = role === 'presenter';
  var tea_on = talk && !opts.drop_tea && row.tea_ids.filter(function(id){ return id !== by.id; }).length > 0;
  var subject = with_emoji(row, role, cap(what) + ' ' + (coffee ? 'in the week of ' : 'on ') + fmt_day(row.start) + ' cancelled' + (by.id ? ' by ' + who : ''));
  var blocks;
  if (mode === 'neutral'){
    blocks = [cap(what) + ' ' + (coffee ? 'in ' : 'on ') + '**' + when + '** is cancelled (' + (by.id ? who : who.replace(/^The /, 'the ')) + ').'];
    if (tea_on) blocks.push('Tea still happens, so come anyway: it is just tea this time.');
  } else {
    blocks = ['**' + who + '** has cancelled the ' + what + ' ' + (coffee ? 'in ' : 'on ') + '**' + when + '**.',
              (by.id ? 'Their reason: ' : 'The reason: ') + '"' + (reason === null || reason === undefined ? REASON_MARK : reason) + '"'];
    if (tea_on) blocks.push('Tea still happens, so come anyway: it is just tea this time.');
    if (role === 'tea' && !coffee) blocks.push('So nobody is bringing tea and snacks this time, unless someone steps in.');
    if (by.id){
      blocks.push('For the record, what ' + first + ' could have done instead:', {items: could_have(row, role, first)});
      var heard = heard_in_advance(row, role, ctx);
      if (heard.length) blocks.push('How ' + first + ' knew about it in advance:', {items: heard});
      if (opts.rank) blocks.push(opts.rank);
    }
  }
  if (by.signed) blocks.push('Signed off by the ' + by.signed + '.');
  var cc = [];
  if (by.id) cc = cc.concat(emails_of([by.id], ctx.people));
  if (talk) cc = cc.concat(emails_of(row.tea_ids, ctx.people));
  if (organiser) cc.push(organiser);
  cc = cc.filter(function(e, i, a){ return e && a.indexOf(e) === i && aud.to.indexOf(e) < 0; });
  var to = aud.to.length ? aud.to : (organiser ? [organiser] : []);
  cc = cc.filter(function(e){ return to.indexOf(e) < 0; });
  return {to: to, cc: cc, subject: subject, blocks: blocks, label: aud.label, list: !!aud.list};
}

// sends it; the organiser gets the reason separately when it was kept private
function send_cancel_announcement(row, role, ctx, by, mode, reason, opts){
  var a = cancel_announcement(row, role, ctx, by, mode, reason, opts);
  if (!a.to.length) return a;
  var organiser = admin_email_for_type(row.type, ctx.constants);
  send_mail(a.to.join(','), a.subject, a.blocks, ctx.constants, {cc: a.cc.join(','), reply_to: organiser || undefined, no_leave: a.list});
  if (mode === 'neutral' && organiser){
    send_mail(organiser, 'The reason (private): ' + a.subject, [
      'The announcement went out without the reason, as asked. For you only:',
      {table: [['Slot', fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)) + ', ' + row.type], ['Reason', reason]]},
      'To undo: put the people back on the Gatsby Rotas site and remove "Cancelled" from the title.'
    ], ctx.constants, {as: row.type});
  }
  log_row(ctx, 'page', row.type, row.start, 'cancellation announced', (mode === 'neutral' ? 'neutral, ' : 'with reason, ') + 'to ' + a.label);
  return a;
}

// what the cancel dialog shows: who hears it and both versions, the reason as REASON_MARK
function cancel_preview(row, role, ctx, by){
  by = Object.assign({signed: cancel_signer(row, ctx)}, by);
  var text = function(mode){
    var a = cancel_announcement(row, role, ctx, by, mode, null);
    return {subject: a.subject, text: blocks_to_text(a.blocks)};
  };
  var a = cancel_announcement(row, role, ctx, by, 'reason', null);
  return {to: a.label, cc: a.cc.length, reason: text('reason'), neutral: text('neutral'), mark: REASON_MARK, signer: by.signed};
}

// ---- tentative cancellations: the tsar signs off ----

const CANCEL_REQ_PREFIX = 'cancelreq:';

function cancel_requests(){
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function(k){ return k.indexOf(CANCEL_REQ_PREFIX) === 0; }).map(function(k){ return JSON.parse(all[k]); });
}

function cancel_request(code){
  var raw = /^[0-9a-f]{32}$/.test(String(code)) ? PropertiesService.getScriptProperties().getProperty(CANCEL_REQ_PREFIX + code) : null;
  return raw ? JSON.parse(raw) : null;
}

function drop_cancel_request(code){
  PropertiesService.getScriptProperties().deleteProperty(CANCEL_REQ_PREFIX + code);
}

// the title of the tsar who signs off cancellations of this slot ('TNJC Tsar', 'Tea Tsar', …)
function cancel_signer(row, ctx){
  var org = split_list(admin_email_for_type(row.type, ctx.constants) || '')[0] || '';
  return (org && tsar_title(org, row.type, ctx.constants)) || 'Tea Tsar';
}

function is_slot_tsar(row, email, ctx){
  email = String(email || '').toLowerCase();
  return !!email && split_list(admin_email_for_type(row.type, ctx.constants) || '').some(function(e){ return e.toLowerCase() === email; });
}

// someone asks to cancel their duty (role) in this slot. Returns the message for the page.
function request_cancellation(row, role, me_id, reason, mode, ctx){
  var signer = cancel_signer(row, ctx);
  if (is_slot_tsar(row, ctx.me_identity && ctx.me_identity.email, ctx)){   // their own rota: they sign it themselves
    return carry_out_cancellation({row_id: row.id, role: role, from: me_id, reason: reason, mode: mode}, row, ctx, signer) + ' (You are the ' + signer + ', so it needed no other signature.)';
  }
  cancel_requests().filter(function(r){ return r.row_id === row.id && r.role === role && r.from === me_id; }).forEach(function(r){ drop_cancel_request(r.code); });
  var req = {code: Utilities.getUuid().replace(/-/g, ''), row_id: row.id, role: role, from: me_id, reason: reason, mode: mode,
             created: Date.now(), start: row.start.getTime(), type: row.type};
  PropertiesService.getScriptProperties().setProperty(CANCEL_REQ_PREFIX + req.code, JSON.stringify(req));
  var name = mail_name(me_id, ctx.people);
  var what = slot_word(row, role);
  var slot = fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)) + ', ' + row.type;
  var organiser = admin_email_for_type(row.type, ctx.constants);
  var a = cancel_announcement(row, role, ctx, {id: me_id, signed: signer}, mode, reason, {rank: mode === 'reason' ? cancel_rank_line(me_id, ctx, true) : ''});
  if (organiser) send_mail(organiser, with_emoji(row, role, 'To sign off: ' + name + ' wants to cancel the ' + what + ' on ' + fmt_day(row.start)), [
    '**' + name + '** wants to cancel the ' + what + ':',
    {table: [['Slot', slot], ['Reason', reason], ['Announcement', mode === 'neutral' ? 'neutral (the reason stays with you)' : 'with the reason']]},
    'Nothing happens until you sign it off. If you don\'t, the ' + what + ' stays on and everyone turns up as planned.',
    {link: 'Sign it off or turn it down', url: page_link(ctx.settings, {cancel: req.code})},
    'If you sign it off, this goes to ' + a.label + ':',
    {heading: a.subject}
  ].concat(a.blocks), ctx.constants, {as: row.type, reply_to: emails_of([me_id], ctx.people)[0] || undefined});
  var me = ctx.people[me_id];
  if (me && me.email) send_mail(me.email, with_emoji(row, role, 'Tentative: your cancellation of the ' + what + ' on ' + fmt_day(row.start)), [
    'Your cancellation is **tentative**: it goes through only once the ' + signer + ' signs it off. Until then you are still on duty, and the ' + what + ' is on.',
    {table: [['Slot', slot], ['Reason', reason]]},
    'If the ' + signer + ' doesn\'t answer, it goes ahead as planned, so you may want to nudge them. If you find someone after all, withdraw the cancellation on your tea page and use Swap.',
    {link: 'Open my tea page', url: tea_page_link_for(me_id, ctx)}
  ], ctx.constants, organiser ? {reply_to: organiser} : {});
  log_row(ctx, 'page', row.type, row.start, 'cancellation requested', names_of([me_id], ctx.people)[0] + ': ' + reason);
  return 'Tentative: the ' + signer + ' has to sign it off. Until then you are still on duty and the ' + what + ' is on; if they don\'t answer, it goes ahead.';
}

// the slot still as the request found it: upcoming, not cancelled, the person still on that duty
function cancel_request_check(code, ctx){
  var req = cancel_request(code);
  if (!req) throw new Error('This cancellation has already been signed off, turned down or withdrawn.');
  var row = to_row(notion_get_page(req.row_id, ctx.constants));
  var ids = req.role === 'tea' ? row.tea_ids : row.presenter_ids;
  if (!row.start || row.start.getTime() <= Date.now() || ids.indexOf(req.from) < 0 || (req.role === 'presenter' && is_cancelled_title(row.title))){
    drop_cancel_request(code);
    throw new Error('This slot has changed or is over, so there is nothing to sign off any more.');
  }
  return {req: req, row: row};
}

// what the sign-off page shows
function cancel_request_info(code, ctx){
  var c = cancel_request_check(code, ctx), req = c.req, row = c.row;
  var a = cancel_announcement(row, req.role, ctx, {id: req.from, signed: cancel_signer(row, ctx)}, req.mode, req.reason, {rank: req.mode === 'reason' ? cancel_rank_line(req.from, ctx, true) : ''});
  return {who: mail_name(req.from, ctx.people), what: slot_word(row, req.role), when: fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)),
          type: row.type, reason: req.reason, mode: req.mode, signer: cancel_signer(row, ctx), to: a.label, subject: a.subject, text: blocks_to_text(a.blocks)};
}

// the tsar answers (the code in their link is the key)
function answer_cancellation(code, approve, ctx){
  var c = cancel_request_check(code, ctx), req = c.req, row = c.row;
  var signer = cancel_signer(row, ctx);
  drop_cancel_request(code);
  var name = mail_name(req.from, ctx.people), what = slot_word(row, req.role);
  if (!approve){
    var me = ctx.people[req.from];
    if (me && me.email) send_mail(me.email, with_emoji(row, req.role, 'Not cancelled: the ' + what + ' on ' + fmt_day(row.start)), [
      'The ' + signer + ' did not sign off your cancellation, so the ' + what + ' on **' + fmt_day(row.start) + '** goes ahead and is still yours.',
      'Can\'t do it after all? Hand it on with "Can\'t make it" (if there is still time) or agree a swap with a colleague, on your tea page.',
      {link: 'Open my tea page', url: tea_page_link_for(req.from, ctx)}
    ], ctx.constants, {reply_to: admin_email_for_type(row.type, ctx.constants) || undefined});
    log_row(ctx, 'page', row.type, row.start, 'cancellation turned down', names_of([req.from], ctx.people)[0]);
    return 'Turned down. ' + name + ' has been told the ' + what + ' goes ahead.';
  }
  return carry_out_cancellation(req, row, ctx, signer);
}

// a signed-off cancellation: counted, carried out and announced
function carry_out_cancellation(req, row, ctx, signer){
  count_cancellation(req.from);
  var by = {id: req.from, signed: signer};
  var rank = req.mode === 'reason' ? cancel_rank_line(req.from, ctx) : '';
  if (req.role === 'tea' && row.type !== 'Just Tea'){
    cancel_tea_duty(row, req.from, ctx, req.reason, req.mode, {by: by, rank: rank});
  } else {
    cancel_slot(row, ctx, {source: 'page', by: names_of([req.from], ctx.people)[0], reason: req.reason, announce: {mode: req.mode, by: by, rank: rank}});
  }
  return 'Signed off: the ' + slot_word(row, req.role) + ' on ' + fmt_day(row.start) + ' is cancelled and announced.';
}

function withdraw_cancellation(code, me_id, ctx){
  var req = cancel_request(code);
  if (!req || req.from !== me_id) throw new Error('This cancellation has already been signed off, turned down or withdrawn.');
  drop_cancel_request(code);
  log_row(ctx, 'page', req.type, new Date(req.start), 'cancellation withdrawn', names_of([me_id], ctx.people)[0]);
  return 'Withdrawn: the duty stays yours.';
}

// hourly: requests for slots that have started lapse (nobody signed them off, so they went ahead)
function prune_cancel_requests(now){
  cancel_requests().forEach(function(r){ if (r.start <= now) drop_cancel_request(r.code); });
}

// ---- the cancellation league: where someone ranks, with differential privacy ----
// Signed-off cancellations of one's own duties are counted per person from CANCEL_COUNT_KEY's `since` on. The
// announcement says where the person now ranks among the active members, as "top N%": each count gets Laplace
// noise (scale 1 / CANCEL_DP_EPSILON) before ranking, and N is rounded up to a multiple of 10, so no single
// announcement gives away anyone's exact count. Only once there is enough data: CANCEL_RANK_MIN_DAYS since
// counting began and CANCEL_RANK_MIN_TOTAL cancellations counted.

const CANCEL_COUNT_KEY = 'cancelcount';
const CANCEL_DP_EPSILON = 1;
const CANCEL_RANK_MIN_DAYS = 90;
const CANCEL_RANK_MIN_TOTAL = 10;

function load_cancel_counts(){
  var raw = PropertiesService.getScriptProperties().getProperty(CANCEL_COUNT_KEY);
  var st = raw ? JSON.parse(raw) : null;
  if (!st){
    st = {since: fmt_iso_date(start_of_today()), counts: {}, total: 0};
    PropertiesService.getScriptProperties().setProperty(CANCEL_COUNT_KEY, JSON.stringify(st));
  }
  return st;
}

function count_cancellation(id){
  var st = load_cancel_counts();
  st.counts[id] = (st.counts[id] || 0) + 1;
  st.total = (st.total || 0) + 1;
  PropertiesService.getScriptProperties().setProperty(CANCEL_COUNT_KEY, JSON.stringify(st));
}

function laplace(scale, rnd){
  var u = (rnd || Math.random)() - 0.5;
  return -scale * (u < 0 ? -1 : 1) * Math.log(1 - 2 * Math.abs(u));
}

// "top N%" for this person among the active members (noisy, rounded up to 10%), or 0 before there is enough data;
// rnd: a random source (tests)
function cancel_rank(id, ctx, rnd){
  var st = load_cancel_counts();
  var days = (start_of_today().getTime() - parse_iso_date(st.since).getTime()) / 864e5;
  if (days < CANCEL_RANK_MIN_DAYS || (st.total || 0) < CANCEL_RANK_MIN_TOTAL) return 0;
  var ids = Object.keys(ctx.people).filter(function(p){ return ctx.people[p].active; });
  if (ids.indexOf(id) < 0) ids.push(id);
  if (ids.length < 10) return 0;
  var noisy = {};
  ids.forEach(function(p){ noisy[p] = (st.counts[p] || 0) + laplace(1 / CANCEL_DP_EPSILON, rnd); });
  var above = ids.filter(function(p){ return p !== id && noisy[p] > noisy[id]; }).length;   // others who cancel more
  return Math.min(100, Math.max(10, Math.ceil(100 * (above + 1) / ids.length / 10) * 10));
}

// the line for the announcement ('' before there is enough data); preview: for the tsar's sign-off page
function cancel_rank_line(id, ctx, preview, rnd){
  var top = cancel_rank(id, ctx, rnd);
  if (!top) return '';
  var name = mail_name(id, ctx.people);
  var since = fmt_day(parse_iso_date(load_cancel_counts().since));
  return '📊 Cancellation league: ' + name + ' now ranks in the **top ' + top + '%** of the Unit\'s cancellers' + (top > 50 ? ' (still the more reliable half)' : '') +
    ' (counted since ' + since + '; rounded to 10%, with differential-privacy noise' + (preview ? ', drawn again when it goes out' : '') + ').';
}
