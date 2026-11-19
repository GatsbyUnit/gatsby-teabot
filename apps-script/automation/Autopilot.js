// Autopilot: the bot schedules the rotas in AUTO_TYPES (Automation tab) by itself, from the daily organiser job
// (run_daily_reminders, 8:00):
//  - every Monday (and on its first run for a rota) it creates the slots after the rota's last one, up to the end
//    of the week AUTO_WEEKS ahead, fills them as "Plan these dates" does, and emails the organiser the list;
//  - three days later it puts them on the calendar and emails each person on duty, with their tea-page link.
// In between, the organiser changes people or removes slots on the site. The autopilot only extends a rota at its
// end (it never fills gaps) and never creates a slot it made before again, so a removed slot stays removed.
// Nothing is planned closer than AUTO_FIRST_DAYS ahead, so everyone gets at least a week's notice.
// Days off for every rota: CLOSED_DATES; a one-off block before it is planned: a slot titled "Cancelled: <reason>".
// State, Script Properties auto:<rota>: {since, planned: {slot id: {k: '<type>|date', at: planned on}}, made: [keys]}.

const AUTO_PREFIX = 'auto:';
const AUTO_REVIEW_DAYS = 3;
const AUTO_FIRST_DAYS = 10;   // the review days plus a week's notice
const AUTO_ROTA_NAMES = {'tnjc': 'TNJC', 'mljc': 'MLJC', 'coffee': 'Coffee Cleaning', 'coffee cleaning': 'Coffee Cleaning',
  'talks': 'talks', 'research talk': 'talks', 'research talks': 'talks', 'tea talk': 'talks', 'tea talks': 'talks', 'research / tea talks': 'talks'};

// AUTO_TYPES -> rota keys of ROTAS / SLOT_PLANS ('talks' for research and tea talks)
function auto_rotas_of(str){
  var out = [];
  split_list(str || '').forEach(function(x){
    var r = AUTO_ROTA_NAMES[x.toLowerCase()];
    if (r && out.indexOf(r) < 0) out.push(r);
  });
  return out;
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
    out.finalised = auto_finalise(rota, ctx, today, st);
    if (first || iso_weekday(today) === 1) out.planned = auto_plan(rota, ctx, today, st);
    if (first) st.since = today;
  } finally {
    save_auto_state(rota, st, today);
  }
  return out;
}

// the dates to plan: after the rota's last slot (for talks: research and tea talks each), from AUTO_FIRST_DAYS
// ahead to the end of the week AUTO_WEEKS ahead; null if nothing is due
function auto_ranges(rota, ctx, today){
  var monday = sched_add_days(today, -((iso_weekday(today) + 6) % 7));
  var until = sched_add_days(monday, ctx.settings.auto_weeks * 7 + 6);
  var earliest = sched_add_days(today, AUTO_FIRST_DAYS);
  var from_after = function(types, weekdays){
    var last = last_slot_day(types, weekdays, ctx);
    var from = last ? sched_next_day(last) : earliest;
    return from < earliest ? earliest : from;
  };
  if (rota === 'talks'){
    var r = {};
    var research = from_after(['Research Talk', 'Just Tea'], [1]);
    var tea = from_after(['Tea Talk', 'Just Tea'], [2, 4]);
    if (research <= until){ r.research_from = research; r.research_to = until; }
    if (tea <= until){ r.tea_from = tea; r.tea_to = until; }
    return r.research_from || r.tea_from ? r : null;
  }
  var from = from_after([SLOT_PLANS[rota][0].type], null);
  return from <= until ? {from: from, to: until} : null;
}

// the day (yyyy-MM-dd) of the latest slot of these types, only counting these weekdays if given
function last_slot_day(types, weekdays, ctx){
  var last = null;
  types.forEach(function(type){
    var res = notion_request('post', 'databases/' + ctx.constants['notion_talk_db_id'] + '/query', {
      filter: {property: 'Type', select: {equals: type}},
      sorts: [{property: 'Date', direction: 'descending'}],
      page_size: 20
    }, ctx.constants);
    (res.results || []).map(to_row).some(function(r){
      if (!r.start) return false;
      var d = fmt_iso_date(r.start);
      if (weekdays && weekdays.indexOf(iso_weekday(d)) < 0) return false;
      if (!last || d > last) last = d;
      return true;
    });
  });
  return last;
}

function auto_plan(rota, ctx, today, st){
  var ranges = auto_ranges(rota, ctx, today);
  var res = {created: [], skipped: [], holidays: [], made: []};
  if (ranges){
    var skip = {};
    st.made.forEach(function(k){ skip[k] = true; });
    res = create_slots(rota, ranges, ctx, skip);
    res.made.forEach(function(m){
      st.made.push(m.key);
      if (m.id) st.planned[m.id] = {k: m.key, at: today};
    });
    save_auto_state(rota, st, today);   // at once: a run that times out while filling must not forget its slots
  }
  var fill = fill_slots(rota, ctx);
  // slots that had nobody get the full review time again once someone is on them
  Object.keys(st.planned).forEach(function(id){
    if (st.planned[id].told){ st.planned[id].at = today; delete st.planned[id].told; }
  });
  if (res.made.length || fill.filled.length){
    auto_plan_mail(rota, res, fill, ctx, today);
    log_row(ctx, 'autopilot', SLOT_PLANS[rota][0].type, null, 'planned', res.made.length + ' created, ' + fill.filled.length + ' filled, ' + fill.unfilled.length + ' without anyone');
  }
  return res;
}

