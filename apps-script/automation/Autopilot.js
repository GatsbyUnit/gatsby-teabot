// Autopilot: the bot schedules the rotas in AUTO_TYPES (Automation tab) by itself, from the daily organiser job
// (run_daily_reminders, 8:00). Each morning, per rota:
//  1. Away check: whoever is on duty in a slot still at least AUTO_HANDOVER_DAYS away and has away dates covering
//     it is replaced by the next free person in line (same fairness rules as planning). Both are told, and the
//     organiser gets a summary. If nobody is free, nothing changes and the organiser is told once.
//  2. Slots it planned AUTO_REVIEW_DAYS ago go on the calendar.
//  3. Mondays (and on its first run for a rota): it creates the rota's missing slots from AUTO_FIRST_DAYS ahead to
//     the end of the week AUTO_WEEKS ahead, fills them as "Plan these dates" does, tells everyone it pencilled in
//     and emails the organiser the list.
// So the person on duty hears once, when pencilled in; until three weeks before, adding away dates is all it takes
// to hand a slot on. Whoever gets a slot without that email (a replacement, someone the organiser put on by hand)
// is told when it happens or when the slot goes on the calendar.
// "Missing" means the date never had a slot while the autopilot was looking: it remembers every slot it has seen
// or made, so a removed slot stays removed, while dates nobody planned yet are filled. Nothing is planned closer
// than AUTO_FIRST_DAYS ahead. Days off for every rota: CLOSED_DATES; a one-off block before it is planned: a slot
// titled "Cancelled: <reason>".
// State, Script Properties auto:<rota>: {since, planned: {slot id: {k: '<type>|date', at: planned on, sent: [ids
// told], warned: true once the organiser heard it has nobody}}, seen: [keys], stuck: ['date|slot|person']}.

const AUTO_PREFIX = 'auto:';
const AUTO_REVIEW_DAYS = 3;
const AUTO_FIRST_DAYS = 10;      // the review days plus a week's notice
const AUTO_HANDOVER_DAYS = 21;   // until this many days before a slot, away dates hand it to the next free person
const AUTO_ROTA_NAMES = {'tnjc': 'TNJC', 'mljc': 'MLJC', 'coffee': 'Coffee Cleaning', 'coffee cleaning': 'Coffee Cleaning',
  'talks': 'talks', 'research talk': 'talks', 'research talks': 'talks', 'tea talk': 'talks', 'tea talks': 'talks', 'research / tea talks': 'talks'};
const AUTO_TALK_TYPES = ['Research Talk', 'Tea Talk', 'Just Tea', 'Leaving Tea', 'External Seminar'];

// AUTO_TYPES -> rota keys of ROTAS / SLOT_PLANS ('talks' for research and tea talks)
function auto_rotas_of(str){
  var out = [];
  split_list(str || '').forEach(function(x){
    var r = AUTO_ROTA_NAMES[x.toLowerCase()];
    if (r && out.indexOf(r) < 0) out.push(r);
  });
  return out;
}

function auto_types(rota){
  return rota === 'talks' ? AUTO_TALK_TYPES : [SLOT_PLANS[rota][0].type];
}

function run_autopilot(constants, settings){
  if (!settings.auto_rotas.length || settings.dry_run) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) throw new Error('The calendar sync was busy for a minute; the autopilot tries again tomorrow.');
  try {
    var ctx = make_context(constants, settings);
    var today = fmt_iso_date(start_of_today());
    var errors = [];
    settings.auto_rotas.forEach(function(rota){
      try { autopilot_rota(rota, ctx, today); }
      catch (err) { errors.push(rota + ': ' + (err && err.message ? err.message : err)); }
    });
    if (errors.length) throw new Error(errors.join('; '));
  } finally {
    lock.releaseLock();
  }
}

function autopilot_rota(rota, ctx, today){
  var st = load_auto_state(rota);
  var first = !st.since;
  var out = {};
  try {
    out.handed = auto_recheck(rota, ctx, today, st);
    out.finalised = auto_finalise(rota, ctx, today, st);
    if (first || iso_weekday(today) === 1) out.planned = auto_plan(rota, ctx, today, st);
    if (first) st.since = today;
  } finally {
    save_auto_state(rota, st, today);
  }
  return out;
}

