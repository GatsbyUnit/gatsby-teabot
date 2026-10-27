// Scheduling, replacing the four Colab notebooks. Two steps, both from the organiser part of the tea page:
//   create_slots(): empty "[... Tentative]" slots for a date range (same days, times, CSNJC rule and coffee
//                   water-filter weeks as the notebooks); slots that already exist are not duplicated
//   fill_slots():   assigns people to the tentative slots with the fairness algorithm below, using
//                   everyone's away dates; slots that already have someone are left alone
// Then the organiser checks Notion and finalises (Events.js), as before.
//
// The algorithm is a line-by-line port of github.com/KevHH/gatsby_tea_scheduling/script.py; tests/
// crosscheck_scheduler.py runs both on random inputs and checks they agree. Dates are 'yyyy-MM-dd'.

const SLOT_TO_DUTY = {'Research Talk': 'presenter', 'Tea Talk': 'presenter', 'Tea': 'tea', 'MLJC': 'presenter', 'TNJC': 'presenter', 'Coffee Cleaning': 'tea'};
const SLOT_TO_TALK_TYPES = {
  'Research Talk': ['Research Talk'], 'Tea Talk': ['Tea Talk'],
  'Tea': ['Research Talk', 'Tea Talk', 'Just Tea', 'Leaving Tea', 'External Seminar'],
  'MLJC': ['MLJC'], 'TNJC': ['TNJC'], 'Coffee Cleaning': ['Coffee Cleaning']
};
const WATER_FILTER_PERIOD_WEEKS = 4;

// ---- the fairness algorithm (port of script.py) ----

