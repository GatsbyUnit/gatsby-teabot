// Hourly: keeps the gatsby.tea calendar and Notion in step for the rotas in SYNC_TYPES.
//
// For every slot it remembers what the calendar title and the Notion people looked like last time
// (Script Properties, "state:<event id>"), so it can tell who changed what:
//   - only Notion changed        -> rewrite the calendar title (future slots only)
//   - only the calendar changed  -> someone edited the event by hand: names that match registered people
//                                   are recorded in Notion; an unknown presenter in a journal club is a
//                                   guest speaker; anything unclear goes to the tea tsar
//   - both changed and disagree  -> ask the organiser
// A talk title or description edited in Notion rewrites the event description (future slots, and only
// when the Notion text changed since last time, so text typed into the calendar is otherwise left alone).
// Confirmed future slots without an event get one (same title / description as the finalizing scripts).
// The first run for a rota only takes stock: nothing is changed and nobody is emailed; what it found
// is in the log. Rotas outside LIVE_TYPES (or everything while DRY_RUN is on) are only reported.

const STATE_PREFIX = 'state:';
const REPORTED_PREFIX = 'reported:';
const BASELINE_PREFIX = 'baseline:';
const NO_EVENT_PREFIX = 'noevent:';

function run_sync(){
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;
  var constants = get_global_constants();
  try {
    var ctx = make_context(constants, get_settings());
    maybe_go_live(ctx);
    sync_all(ctx);
    clear_failures('Calendar sync');
  } catch (err) {
    notify_error('Calendar sync', err, constants, 3);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// GO_LIVE_ON: a scheduled end of the dry run, so the organiser can watch the digests for a few days first
function maybe_go_live(ctx){
  var s = ctx.settings;
  if (!s.dry_run || !s.GO_LIVE_ON) return;
  var m = String(s.GO_LIVE_ON).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var date = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s.GO_LIVE_ON);
  if (isNaN(date.getTime()) || start_of_today() < date) return;
  set_setting('DRY_RUN', 'FALSE');
  set_setting('GO_LIVE_ON', '');
  ctx.settings = get_settings();
  log_row(ctx, 'sync', '', null, 'went live', 'scheduled by GO_LIVE_ON');
  send_mail(ctx.constants['tnjc_admin_email'], 'The tea bot is now live for ' + ctx.settings.LIVE_TYPES, [
    'As scheduled, the dry run has ended. From now on the bot keeps the calendar and Notion in sync for ' + ctx.settings.LIVE_TYPES + '.',
    'To pause it, set DRY_RUN to TRUE in the Automation tab of the constants sheet.',
    {link: 'Constants sheet', url: SpreadsheetApp.openById(CONST_SHEET_ID).getUrl()},
    {link: 'Log', url: ctx.log.getUrl()}
  ], ctx.constants);
}

function make_context(constants, settings){
  var people = load_people(constants);
  var schema = notion_get_database(constants['notion_talk_db_id'], constants);
  return {
    constants: constants,
    settings: settings,
    people: people,
    cal: CalendarApp.getCalendarById(constants['google_calendar_id']),
    has_guest_prop: GUEST_PROP in schema.properties,
    log: ensure_log_sheet()
  };
}

function sync_all(ctx){
  var props = PropertiesService.getScriptProperties();
  var today = start_of_today();
  var from = add_days(today, -ctx.settings.lookback_days);
  var findings = [];
  var mismatches = [];
  var links = 0;
  ctx.settings.sync_types.forEach(function(type){
    ctx.baseline = !props.getProperty(BASELINE_PREFIX + type);
    ctx.no_event = JSON.parse(props.getProperty(NO_EVENT_PREFIX + type) || '[]');
    var no_event_now = [];
    load_rows(type, from, null, ctx).forEach(function(row){
      var r = sync_row(row, ctx, today);
      if (r.finding){
        if (ctx.baseline) r.finding.silent = true;
        findings.push(r.finding);
      }
      if (r.mismatch) mismatches.push(r.mismatch);
      if (r.links_updated) links++;
      if (r.no_event) no_event_now.push(row.id);
    });
    // slots that had no event when we first looked are left alone (they may be deliberate)
    props.setProperty(NO_EVENT_PREFIX + type, JSON.stringify(ctx.baseline ? no_event_now : ctx.no_event.filter(function(id){ return no_event_now.indexOf(id) >= 0; })));
    if (ctx.baseline){
      props.setProperty(BASELINE_PREFIX + type, String(Date.now()));
      log_row(ctx, 'sync', type, null, 'first look', 'took stock without changing anything');
    }
  });
  ctx.baseline = false;
  write_mismatches(mismatches, ctx);
  report_findings(findings, ctx);
  if (findings.length > 0 || links > 0) log_row(ctx, 'sync', '', null, 'run', findings.length + ' findings, ' + mismatches.length + ' open mismatches, ' + links + ' event descriptions with new or updated links');
  prune_state(add_days(from, -30));
}

function sync_row(row, ctx, today){
  var out = {};
  if (is_tentative(row)) return out;
  var future = row.start.getTime() >= today.getTime();
  if (!row.gcal_id){
    if (!future) return out;
    if (ctx.baseline || ctx.no_event.indexOf(row.id) >= 0){
      out.no_event = true;
      out.mismatch = {row: row, actual: '(no calendar event)', expected: format_title(row, ctx.people)};
      if (ctx.baseline) out.finding = finding(row, 'missing_event', 'This confirmed slot has no calendar event. It was like this when the bot first looked, so it was left alone.', false);
      return out;
    }
    var created = act(ctx, row, 'create_event', format_title(row, ctx.people), function(){ create_event(row, ctx); });
    if (!created) out.finding = finding(row, 'missing_event', 'This confirmed slot has no calendar event; the bot would create one.', false);
    return out;
  }
  var event = ctx.cal.getEventById(row.gcal_id);
  if (!event){
    if (future) out.finding = finding(row, 'missing_event', 'The calendar event for this slot no longer exists. Was it deleted by hand? (The bot does not recreate deleted events.)', false);
    return out;
  }
  var expected = format_title(row, ctx.people);
  if (expected === null) return out;
  var actual = event.getTitle();
  var fingerprint = notion_fingerprint(row);
  var prev = load_state(row.gcal_id);
  var parsed = parse_title(actual, row.type);

  if (actual !== expected && !is_cancelled_title(actual) && !(parsed && titles_agree(parsed, row, ctx.people))){
    var res = classify_difference(row, event, actual, expected, parsed, prev, fingerprint, ctx, future);
    out.finding = res.finding;
    out.mismatch = res.mismatch;
    actual = res.actual_after;
    fingerprint = res.fingerprint_after;
  }
  var text = notion_text_fingerprint(row);
  if (future && prev && prev.x !== undefined && prev.x !== text){
    var description = event_description(row, ctx);
    if (strip_links(event.getDescription() || '') !== description){
      out.text_updated = act(ctx, row, 'text_from_notion', 'title / description edited in Notion', function(){ event.setDescription(description); });
    }
  }
  if (future && ctx.settings.links_in_events){
    out.links_updated = ensure_links(event, row, ctx);
  }
  if (!prev || prev.t !== actual || prev.n !== fingerprint || prev.x !== text) save_state(row.gcal_id, {t: actual, n: fingerprint, d: row.start.getTime(), x: text});
  return out;
}

function classify_difference(row, event, actual, expected, parsed, prev, fingerprint, ctx, future){
  var res = {actual_after: actual, fingerprint_after: fingerprint, mismatch: {row: row, actual: actual, expected: expected}};
  var notion_says = expected;
  var notion_changed = prev && prev.n !== fingerprint;
  var cal_changed = prev && prev.t !== actual;

  if (prev && !notion_changed && !cal_changed){
    return res;  // known and already reported; stays on the Mismatches tab
  }

  if (prev && notion_changed && !cal_changed){
    if (!future || ctx.baseline) return res;
    var title = keep_label(actual, expected, row.type);
    var done = act(ctx, row, 'update_calendar', actual + ' -> ' + title, function(){ event.setTitle(title); });
    if (done){
      res.actual_after = title;
      res.mismatch = null;
      return res;  // the normal effect of editing Notion: nothing to report
    }
    res.finding = finding(row, 'calendar_updated', 'Notion was edited directly, so the calendar title would be updated to "' + expected + '".', false);
    return res;
  }

  if (prev && notion_changed && cal_changed){
    res.finding = finding(row, 'conflict', 'Both Notion and the calendar were edited since the last check, and they disagree (calendar: "' + actual + '", Notion: "' + expected + '"). Please fix one of them by hand.', false);
    return res;
  }

  // the calendar was edited by hand, or this is the first time we see the slot
  var first_seen = !prev || ctx.baseline;
  var predates = ' This was already the case when the bot first looked, so nothing was changed.';
  if (!parsed){
    res.finding = finding(row, 'unrecognised', 'The calendar title "' + actual + '" does not follow the usual format, so I left it alone. Notion says "' + expected + '".', false);
    return res;
  }

  var changed = Object.keys(parsed.roles).filter(function(role){
    return !same_names(parsed.roles[role], notion_role_names(row, role, ctx.people));
  });
  var plan = {};
  var unsure = [];
  var unknown = [];
  var guest = null;
  var notes = [];
  changed.forEach(function(role){
    var typed = parsed.roles[role];
    var matches = typed.map(function(n){ return {typed: n, m: match_name(n, ctx.people)}; });
    matches.filter(function(x){ return x.m.status === 'uncertain'; }).forEach(function(x){
      unsure.push('"' + x.typed + '" could be ' + x.m.candidates.map(function(c){ return c.person.name + (c.person.active ? '' : ' (inactive)'); }).join(' or '));
    });
    var none = matches.filter(function(x){ return x.m.status === 'none'; });
    var hits = matches.filter(function(x){ return x.m.status === 'match'; });
    hits.forEach(function(x){
      if (normalise_name(x.typed) !== normalise_name(x.m.person.name)) notes.push('"' + x.typed + '" was read as ' + x.m.person.name + '.');
    });
    if (none.length && !hits.length && role === 'Presenter' && GUEST_TYPES.indexOf(row.type) >= 0 && typed.length === none.length){
      guest = typed.join(', ');
    } else if (none.length){
      none.forEach(function(x){ unknown.push('"' + x.typed + '"'); });
    } else {
      plan[role] = hits.map(function(x){ return x.m.person.id; });
    }
  });
  var where = 'The calendar says "' + actual + '", but Notion says "' + notion_says + '".';

  if (unsure.length){
    res.finding = finding(row, 'uncertain_match', where + ' I could not tell for sure who is meant: ' + unsure.join('; ') + '. Nothing was changed. Please record the right person in Notion.', false);
    res.finding.alert_tsar = true;
    return res;
  }
  if (unknown.length){
    res.finding = finding(row, 'unknown_person', where + ' ' + unknown.join(', ') + (unknown.length === 1 ? ' is' : ' are') + ' not in the People database, so I left it alone.', false);
    return res;
  }
  if (first_seen){
    res.finding = finding(row, guest ? 'guest_suggested' : 'swap_suggested', where + predates, false);
    return res;
  }

  var props = {};
  var old_ids = {Presenter: row.presenter_ids.slice(), Tea: row.tea_ids.slice()};
  Object.keys(plan).forEach(function(role){
    props[role] = {relation: plan[role].map(function(id){ return {id: hyphenate_id(id)}; })};
  });
  if (plan.Presenter && ctx.has_guest_prop && row.guest) props[GUEST_PROP] = {rich_text: []};
  if (guest){
    if (!ctx.has_guest_prop){
      res.finding = finding(row, 'guest_suggested', where + ' "' + guest + '" looks like a guest speaker, but Notion has no "' + GUEST_PROP + '" field, so nothing was changed.', false);
      return res;
    }
    props[GUEST_PROP] = {rich_text: [{text: {content: guest}}]};
    props['Presenter'] = {relation: []};
  }
  var done = act(ctx, row, guest ? 'guest_from_calendar' : 'swap_from_calendar', notion_says + ' -> ' + actual, function(){ notion_patch_page(row.id, props, ctx.constants); });
  if (!done){
    res.finding = finding(row, guest ? 'guest_from_calendar' : 'swap_from_calendar', where + ' The event was edited by hand, so the bot would record this in Notion.', false);
    return res;
  }
  if (plan.Presenter){ row.presenter_ids = plan.Presenter; row.guest = ''; }
  if (plan.Tea) row.tea_ids = plan.Tea;
  if (guest){ row.guest = guest; row.presenter_ids = []; }
  res.fingerprint_after = notion_fingerprint(row);
  res.mismatch = null;
  if (guest) notify_guest_from_calendar(row, old_ids.Presenter, ctx);
  else notify_swap_from_calendar(row, old_ids, plan, notes, ctx);
  return res;
}

// runs fn if the bot may write for this rota (and this is not a rota's first look); logs either way
function act(ctx, row, action, detail, fn){
  if (!is_live(ctx, row.type) || ctx.baseline){
    log_row(ctx, 'sync', row.type, row.start, 'would ' + action, detail);
    return false;
  }
  fn();
  log_row(ctx, 'sync', row.type, row.start, action, detail);
  return true;
}

function finding(row, kind, text, done){
  return {row: row, kind: kind, text: text, done: done};
}

function report_findings(findings, ctx){
  var props = PropertiesService.getScriptProperties();
  var fresh = findings.filter(function(f){
    var key = REPORTED_PREFIX + digest(f.kind + '|' + f.row.id + '|' + f.text);
    if (props.getProperty(key)) return false;
    props.setProperty(key, String(Date.now()));
    return true;
  });
  fresh.forEach(function(f){ log_row(ctx, 'sync', f.row.type, f.row.start, 'finding: ' + f.kind + (f.silent ? ' (not emailed)' : ''), f.text); });

  // grouped per recipient; matching failures go to the tea tsar with the organiser in cc
  var groups = {};
  fresh.filter(function(f){ return !f.silent; }).forEach(function(f){
    var organiser = admin_email_for_type(f.row.type, ctx.constants);
    var tsar = ctx.constants['admin_email'];
    var key = f.alert_tsar && tsar && tsar !== organiser ? tsar + '|' + organiser : organiser + '|';
    (groups[key] = groups[key] || []).push(f);
  });
  Object.keys(groups).forEach(function(key){
    var list = groups[key];
    var admin = key.split('|')[0];
    var cc = key.split('|')[1];
    var watching = list.every(function(f){ return !is_live(ctx, f.row.type); });
    var blocks = digest_blocks(list, watching, ctx.log.getUrl());
    var subject = cc ? 'Could not match a name in the ' + list[0].row.type + ' calendar' : list.length + ' calendar / Notion ' + (list.length === 1 ? 'item' : 'items') + ' to look at';
    send_mail(admin, (watching ? 'Dry run: ' : '') + subject, blocks, ctx.constants, cc ? {cc: cc, reply_to: cc} : {});
  });
}

function digest_blocks(list, watching, log_url){
  var blocks = [watching
    ? 'Dry run: for this rota the bot is only watching, nothing has been changed. This is what it found, and what it would do once switched on.'
    : 'The bot checked the calendar against Notion and found something that needs a person.'];
  list.forEach(function(f){
    blocks.push({heading: fmt_day(f.row.start) + ' · ' + f.row.type});
    blocks.push(f.text);
    blocks.push('[Open in Notion](' + f.row.url + ')');
  });
  blocks.push('[Full log](' + log_url + ')');
  return blocks;
}

function notify_swap_from_calendar(row, old_ids, plan, notes, ctx){
  var admin = admin_email_for_type(row.type, ctx.constants);
  var involved = [];
  var table = [['Slot', fmt_day(row.start) + ', ' + row.type]];
  Object.keys(plan).forEach(function(role){
    involved = involved.concat(old_ids[role], plan[role]);
    var label = role === 'Tea' ? (row.type === 'Coffee Cleaning' ? 'On duty' : 'Tea') : 'Presenter';
    table.push([label + ', before', names_of(old_ids[role], ctx.people).join(', ') || 'nobody']);
    table.push([label + ', now', names_of(plan[role], ctx.people).join(', ')]);
  });
  var to = emails_of(involved.filter(function(id, i, a){ return a.indexOf(id) === i; }), ctx.people);
  var blocks = [
    'The calendar event for this slot was changed by hand, so the tea system now records the change too. This keeps the rota fair: whoever actually does the slot gets the credit.',
    {table: table}
  ];
  if (notes.length) blocks.push(notes.join(' '));
  blocks.push('If this is wrong, just reply to this email.');
  send_mail(to.length ? to.join(',') : admin, row.type + ' updated for ' + fmt_day(row.start), blocks, ctx.constants, {reply_to: admin, cc: admin});
}

function notify_guest_from_calendar(row, bumped_ids, ctx){
  var admin = admin_email_for_type(row.type, ctx.constants);
  var to = emails_of(bumped_ids, ctx.people);
  var blocks = [
    row.guest + ' is presenting in this slot as a guest speaker. You are no longer recorded as presenting here, so you keep your turn and will be scheduled again fairly.',
    {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['Guest', row.guest]]},
    'If this is wrong, just reply to this email.'
  ];
  send_mail(to.length ? to.join(',') : admin, 'Guest speaker in your ' + row.type + ' slot on ' + fmt_day(row.start), blocks, ctx.constants, {reply_to: admin, cc: admin});
}