// who is on duty in a slot: [{id, role}]; presenters only where they present (not a guest's slot, not the leaver)
function on_duty(row){
  var out = [];
  if (PRESENTER_TYPES.indexOf(row.type) >= 0 && !row.guest) row.presenter_ids.forEach(function(id){ out.push({id: id, role: 'presenter'}); });
  row.tea_ids.forEach(function(id){ out.push({id: id, role: 'tea'}); });
  return out;
}

// ---- 1. away check ----

function auto_recheck(rota, ctx, today, st){
  var rows = [];
  auto_types(rota).forEach(function(type){
    rows = rows.concat(load_rows(type, parse_iso_date(sched_add_days(today, AUTO_HANDOVER_DAYS)), null, ctx));
  });
  rows = rows.filter(function(r){ return !is_cancelled_title(r.title); });
  // only the away dates of the people on duty are read, unless someone clashes
  var away = {};
  var away_of = function(id){ return away[id] || (away[id] = ctx.people[id] ? sched_away(ctx.people[id]) : {from: [], until: []}); };
  var clashes = [];
  rows.forEach(function(r){
    var t = sched_talk(r);
    on_duty(r).forEach(function(d){
      var a = away_of(d.id);
      if (sched_overlap(t.date, t.date_end || t.date, a.from, a.until)) clashes.push({row: r, role: d.role, id: d.id});
    });
  });
  if (!clashes.length) return [];

  var people = sched_people(rota, ctx, null);
  var starts = clashes.map(function(c){ return c.row.start; }).sort(function(a, b){ return a - b; });
  var past = sched_past(rota, starts[0], starts[starts.length - 1], [], ctx);
  var handed = [], stuck = [];
  clashes.forEach(function(c){
    var row = c.row;
    var t = sched_talk(row);
    var others = past.filter(function(x){ return x.id !== row.id; });
    var to = sched_pick(t, c.role, others, people, row.presenter_ids.concat(row.tea_ids).concat(passed_ids(row.id, c.role)));
    if (!to){
      var key = t.date + '|' + row.id + '|' + c.id;
      if (st.stuck.indexOf(key) < 0){ st.stuck.push(key); stuck.push(c); }
      return;
    }
    replace_on_duty(row, c.role, c.id, to, ctx);
    past = others.concat([sched_talk(row)]);   // later picks count this one
    var planned = st.planned[row.id];
    if (planned) planned.sent = (planned.sent || []).concat([to]);
    save_auto_state(rota, st, today);
    log_row(ctx, 'autopilot', row.type, row.start, 'handed on (away)', (c.role === 'tea' ? 'tea: ' : '') + names_of([c.id], ctx.people)[0] + ' -> ' + names_of([to], ctx.people)[0]);
    handed.push({row: row, role: c.role, from: c.id, to: to});
    released_mail(row, c.role, c.id, to, ctx);
    duty_mail(row, c.role, to, ctx, today, {from: c.id, live: planned && is_tentative(row) ? sched_add_days(planned.at, AUTO_REVIEW_DAYS) : ''});
  });
  if (handed.length || stuck.length) handover_mail(rota, handed, stuck, ctx);
  return handed;
}

// ---- 2. going on the calendar ----

