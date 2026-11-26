// "Can't make it" on the tea page: the normal way to get out of a duty. Far enough ahead (HANDON_DAYS: two weeks
// for a talk, so the next person can prepare; three days for tea and coffee duty), the bot hands the duty to the
// next free person in line by the scheduling rules (fairness queue, away dates, nobody presenting within a week of
// it, nobody already on the slot), straight away. The one who handed it on keeps their turn; the new person's
// counts. Both are emailed; the one who handed it on gets a link to undo it. The new person can press "Can't make
// it" too: the duty passes on down the queue and never back to anyone who passed it on (Script Properties
// passed:<slot id>|<duty>, until the slot is over). Nobody free: nothing changes, the person and the organiser
// are told. Closer than that: swap with a colleague, or cancel as a last resort.

const HANDON_DAYS = {presenter: 14, tea: 3};
const PASSED_PREFIX = 'passed:';

// the last day on which "Can't make it" still hands this duty on (yyyy-MM-dd)
function handon_deadline(row, role){
  return sched_add_days(fmt_iso_date(row.start), -HANDON_DAYS[role === 'tea' ? 'tea' : 'presenter']);
}

function can_hand_on(row, role, today){
  return (today || fmt_iso_date(start_of_today())) <= handon_deadline(row, role);
}

function passed_ids(row_id, role){
  var raw = PropertiesService.getScriptProperties().getProperty(PASSED_PREFIX + row_id + '|' + role);
  return raw ? JSON.parse(raw).ids : [];
}

function add_passed(row, role, id){
  var ids = passed_ids(row.id, role);
  if (ids.indexOf(id) < 0) ids.push(id);
  PropertiesService.getScriptProperties().setProperty(PASSED_PREFIX + row.id + '|' + role, JSON.stringify({start: row.start.getTime(), ids: ids}));
}

function drop_passed(row_id, role, id){
  var ids = passed_ids(row_id, role).filter(function(x){ return x !== id; });
  var props = PropertiesService.getScriptProperties(), key = PASSED_PREFIX + row_id + '|' + role;
  var raw = props.getProperty(key);
  if (!raw) return;
  if (ids.length) props.setProperty(key, JSON.stringify({start: JSON.parse(raw).start, ids: ids})); else props.deleteProperty(key);
}

// hourly: lists of slots that are over go
function prune_passed(now){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function(k){
    if (k.indexOf(PASSED_PREFIX) === 0 && JSON.parse(all[k]).start <= now) props.deleteProperty(k);
  });
}

// the rota's people as sched_pick takes them; away dates are read only for those it looks at (most of the
// queue is never reached, and each away sheet takes a moment to open)
function lazy_sched_people(rota, ctx){
  return eligible_people(rota, ctx).map(function(p){
    var o = {id: p.id, name: p.name, tea_excluded: p.tea_excluded, tt_excluded: p.tt_excluded, rt_excluded: p.rt_excluded}, away = null;
    var get = function(){ return away || (away = sched_away(p)); };
    Object.defineProperty(o, 'away_from', {get: function(){ return get().from; }});
    Object.defineProperty(o, 'away_until', {get: function(){ return get().until; }});
    return o;
  });
}

