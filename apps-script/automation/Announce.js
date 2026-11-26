// Cancellation announcements: cancelling is a last resort, so it is a little public. When someone cancels a
// confirmed slot themselves (tea page), or a tsar does (Rotas site), the people it affects hear it in one email:
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
    return pres.length ? {to: pres, label: names_of(row.presenter_ids, ctx.people).join(', ') + ' (presenting)'} : {to: [], label: 'the organiser'};
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
// opts.drop_tea: a tsar cancelled the talk and the tea
function cancel_announcement(row, role, ctx, by, mode, reason, opts){
  opts = opts || {};
  var aud = cancel_audience(row, role, ctx);
  var organiser = admin_email_for_type(row.type, ctx.constants);
  var who = by.id ? names_of([by.id], ctx.people)[0] : by.title;
  var first = by.id ? who.split(' ')[0] : '';
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
      blocks.push(first + ' keeps their turn, so they will be scheduled again soon. The tea bot is not angry, just a little disappointed. 🫖');
    }
  }
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
  var text = function(mode){
    var a = cancel_announcement(row, role, ctx, by, mode, null);
    return {subject: a.subject, text: blocks_to_text(a.blocks)};
  };
  var a = cancel_announcement(row, role, ctx, by, 'reason', null);
  return {to: a.label, cc: a.cc.length, reason: text('reason'), neutral: text('neutral'), mark: REASON_MARK};
}