// the autopilot's slots planned AUTO_REVIEW_DAYS ago or earlier go on the calendar; whoever on them was not told
// yet (put on by the organiser) gets their email now
function auto_finalise(rota, ctx, today, st){
  var due = Object.keys(st.planned).filter(function(id){ return sched_add_days(st.planned[id].at, AUTO_REVIEW_DAYS) <= today; });
  if (!due.length) return [];
  var rows = {};
  tentative_rows(rota, ctx).forEach(function(r){ rows[r.id] = r; });
  var done = [], empty = [];
  due.forEach(function(id){
    var r = rows[id], p = st.planned[id];
    if (!r || r.start < start_of_today()){ delete st.planned[id]; return; }   // removed, finalised by hand, or past
    if (!r.presenter_ids.length && !r.tea_ids.length && !r.guest){
      if (!p.warned){ empty.push(r); p.warned = true; }
      return;
    }
    finalise_rows([r], ctx);
    delete st.planned[id];
    save_auto_state(rota, st, today);
    done.push(r);
    on_duty(r).forEach(function(d){
      if ((p.sent || []).indexOf(d.id) < 0) duty_mail(r, d.role, d.id, ctx, today, {});
    });
  });
  if (done.length) log_row(ctx, 'autopilot', SLOT_PLANS[rota][0].type, null, 'finalised', done.length + ' slots');
  if (empty.length) auto_empty_mail(rota, empty, ctx);
  return done;
}

// ---- 3. planning ----

// the window to plan: from AUTO_FIRST_DAYS ahead to the end of the week AUTO_WEEKS ahead
function auto_window(ctx, today){
  var monday = sched_add_days(today, -((iso_weekday(today) + 6) % 7));
  return {from: sched_add_days(today, AUTO_FIRST_DAYS), to: sched_add_days(monday, ctx.settings.auto_weeks * 7 + 6)};
}

function auto_ranges(rota, win){
  return rota === 'talks' ? {research_from: win.from, research_to: win.to, tea_from: win.from, tea_to: win.to} : {from: win.from, to: win.to};
}

// keys ('<plan type>|date') of the rota's slots in the window now. Any talk-like slot (a just tea, leaving tea or
// seminar in a talk's place) takes both talk keys of its day, so the day is not planned twice.
function auto_slot_keys(rota, win, ctx){
  var keys = [];
  auto_types(rota).forEach(function(type){
    load_rows(type, parse_iso_date(win.from), parse_iso_date(win.to), ctx).forEach(function(r){
      var d = fmt_iso_date(r.start);
      if (rota === 'talks') keys.push('Research Talk|' + d, 'Tea Talk|' + d);
      else keys.push(type + '|' + d);
    });
  });
  return keys;
}

function auto_plan(rota, ctx, today, st){
  var win = auto_window(ctx, today);
  var res = {created: [], skipped: [], holidays: [], made: []};
  if (win.from <= win.to){
    auto_slot_keys(rota, win, ctx).forEach(function(k){ if (st.seen.indexOf(k) < 0) st.seen.push(k); });
    var skip = {};
    st.seen.forEach(function(k){ skip[k] = true; });
    res = create_slots(rota, auto_ranges(rota, win), ctx, skip);
    res.made.forEach(function(m){
      st.seen.push(m.key);
      if (m.id) st.planned[m.id] = {k: m.key, at: today, sent: []};
    });
    save_auto_state(rota, st, today);   // at once: a run that times out while filling must not forget its slots
  }
  var fill = fill_slots(rota, ctx);
  var live = sched_add_days(today, AUTO_REVIEW_DAYS);
  tentative_rows(rota, ctx).forEach(function(r){
    var p = st.planned[r.id];
    if (!p) return;
    var duty = on_duty(r);
    if (p.warned && (duty.length || r.guest)){ p.at = today; delete p.warned; }   // had nobody: full review time again
    duty.forEach(function(d){
      if ((p.sent || []).indexOf(d.id) >= 0) return;
      if (duty_mail(r, d.role, d.id, ctx, today, {live: p.at === today ? live : sched_add_days(p.at, AUTO_REVIEW_DAYS)})) p.sent = (p.sent || []).concat([d.id]);
    });
  });
  save_auto_state(rota, st, today);
  if (res.made.length || fill.filled.length){
    auto_plan_mail(rota, res, fill, ctx, today);
    log_row(ctx, 'autopilot', SLOT_PLANS[rota][0].type, null, 'planned', res.made.length + ' created, ' + fill.filled.length + ' filled, ' + fill.unfilled.length + ' without anyone');
  }
  return res;
}