// from_id can't do their duty (role) in this slot: hand it to the next free person in line. Returns the message
// for the page; throws when it can't be done here.
function hand_on(row, role, from_id, ctx){
  var ids = role === 'tea' ? row.tea_ids : row.presenter_ids;
  if (ids.indexOf(from_id) < 0) throw new Error('This is not your duty (any more). Please reload the page.');
  if (role === 'presenter' && is_cancelled_title(row.title)) throw new Error('This talk is cancelled.');   // its tea (just tea) still happens
  if (!row.start || row.start.getTime() <= Date.now()) throw new Error('This slot is already over.');
  if (!is_live(ctx, row.type)) throw new Error('The tea bot does not look after ' + row.type + ' yet. Please ask the organiser.');
  var today = fmt_iso_date(start_of_today());
  if (!can_hand_on(row, role, today)){
    throw new Error('This is less than ' + (role === 'tea' ? HANDON_DAYS.tea + ' days' : 'two weeks') + ' away, too close for the bot to hand it on. Please agree it with a colleague and hand it over with Swap, or cancel as a last resort.');
  }
  var rota = rota_of_type(row.type);
  var past = sched_past(rota, row.start, row.start, [row.id], ctx);
  var exclude = row.presenter_ids.concat(row.tea_ids).concat(passed_ids(row.id, role));
  var to = sched_pick(sched_talk(row), role, past, lazy_sched_people(rota, ctx), exclude);
  var from_name = mail_name(from_id, ctx.people);   // emails: first names
  var slot = fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)) + ', ' + row.type;
  var organiser = auto_organiser(rota, ctx).split(',')[0].trim();
  if (!to){
    log_row(ctx, 'swap', row.type, row.start, 'nobody free to hand on to', (role === 'tea' ? 'tea: ' : '') + names_of([from_id], ctx.people)[0]);
    if (organiser) send_mail(organiser, 'Nobody free to take over: ' + duty_name(row, role), [
      from_name + ' can\'t make it, but nobody else on the rota is free then, so it is still theirs. They were asked to swap with a colleague (or, as a last resort, to cancel).',
      {table: [['Slot', slot], ['On duty', from_name]]},
      {link: 'Gatsby Rotas site', url: site_url(ctx.settings)}
    ], ctx.constants, {as: rota});
    return 'Nobody else on the rota is free then, so it is still yours. Please agree it with a colleague and hand it over with Swap, or cancel as a last resort. The organiser has been told.';
  }
  replace_on_duty(row, role, from_id, to, ctx);
  add_passed(row, role, from_id);
  var to_name = mail_name(to, ctx.people);
  log_row(ctx, 'swap', row.type, row.start, 'handed on (can\'t make it)', (role === 'tea' ? 'tea: ' : '') + names_of([from_id], ctx.people)[0] + ' -> ' + names_of([to], ctx.people)[0]);
  var told = duty_mail(row, role, to, ctx, today, {from: from_id});
  if (!told && organiser) send_mail(organiser, 'Handed on, but not told: ' + duty_name(row, role), [
    from_name + ' can\'t make it, so the bot handed it to the next person in line, ' + to_name + ', who has no registered email. Please let them know.',
    {table: [['Slot', slot], ['Now', to_name]]}
  ], ctx.constants, {as: rota});
  var undo = page_link(ctx.settings, {undo: new_swap_undo(row, role, from_id, to)});
  var me = ctx.people[from_id];
  if (me && me.email) send_mail(me.email, with_emoji(row, role, 'Handed on: ' + duty_name(row, role)), [
    'You can\'t make it, so the bot has handed it to the next person in line, **' + to_name + '**, who has been told:',
    {table: [['Slot', slot], ['Now', to_name]]},
    'You keep your turn, so you will be scheduled again sooner.',
    'Pressed by mistake? You can undo it (until the slot, as long as nothing else changed):',
    {link: 'Undo: give it back to me', url: undo}
  ], ctx.constants, organiser ? {reply_to: organiser} : {});
  return 'Done: ' + to_name + ' is next in line and takes it over; you both got an email. You keep your turn.';
}

// ---- cancelling one's own duty (a last resort) ----

// Can this duty be cancelled from the tea page? A talk: its single presenter. Tea or coffee duty: anyone on it.
function can_cancel(row, ctx, role){
  if (!row.start || row.start.getTime() <= Date.now() || !is_live(ctx, row.type)) return false;
  if ((role || 'presenter') === 'presenter') return !is_cancelled_title(row.title) && PRESENTER_TYPES.indexOf(row.type) >= 0 && row.presenter_ids.length === 1 && !row.guest;
  return row.tea_ids.length > 0;
}

// someone takes themselves off the tea or coffee duty of a slot, nobody in their place (a just tea: the whole
// just tea is cancelled, as cancel_slot does). They keep their turn. One email to them, the organiser in cc.
// mode 'reason' | 'neutral': a confirmed slot's cancellation is announced (Announce.js) instead of the email below
// extra: {by (with .signed), rank} from a signed-off request
function cancel_tea_duty(row, id, ctx, reason, mode, extra){
  extra = extra || {};
  var name = mail_name(id, ctx.people);
  var before = Object.assign({}, row, {presenter_ids: row.presenter_ids.slice(), tea_ids: row.tea_ids.slice()});
  set_duty(row, 'tea', row.tea_ids.filter(function(x){ return x !== id; }), ctx);
  try { uninvite(row, [id], ctx); } catch (err) { Logger.log('Could not update the guests: ' + err); }
  log_row(ctx, 'page', row.type, row.start, 'cancelled tea duty', names_of([id], ctx.people)[0] + ': ' + reason);
  if (mode && mode !== 'none' && !is_tentative(row)){ send_cancel_announcement(before, 'tea', ctx, extra.by || {id: id}, mode, reason, {rank: extra.rank}); return; }
  var coffee = row.type === 'Coffee Cleaning';
  var what = coffee ? 'coffee cleaning' : 'tea duty';
  var organiser = admin_email_for_type(row.type, ctx.constants);
  var blocks = [
    name + ' has cancelled their ' + what + (coffee ? ' for the week of ' + fmt_day(row.start) : ' for this ' + row.type) + '. ' + (row.tea_ids.length ? 'The others on it stay.' : 'Nobody is on it now.'),
    {table: [['Slot', fmt_day(row.start) + (coffee ? '' : ', ' + fmt_time(row.start)) + ', ' + row.type], ['Reason', reason]]},
    name + ' is no longer recorded for it, so they keep their turn and will be scheduled again soon.',
    'Organiser: if someone should do it after all, put them on it on the Gatsby Rotas site.'
  ];
  var to = emails_of([id], ctx.people);
  var subject = with_emoji(row, 'tea', 'Cancelled: ' + what) + ' ' + (coffee ? 'in the week of ' : 'on ') + fmt_day(row.start);
  if (to.length) send_mail(to[0], subject, blocks, ctx.constants, {reply_to: organiser, cc: organiser});
  else send_mail(organiser, subject, blocks, ctx.constants, {as: row.type});
}