// the autopilot's slots planned AUTO_REVIEW_DAYS ago or earlier go on the calendar; their people are told
function auto_finalise(rota, ctx, today, st){
  var due = Object.keys(st.planned).filter(function(id){ return sched_add_days(st.planned[id].at, AUTO_REVIEW_DAYS) <= today; });
  if (!due.length) return [];
  var rows = {};
  tentative_rows(rota, ctx).forEach(function(r){ rows[r.id] = r; });
  var done = [], empty = [];
  due.forEach(function(id){
    var r = rows[id];
    if (!r || r.start < start_of_today()){ delete st.planned[id]; return; }   // removed, finalised by hand, or past
    if (!r.presenter_ids.length && !r.tea_ids.length && !r.guest){
      if (!st.planned[id].told){ empty.push(r); st.planned[id].told = true; }
      return;
    }
    finalise_rows([r], ctx);
    delete st.planned[id];
    save_auto_state(rota, st, today);
    done.push(r);
    tell_on_duty(r, ctx);
  });
  if (done.length) log_row(ctx, 'autopilot', SLOT_PLANS[rota][0].type, null, 'finalised', done.length + ' slots, people on duty emailed');
  if (empty.length) auto_empty_mail(rota, empty, ctx);
  return done;
}

function auto_organiser(rota, ctx){
  return String(ctx.constants[ROTAS[rota].admin] || ctx.constants['admin_email'] || '');
}

function auto_plan_mail(rota, res, fill, ctx, today){
  var to = auto_organiser(rota, ctx);
  if (!to) return;
  var label = ROTAS[rota].label;
  var live = fmt_day(parse_iso_date(sched_add_days(today, AUTO_REVIEW_DAYS)));
  var lines = fill.filled.concat(fill.unfilled);
  var blocks = [
    'The autopilot planned the next ' + label + ' slots and filled them fairly, around everyone\'s away dates:',
    {items: lines.length ? lines : res.created},
    '**They go on the calendar on ' + live + '**, and everyone on duty gets an email then. Until then, change anyone or remove a slot you don\'t need (closures, retreat, deadlines) on the Gatsby Rotas site. A slot you remove is not planned again.'
  ];
  if (fill.unfilled.length) blocks.push('Nobody was available for some of them: put someone on them on the site, or remove them.');
  if (res.holidays.length) blocks.push('Skipped (bank holidays, closures): ' + res.holidays.join(', ') + '.');
  blocks.push('To keep a date free before it is planned, add a slot titled "Cancelled: <reason>" on the site. A guest speaker goes in the slot\'s guest field.');
  blocks.push('Every Monday the autopilot keeps ' + label + ' planned ' + ctx.settings.auto_weeks + ' weeks ahead. To switch it off, take ' + rota + ' out of AUTO_TYPES in the Automation tab of the constants sheet (or ask the tea tsar).');
  blocks.push({link: 'Gatsby Rotas site', url: site_url(ctx.settings)});
  if (ctx.settings.HANDBOOK_URL) blocks.push({link: 'Organiser handbook', url: ctx.settings.HANDBOOK_URL});
  send_mail(to, label + ': next slots planned, on the calendar on ' + live, blocks, ctx.constants);
}

function auto_empty_mail(rota, rows, ctx){
  var to = auto_organiser(rota, ctx);
  if (!to) return;
  var label = ROTAS[rota].label;
  send_mail(to, label + ': nobody on duty for ' + rows.length + ' planned slot' + (rows.length === 1 ? '' : 's'), [
    'These ' + label + ' slots have nobody on duty, so they are not on the calendar yet:',
    {items: rows.map(function(r){ return fmt_day(r.start) + ' · ' + r.type; })},
    'Put someone (or a guest speaker) on them on the Gatsby Rotas site, or remove them. The autopilot tries to fill them again on Monday, and puts them on the calendar once someone is on duty.',
    {link: 'Gatsby Rotas site', url: site_url(ctx.settings)}
  ], ctx.constants);
}

// one email to each person on duty of a slot that just went on the calendar
function tell_on_duty(row, ctx){
  var organiser = auto_organiser(rota_of_type(row.type), ctx).split(',')[0].trim();
  var duties = [];
  if (PRESENTER_TYPES.indexOf(row.type) >= 0 && !row.guest) row.presenter_ids.forEach(function(id){ duties.push([id, 'presenter']); });
  row.tea_ids.forEach(function(id){ duties.push([id, 'tea']); });
  duties.forEach(function(d){
    var p = ctx.people[d[0]];
    if (!p || !p.email) return;
    var m = duty_message(row, d[1]);
    var url = tea_page_link_for(d[0], ctx);
    send_mail(p.email, m.subject, [m.text].concat(m.more, [
      'If you can\'t make it, ask someone to swap on your tea page. You will get the usual reminders before.',
      {link: 'Open my tea page', url: url},
      'The rotas are planned automatically and fairly a few weeks ahead, around the away dates on your tea page.'
    ]), ctx.constants, organiser ? {reply_to: organiser} : {});
  });
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

function load_auto_state(rota){
  var raw = PropertiesService.getScriptProperties().getProperty(AUTO_PREFIX + rota);
  var st = raw ? JSON.parse(raw) : {};
  return {since: st.since || '', planned: st.planned || {}, made: st.made || []};
}

// keys of past slots are dropped (the autopilot never plans the past anyway)
function save_auto_state(rota, st, today){
  var keep_from = sched_add_days(today, -7);
  st.made = st.made.filter(function(k){ return k.split('|')[1] >= keep_from; });
  PropertiesService.getScriptProperties().setProperty(AUTO_PREFIX + rota, JSON.stringify(st));
}