// ---- emails ----

function auto_organiser(rota, ctx){
  return String(ctx.constants[ROTAS[rota].admin] || ctx.constants['admin_email'] || '');
}

// One email to a person on duty. opts.live: the day it goes on the calendar (yyyy-MM-dd; empty = it is on it
// already); opts.from: the person they take over from. Returns whether an email went out.
function duty_mail(row, role, id, ctx, today, opts){
  var p = ctx.people[id];
  if (!p || !p.email) return false;
  var m = duty_message(row, role);
  var blocks = [m.text];
  if (opts.from) blocks.push('You take over from ' + names_of([opts.from], ctx.people)[0] + ', who can\'t make it.');
  blocks = blocks.concat(m.more);
  var deadline = handon_deadline(row, role);
  blocks.push(deadline >= today
    ? 'Can\'t make it? Press **Can\'t make it** on your tea page by **' + fmt_day(parse_iso_date(deadline)) + '**, and the bot hands it to the next person in line (you keep your turn). After that, agree it with a colleague and hand it over with Swap.'
    : 'If you can\'t make it, agree it with a colleague and hand it over with Swap on your tea page.');
  blocks.push({link: 'Open my tea page', url: tea_page_link_for(id, ctx)});
  var cal = on_calendar(row.type);
  blocks.push((opts.live ? (cal ? 'It goes on the calendar on ' : 'It is confirmed on ') + fmt_day(parse_iso_date(opts.live)) + '.'
    : is_tentative(row) ? (cal ? 'It is still tentative until the organiser puts it on the calendar.' : 'It is still tentative until the organiser confirms it.')
    : (cal ? 'It is on the calendar.' : 'It is confirmed.')) + ' You will get the usual reminders before' + (cal ? '.' : ', and an email every day of that week.'));
  blocks.push('The rotas are planned automatically and fairly about six weeks ahead, around everyone\'s away dates.');
  var organiser = auto_organiser(rota_of_type(row.type), ctx).split(',')[0].trim();
  send_mail(p.email, m.subject, blocks, ctx.constants, organiser ? {reply_to: organiser} : {});
  return true;
}

// to the person whose away dates handed their slot on
function released_mail(row, role, from, to, ctx){
  var p = ctx.people[from];
  if (!p || !p.email) return;
  var organiser = auto_organiser(rota_of_type(row.type), ctx).split(',')[0].trim();
  send_mail(p.email, 'Handed on: ' + duty_name(row, role), [
    'Your away dates cover this, so the bot has handed it to **' + names_of([to], ctx.people)[0] + '**:',
    {table: [['Slot', fmt_day(row.start) + (row.type === 'Coffee Cleaning' ? '' : ', ' + fmt_time(row.start)) + ', ' + row.type], ['Now', names_of([to], ctx.people)[0]]]},
    'You keep your place in the queue, so you will be scheduled again soon. If the away dates were a mistake, ask ' + names_of([to], ctx.people)[0] + ' to swap back on your tea page.',
    {link: 'Open my tea page', url: tea_page_link_for(from, ctx)}
  ], ctx.constants, organiser ? {reply_to: organiser} : {});
}

function handover_mail(rota, handed, stuck, ctx){
  var to = auto_organiser(rota, ctx);
  if (!to) return;
  var label = ROTAS[rota].label;
  var line = function(row, role){ return fmt_day(row.start) + ' · ' + row.type + (role === 'tea' ? ' (tea)' : ''); };
  var blocks = [];
  if (handed.length){
    blocks.push('These people added away dates covering their slot, so the autopilot handed it to the next free person (both were told):');
    blocks.push({items: handed.map(function(h){ return line(h.row, h.role) + ': ' + names_of([h.from], ctx.people)[0] + ' → ' + names_of([h.to], ctx.people)[0]; })});
  }
  if (stuck.length){
    blocks.push('These people are away during their slot, but nobody else is free then, so nothing was changed. Please sort it out on the Gatsby Rotas site (another person, a guest, or remove the slot):');
    blocks.push({items: stuck.map(function(c){ return line(c.row, c.role) + ': ' + names_of([c.id], ctx.people)[0]; })});
  }
  blocks.push({link: 'Gatsby Rotas site', url: site_url(ctx.settings)});
  send_mail(to, label + ': ' + (handed.length ? 'slots handed on because of away dates' : 'nobody free for a slot'), blocks, ctx.constants, {as: rota});
}