function sched_priority_queue(past_schedule, people, eligible_ids, slot_type){
  var queue = [];
  var types = SLOT_TO_TALK_TYPES[slot_type];
  var duty = SLOT_TO_DUTY[slot_type];
  // most recent first; whoever did this duty longest ago (or never) ends up with the highest priority
  var sorted = past_schedule.slice().sort(function(a, b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  sorted.forEach(function(talk){
    talk[duty].forEach(function(id){
      if (queue.indexOf(id) < 0 && eligible_ids.indexOf(id) >= 0 && types.indexOf(talk.type) >= 0) queue.push(id);
    });
  });
  eligible_ids.forEach(function(id){ if (queue.indexOf(id) < 0) queue.push(id); });
  var by_id = {};
  people.forEach(function(p){ by_id[p.id] = p; });
  return queue.slice().reverse().map(function(id){ return by_id[id]; });
}

function sched_overlap(from, to, away_from, away_until){
  for (var d = from; d <= to; d = sched_next_day(d)){
    for (var i = 0; i < Math.min(away_from.length, away_until.length); i++){
      if (away_from[i] <= d && d <= away_until[i]) return true;
    }
  }
  return false;
}

function sched_next_day(d){
  var p = d.split('-').map(Number);
  var x = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
  return x.toISOString().slice(0, 10);
}

function sched_add_days(d, n){
  var p = d.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

// people presenting within a week either side are protected from another duty
function sched_whitelist(date, schedule){
  var lo = sched_add_days(date, -7), hi = sched_add_days(date, 7);
  var out = [];
  schedule.forEach(function(talk){
    if (lo <= talk.date && talk.date <= hi) out = out.concat(talk.presenter);
  });
  return out;
}

function sched_fill(schedule, queue, slot_type){
  var types = SLOT_TO_TALK_TYPES[slot_type];
  var duty = SLOT_TO_DUTY[slot_type];
  queue = queue.map(function(v){ return Object.assign({}, v, {taken: false}); });
  schedule.forEach(function(talk, i){
    if (!talk.to_fill || types.indexOf(talk.type) < 0) return;
    var whitelist = sched_whitelist(talk.date, schedule);
    var found = false;
    for (var j = 0; j < queue.length; j++){
      var victim = queue[j];
      if (victim.taken || whitelist.indexOf(victim.id) >= 0) continue;
      var end = talk.date_end || talk.date;
      if (!sched_overlap(talk.date, end, victim.away_from, victim.away_until)){
        found = true;
        queue[j].taken = true;
        schedule[i][duty] = [victim.id];
        break;
      }
    }
    if (!found && (slot_type === 'Research Talk' || slot_type === 'Tea Talk')) schedule[i].type = 'Just Tea';
  });
  return schedule;
}

// to_fill / past: [{id, date, type, presenter: [ids], tea: [ids], date_end?}]
// people: [{id, away_from: [dates], away_until: [dates], tea_excluded, tt_excluded, rt_excluded}]
function sched_main(to_fill, past, people, query){
  var schedule = to_fill.map(function(t){ return Object.assign({}, t, {to_fill: true}); })
    .concat(past.map(function(t){ return Object.assign({}, t, {to_fill: false}); }))
    .sort(function(a, b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  var past_only = schedule.filter(function(t){ return !t.to_fill; });
  var ids = function(filter){ return people.filter(filter).map(function(p){ return p.id; }); };
  if (query === 'ResearchTeaTalks'){
    var rt = sched_priority_queue(past_only, people, ids(function(p){ return !p.rt_excluded; }), 'Research Talk');
    var tt = sched_priority_queue(past_only, people, ids(function(p){ return !p.tt_excluded; }), 'Tea Talk');
    var tea = sched_priority_queue(past_only, people, ids(function(p){ return !p.tea_excluded; }), 'Tea');
    schedule = sched_fill(schedule, rt, 'Research Talk');
    schedule = sched_fill(schedule, tt, 'Tea Talk');
    schedule = sched_fill(schedule, tea, 'Tea');
  } else {
    var queue = sched_priority_queue(past_only, people, ids(function(){ return true; }), query);
    schedule = sched_fill(schedule, queue, query);
  }
  return schedule.filter(function(t){ return t.to_fill; });
}

// ---- Notion plumbing (what the notebooks did) ----

// which slots a rota gets: weekday (0 = Sunday), times, Notion type
const SLOT_PLANS = {
  'TNJC': [{type: 'TNJC', weekday: 2, start: [13, 30], end: [14, 30]}],
  'MLJC': [{type: 'MLJC', weekday: 1, start: [13, 30], end: [14, 30]}],
  'Coffee Cleaning': [{type: 'Coffee Cleaning', weekday: 1, all_week: true}],
  'talks': [{type: 'Research Talk', weekday: 1, start: [15, 0], end: [16, 0], range: 'research'},
            {type: 'Tea Talk', weekday: 2, start: [15, 30], end: [16, 0], range: 'tea'},
            {type: 'Tea Talk', weekday: 4, start: [15, 30], end: [16, 0], range: 'tea'}]
};

// ranges: {from, to} (yyyy-MM-dd); for talks {research_from, research_to, tea_from, tea_to}
function create_slots(rota, ranges, ctx){
  var plans = SLOT_PLANS[rota];
  var wanted = [];
  plans.forEach(function(plan){
    var from = plan.range ? ranges[plan.range + '_from'] : ranges.from;
    var to = plan.range ? ranges[plan.range + '_to'] : ranges.to;
    if (!from || !to) return;
    if (to < from) throw new Error('The end date is before the start date.');
    if (sched_add_days(from, 7 * 26) < to) throw new Error('That is more than half a year; please pick a shorter range.');
    for (var d = from; d <= to; d = sched_next_day(d)){
      if (iso_weekday(d) === plan.weekday) wanted.push({plan: plan, date: d});
    }
  });
  if (!wanted.length) return {created: [], skipped: []};
  wanted.sort(function(a, b){ return a.date < b.date ? -1 : 1; });

  var first = parse_iso_date(wanted[0].date), last = parse_iso_date(wanted[wanted.length - 1].date);
  var types = plans.map(function(p){ return p.type; }).filter(function(t, i, a){ return a.indexOf(t) === i; });
  var existing = {};
  types.forEach(function(type){
    load_rows(type, add_days(first, -1), add_days(last, 6), ctx).forEach(function(r){ existing[type + '|' + fmt_iso_date(r.start)] = true; });
  });
  var coffee = rota === 'Coffee Cleaning' ? coffee_templates(first, ctx) : null;
  var holidays = rota === 'Coffee Cleaning' ? {} : bank_holidays();

  var created = [], skipped = [], holiday_skipped = [];
  wanted.forEach(function(w, i){
    var key = w.plan.type + '|' + w.date;
    if (existing[key]){ skipped.push(w.date + ' ' + w.plan.type); return; }
    if (holidays[w.date]){ holiday_skipped.push(w.date + ' (' + holidays[w.date] + ')'); return; }
    var props = {
      'Type': {select: {name: w.plan.type}},
      'Title': {title: [{text: {content: TENTATIVE_TAGS[rota]}}]}
    };
    if (w.plan.all_week){
      props['Date'] = {date: {start: w.date, end: sched_add_days(w.date, 4)}};
      var filter_week = coffee.is_filter_week(w.date);
      props['Water filter (coffee only)'] = {checkbox: filter_week};
      var text = filter_week ? coffee.filter_text : coffee.standard_text;
      if (text) props['Description'] = {rich_text: chunk_text(text)};
    } else {
      props['Date'] = {date: {start: london_iso(w.date, w.plan.start), end: london_iso(w.date, w.plan.end)}};
    }
    if (rota === 'TNJC'){
      // the last Tuesday of the month is a CSNJC slot
      props['CSNJC'] = {checkbox: sched_add_days(w.date, 7).slice(5, 7) !== w.date.slice(5, 7)};
    }
    notion_request('post', 'pages', {parent: {database_id: ctx.constants['notion_talk_db_id']}, properties: props}, ctx.constants);
    created.push(w.date + ' ' + w.plan.type);
  });
  log_row(ctx, 'schedule', rota, null, 'created slots', created.length + ' created' + (skipped.length ? ', ' + skipped.length + ' already existed' : '') + (holiday_skipped.length ? ', bank holidays skipped: ' + holiday_skipped.join(', ') : ''));
  return {created: created, skipped: skipped, holidays: holiday_skipped};
}

// Water-filter weeks continue the 4-week cycle from the last filter week in Notion; descriptions are
// copied from the most recent coffee slot of the same kind, so organisers keep editing them in Notion.
function coffee_templates(first_monday, ctx){
  var rows = load_rows('Coffee Cleaning', add_days(first_monday, -365), add_days(first_monday, -1), ctx);
  var last_filter = null, standard_text = '', filter_text = '';
  rows.forEach(function(r){
    var page_filter = r.water_filter;
    if (page_filter) { last_filter = fmt_iso_date(r.start); if (r.description) filter_text = r.description; }
    else if (r.description) standard_text = r.description;
  });
  var first = fmt_iso_date(first_monday);
  return {
    standard_text: standard_text,
    filter_text: filter_text || standard_text,
    is_filter_week: function(monday){
      if (!last_filter) return Math.round((parse_iso_date(monday) - parse_iso_date(first)) / (7 * 864e5)) % WATER_FILTER_PERIOD_WEEKS === 0;
      return Math.round((parse_iso_date(monday) - parse_iso_date(last_filter)) / (7 * 864e5)) % WATER_FILTER_PERIOD_WEEKS === 0;
    }
  };
}

// assigns people to all future tentative slots of the rota that have nobody yet
function fill_slots(rota, ctx){
  var tentative = tentative_rows(rota, ctx).filter(function(r){ return r.start >= start_of_today(); });
  var to_fill = tentative.filter(function(r){ return r.presenter_ids.length === 0 && r.tea_ids.length === 0; });
  if (!to_fill.length) return {filled: [], unfilled: [], warnings: ['There are no empty tentative slots to fill.']};

  var first = to_fill[0].start, last = to_fill[to_fill.length - 1].start;
  var fill_ids = to_fill.map(function(r){ return r.id; });
  var past_types = rota === 'Coffee Cleaning' ? ['Coffee Cleaning'] : ALL_TYPES;
  var past = [];
  past_types.forEach(function(type){
    load_rows(type, add_days(first, -365), add_days(last, 365), ctx).forEach(function(r){
      if (fill_ids.indexOf(r.id) < 0) past.push(sched_talk(r));
    });
  });

  var warnings = [];
  var people = eligible_people(rota, ctx).map(function(p){
    var away = {from: [], until: []};
    try {
      read_away_all(p).forEach(function(a){ away.from.push(a.from); away.until.push(a.to); });
    } catch (e) {
      warnings.push(p.name + ': away dates could not be read (' + e.message + '), treated as always available');
    }
    return {id: p.id, name: p.name, away_from: away.from, away_until: away.until,
            tea_excluded: p.tea_excluded, tt_excluded: p.tt_excluded, rt_excluded: p.rt_excluded};
  });
  people.filter(function(p){ return !ctx.people[p.id].away_sheet; }).forEach(function(p){ warnings.push(p.name + ' has no away-dates sheet, treated as always available'); });

  var result = sched_main(to_fill.map(sched_talk), past, people, rota === 'talks' ? 'ResearchTeaTalks' : rota);
  var filled = [], unfilled = [];
  result.forEach(function(t){
    var row = to_fill.filter(function(r){ return r.id === t.id; })[0];
    var props = {
      'Presenter': {relation: t.presenter.map(function(id){ return {id: hyphenate_id(id)}; })},
      'Tea': {relation: t.tea.map(function(id){ return {id: hyphenate_id(id)}; })}
    };
    if (t.type !== row.type) props['Type'] = {select: {name: t.type}};
    notion_patch_page(t.id, props, ctx.constants);
    var who = names_of(t.presenter, ctx.people).concat(t.tea.length ? ['tea: ' + names_of(t.tea, ctx.people).join(', ')] : []);
    var line = fmt_day(row.start) + ' · ' + t.type + (t.type !== row.type ? ' (was ' + row.type + ', nobody available)' : '') + ': ' + (who.join(', ') || 'nobody available');
    (t.presenter.length || t.tea.length ? filled : unfilled).push(line);
  });
  log_row(ctx, 'schedule', rota, null, 'filled slots', filled.length + ' filled, ' + unfilled.length + ' without anyone');
  return {filled: filled, unfilled: unfilled, warnings: warnings};
}

function sched_talk(row){
  var t = {id: row.id, date: fmt_iso_date(row.start), type: row.type, presenter: row.presenter_ids.slice(), tea: row.tea_ids.slice()};
  if (row.type === 'Coffee Cleaning' && row.end) t.date_end = fmt_iso_date(row.end);
  return t;
}

// Who normally does this kind of duty (the scheduler's rules, per slot); the swap list shows them first.
function can_do_duty(p, row, duty){
  if (!p.active || !p.name) return false;
  if (row.type === 'TNJC') return row.csnjc ? p.csnjc : p.tnjc;
  if (row.type === 'MLJC') return p.mljc;
  if (row.type === 'Coffee Cleaning') return p.coffee;
  if (p.position === 'Included only for JCs / coffee') return false;
  if (duty === 'tea') return !p.tea_excluded;
  if (row.type === 'Research Talk') return !p.rt_excluded;
  if (row.type === 'Tea Talk') return !p.tt_excluded;
  return true;
}

// England and Wales bank holidays (gov.uk), as {yyyy-MM-dd: name}; talks and journal clubs skip them
function bank_holidays(){
  var cache = CacheService.getScriptCache();
  var cached = cache.get('bank_holidays');
  if (cached) return JSON.parse(cached);
  var out = {};
  try {
    var res = UrlFetchApp.fetch('https://www.gov.uk/bank-holidays.json', {muteHttpExceptions: true});
    if (res.getResponseCode() === 200){
      JSON.parse(res.getContentText())['england-and-wales'].events.forEach(function(e){ out[e.date] = e.title; });
      cache.put('bank_holidays', JSON.stringify(out), 6 * 3600);
    }
  } catch (err) {
    Logger.log('bank holidays: ' + err);
  }
  return out;
}

function eligible_people(rota, ctx){
  return Object.keys(ctx.people).map(function(id){ return ctx.people[id]; }).filter(function(p){
    if (!p.active || !p.name) return false;
    if (rota === 'TNJC') return p.tnjc;
    if (rota === 'MLJC') return p.mljc;
    if (rota === 'Coffee Cleaning') return p.coffee;
    return p.position !== 'Included only for JCs / coffee';
  });
}

// all away ranges from the person's away-dates sheet, past ones included (the algorithm only looks at the slot dates)
function read_away_all(person){
  var out = [];
  if (person.away_sheet){
    var sheet = away_sheet(person);
    var last = sheet.getLastRow();
    if (last >= 2){
      out = sheet.getRange(2, 2, last - 1, 2).getValues().map(function(r){
        var f = to_date(r[0]), t = to_date(r[1]);
        return f && t ? {from: fmt_iso_date(f), to: fmt_iso_date(t)} : null;
      }).filter(function(a){ return a; });
    }
  }
  return out;
}

// suggested next range for the organiser form: from the day after the last slot of the rota
function next_range(rota, ctx){
  var types = SLOT_PLANS[rota].map(function(p){ return p.type; });
  var last = null;
  types.concat(rota === 'talks' ? ['Just Tea'] : []).forEach(function(type){
    var d = last_scheduled_date(type, ctx.constants);
    if (d && (!last || d > last)) last = d;
  });
  var from = last ? add_days(last, 1) : start_of_today();
  if (from < start_of_today()) from = start_of_today();
  var weeks = rota === 'Coffee Cleaning' ? 4 : 8;
  return {from: fmt_iso_date(from), to: fmt_iso_date(add_days(from, weeks * 7 - 1))};
}

function iso_weekday(d){
  var p = d.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

// "2026-11-03" + [13, 30] -> "2026-11-03T13:30:00+00:00" (London time, with the right offset for that day)
function london_iso(d, hm){
  var p = d.split('-').map(Number);
  var local = new Date(p[0], p[1] - 1, p[2], hm[0], hm[1]);
  return Utilities.formatDate(local, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