// Emails the TNJC organiser about a failed run. Hourly jobs pass a threshold so that a one-off network
// blip (which fixes itself on the next run) does not email anyone; only repeated failures do.
function notify_error(job, err, constants, threshold){
  var props = PropertiesService.getScriptProperties();
  var key = 'fail:' + job;
  var count = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(count));
  if (count < (threshold || 1)) return;
  try {
    var tsar = constants['admin_email'];
    send_mail(constants['tnjc_admin_email'], 'Error in ' + job, [
      (count > 1 ? 'The last ' + count + ' runs failed. ' : '') + 'The automation hit an error and stopped this run. It will try again on its next scheduled run.',
      {heading: 'Error'},
      String(err && err.stack ? err.stack : err)
    ], constants, tsar && tsar !== constants['tnjc_admin_email'] ? {cc: tsar} : {});
  } catch (e) {
    Logger.log('Could not send error email: ' + e);
  }
}

function clear_failures(job){
  PropertiesService.getScriptProperties().deleteProperty('fail:' + job);
}

function load_state(event_id){
  var raw = PropertiesService.getScriptProperties().getProperty(STATE_PREFIX + event_id);
  return raw ? JSON.parse(raw) : null;
}

function save_state(event_id, state){
  PropertiesService.getScriptProperties().setProperty(STATE_PREFIX + event_id, JSON.stringify(state));
}

function prune_state(before){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function(k){
    if (k.indexOf(STATE_PREFIX) === 0 && JSON.parse(all[k]).d < before.getTime()) props.deleteProperty(k);
    if (k.indexOf(REPORTED_PREFIX) === 0 && Number(all[k]) < Date.now() - 90 * 24 * 3600 * 1000) props.deleteProperty(k);
  });
}

function digest(s){
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)).replace(/=+$/, '');
}