function auto_plan_mail(rota, res, fill, ctx, today){
  var to = auto_organiser(rota, ctx);
  if (!to) return;
  var label = ROTAS[rota].label;
  var live = fmt_day(parse_iso_date(sched_add_days(today, AUTO_REVIEW_DAYS)));
  var go = on_calendar(SLOT_PLANS[rota][0].type) ? 'go on the calendar' : 'are confirmed';
  var lines = fill.filled.concat(fill.unfilled);
  var blocks = [
    'The autopilot planned the next ' + label + ' slots and filled them fairly, around everyone\'s away dates:',
    {items: lines.length ? lines : res.created},
    '**They ' + go + ' on ' + live + '.** Everyone on them has been told they are pencilled in; until three weeks before, adding away dates hands their slot to the next free person by itself. Until ' + live + ', change anyone or remove a slot you don\'t need (closures, retreat, deadlines) on the Gatsby Rotas site. A slot you remove is not planned again.'
  ];
  if (fill.unfilled.length) blocks.push('Nobody was available for some of them: put someone on them on the site, or remove them.');
  if (res.holidays.length) blocks.push('Skipped (bank holidays, closures): ' + res.holidays.join(', ') + '.');
  blocks.push('To keep a date free before it is planned, add a slot titled "Cancelled: <reason>" on the site. A guest speaker goes in the slot\'s guest field.');
  blocks.push('Every Monday the autopilot keeps ' + label + ' planned ' + ctx.settings.auto_weeks + ' weeks ahead. To switch it off, take ' + rota + ' out of AUTO_TYPES in the Automation tab of the constants sheet (or ask the tea tsar).');
  blocks.push({link: 'Gatsby Rotas site', url: site_url(ctx.settings)});
  if (ctx.settings.HANDBOOK_URL) blocks.push({link: 'Organiser handbook', url: ctx.settings.HANDBOOK_URL});
  send_mail(to, label + ': next slots planned, ' + (go === 'are confirmed' ? 'confirmed' : 'on the calendar') + ' on ' + live, blocks, ctx.constants, {as: rota});
}

function auto_empty_mail(rota, rows, ctx){
  var to = auto_organiser(rota, ctx);
  if (!to) return;
  var label = ROTAS[rota].label;
  var cal = on_calendar(SLOT_PLANS[rota][0].type);
  send_mail(to, label + ': nobody on duty for ' + rows.length + ' planned slot' + (rows.length === 1 ? '' : 's'), [
    'These ' + label + ' slots have nobody on duty, so they are not ' + (cal ? 'on the calendar' : 'confirmed') + ' yet:',
    {items: rows.map(function(r){ return fmt_day(r.start) + ' · ' + r.type; })},
    'Put someone (or a guest speaker) on them on the Gatsby Rotas site, or remove them. The autopilot tries to fill them again on Monday, and ' + (cal ? 'puts them on the calendar' : 'confirms them') + ' once someone is on duty.',
    {link: 'Gatsby Rotas site', url: site_url(ctx.settings)}
  ], ctx.constants, {as: rota});
}

function duty_message(row, role){
  var day = fmt_day(row.start), when = day + ', ' + fmt_time(row.start);
  if (row.type === 'Coffee Cleaning'){
    return {subject: 'Coffee cleaning in the week of ' + day, text: 'You are on coffee cleaning duty in the week of **' + day + '**.', more: []};
  }
  if (role === 'tea'){
    var what = {'Research Talk': ' for the research talk', 'Tea Talk': ' for the tea talk', 'External Seminar': ' for the external seminar', 'Leaving Tea': ' for the leaving tea'}[row.type] || '';
    return {subject: 'Tea duty on ' + day, text: 'You are on tea duty' + what + ' on **' + when + '**.', more: []};
  }
  if (row.type === 'TNJC' || row.type === 'MLJC'){
    var jc = row.type + (row.csnjc ? ' (CSNJC)' : '');
    return {subject: 'You are presenting at ' + jc + ' on ' + day, text: 'You are presenting at ' + jc + ' on **' + when + '**.',
            more: ['When you have picked a paper, add its title on your tea page so people can read it beforehand.']};
  }
  var talk = row.type === 'Research Talk' ? 'research talk' : 'tea talk';
  return {subject: 'Your ' + talk + ' on ' + day, text: 'You are giving the ' + talk + ' on **' + when + '**.',
          more: ['Add your title on your tea page when you have one.']};
}

// "presenting at MLJC on Mon 4 Jan 2027", "tea duty on …", "coffee cleaning in the week of …"
function duty_name(row, role){
  var day = fmt_day(row.start);
  if (row.type === 'Coffee Cleaning') return 'coffee cleaning in the week of ' + day;
  if (role === 'tea') return 'tea duty on ' + day;
  if (row.type === 'TNJC' || row.type === 'MLJC') return 'presenting at ' + row.type + (row.csnjc ? ' (CSNJC)' : '') + ' on ' + day;
  return 'the ' + (row.type === 'Research Talk' ? 'research talk' : 'tea talk') + ' on ' + day;
}

// What adding these away dates (Dates) does to the person's own slots, for the tea page's answer: slots on a rota
// on autopilot that the next morning's check still covers are handed on, others need a swap.
function away_clash_note(person_id, from, to, ctx){
  var auto = ctx.settings.auto_rotas || [];
  var handover_from = add_days(start_of_today(), AUTO_HANDOVER_DAYS + 1);
  var hand = [], button = [], swap = [];
  ALL_TYPES.forEach(function(type){
    load_rows(type, add_days(from, -6), to, ctx).forEach(function(r){
      if (is_cancelled_title(r.title)) return;
      var t = sched_talk(r);
      var duty = on_duty(r).filter(function(d){ return d.id === person_id; })[0];
      if (!duty || !sched_overlap(t.date, t.date_end || t.date, [fmt_iso_date(from)], [fmt_iso_date(to)])) return;
      var name = duty_name(r, duty.role);
      if (auto.indexOf(rota_of_type(r.type)) >= 0 && r.start >= handover_from) hand.push(name);
      else if (can_hand_on(r, duty.role)) button.push(name);
      else swap.push(name);
    });
  });
  var out = '';
  if (hand.length) out += ' Tomorrow morning the bot hands this to the next free person and emails you both: ' + hand.join('; ') + '.';
  if (button.length) out += ' You are still down for this; press "Can\'t make it" on it and the bot hands it to the next person in line: ' + button.join('; ') + '.';
  if (swap.length) out += ' You are still down for this, so please ask someone to swap: ' + swap.join('; ') + '.';
  return out;
}

function load_auto_state(rota){
  var raw = PropertiesService.getScriptProperties().getProperty(AUTO_PREFIX + rota);
  var st = raw ? JSON.parse(raw) : {};
  var planned = st.planned || {};
  Object.keys(planned).forEach(function(id){   // the first version marked the organiser's "nobody on duty" email 'told'
    if (planned[id].told){ planned[id].warned = true; delete planned[id].told; }
  });
  return {since: st.since || '', planned: planned, seen: st.seen || st.made || [], stuck: st.stuck || []};
}

// keys of past slots are dropped (the autopilot never plans the past anyway)
function save_auto_state(rota, st, today){
  var keep_from = sched_add_days(today, -7);
  st.seen = st.seen.filter(function(k){ return k.split('|')[1] >= keep_from; });
  st.stuck = st.stuck.filter(function(k){ return k.split('|')[0] >= keep_from; });
  PropertiesService.getScriptProperties().setProperty(AUTO_PREFIX + rota, JSON.stringify(st));
}
