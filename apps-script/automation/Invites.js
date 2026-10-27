// Calendar invitations: for the rotas in INVITE_TYPES, the people on duty (presenter and tea) are guests of
// their slot's event on the shared calendar, so it lands in their own calendar. The bot owns the guests it
// invited: after a swap or a cancellation, Google sends the old person a cancellation and the new one an
// invitation; guests added by hand are left alone. Title and description edits reach guests silently
// (CalendarApp never notifies them).
//
// Declining changes nothing in the rota: Outlook's out-of-office and deleting the invitation both decline
// on their own, so it is often an accident. Whoever declines gets one friendly email saying the slot is still
// theirs and how to swap if they really can't make it (organiser in cc when the slot is less than a week
// away). Cancelling stays on the tea page.
//
// Safety cap: Google emails a person for every invitation and cancellation, so the bot sends one person at
// most INVITE_CAP of them in any 24 hours. More is almost certainly a bug: the rest is held back (and tried
// again later), and the tea tsar (only) gets one alert per person and day.

const INVITE_PREFIX = 'invite:';
const INVITE_NUDGE_CC_DAYS = 7;
const INVITE_CAP = 10;
const INVITE_COUNT_PREFIX = 'invcount:';

function invites_on(ctx, type){
  return is_live(ctx, type) && !ctx.baseline && (ctx.settings.invite_types || []).indexOf(type) >= 0;
}

// lower-case emails of the people on duty; presenters only where they present (not the leaving person)
function invitees(row, ctx){
  var ids = (PRESENTER_TYPES.indexOf(row.type) >= 0 ? row.presenter_ids : []).concat(row.tea_ids);
  return emails_of(ids, ctx.people).map(function(e){ return e.toLowerCase(); })
    .filter(function(e, i, a){ return a.indexOf(e) === i; });
}

// {event key: [{email, status}]} for upcoming events, one Calendar API listing per run; null if it failed
function load_attendees(ctx){
  var out = {};
  try {
    var page;
    do {
      var res = Calendar.Events.list(ctx.constants['google_calendar_id'], {timeMin: start_of_today().toISOString(),
        singleEvents: true, maxResults: 2500, pageToken: page, fields: 'items(id,attendees(email,responseStatus)),nextPageToken'});
      (res.items || []).forEach(function(e){
        out[event_key(e.id)] = (e.attendees || []).map(function(a){ return {email: String(a.email).toLowerCase(), status: a.responseStatus}; });
      });
      page = res.nextPageToken;
    } while (page);
  } catch (err) {
    Logger.log('Could not list attendees: ' + err);
    return null;
  }
  return out;
}

function load_invite_state(event_id){
  var raw = PropertiesService.getScriptProperties().getProperty(INVITE_PREFIX + event_key(event_id));
  return raw ? JSON.parse(raw) : {g: [], no: []};
}

function save_invite_state(event_id, st){
  PropertiesService.getScriptProperties().setProperty(INVITE_PREFIX + event_key(event_id), JSON.stringify(st));
}

// Brings the guest list in line with who is on duty, and answers new declines. attendees: this event's
// guests from load_attendees, or undefined to fetch them (after a swap on the tea page).
function sync_invites(row, ctx, attendees){
  if (!row.gcal_id || !invites_on(ctx, row.type)) return {};
  if (attendees === undefined){
    var ev = Calendar.Events.get(ctx.constants['google_calendar_id'], event_key(row.gcal_id));
    attendees = (ev.attendees || []).map(function(a){ return {email: String(a.email).toLowerCase(), status: a.responseStatus}; });
  }
  if (!attendees) return {};
  var st = load_invite_state(row.gcal_id);
  var want = invitees(row, ctx);
  var status = {};
  attendees.forEach(function(a){ status[a.email] = a.status; });
  var add = want.filter(function(e){ return !(e in status); });
  var remove = st.g.filter(function(e){ return want.indexOf(e) < 0 && (e in status); });
  var out = {};
  var held = [];
  if (add.length || remove.length){
    var done = set_guests(row.gcal_id, add, remove, ctx);
    held = add.filter(function(e){ return done.add.indexOf(e) < 0; }).concat(remove.filter(function(e){ return done.remove.indexOf(e) < 0; }));
    if (done.add.length || done.remove.length) log_row(ctx, 'sync', row.type, row.start, 'invitations', (done.add.length ? 'invited ' + done.add.length : '') + (done.add.length && done.remove.length ? ', ' : '') + (done.remove.length ? 'uninvited ' + done.remove.length : ''));
    out.invited = done.add.length;
  }
  var declined = want.filter(function(e){ return status[e] === 'declined' && st.no.indexOf(e) < 0; });
  declined.forEach(function(e){ nudge_decline(row, e, ctx); });
  // held-back changes stay pending: an invitation not sent is not ours yet, a removal not sent still is
  var mine = want.filter(function(e){ return held.indexOf(e) < 0; }).concat(remove.filter(function(e){ return held.indexOf(e) >= 0; }));
  var next = {d: row.start.getTime(), g: mine, no: st.no.filter(function(e){ return want.indexOf(e) >= 0; }).concat(declined)};
  if (JSON.stringify(next) !== JSON.stringify(st)) save_invite_state(row.gcal_id, next);
  out.declined = declined.length;
  return out;
}

// Google emails the people added (invitation) and removed (cancellation). Returns what was actually done:
// changes for people who reached the cap are held back.
function set_guests(event_id, add, remove, ctx){
  add = add.filter(function(e){ return within_invite_cap(e, ctx); });
  remove = remove.filter(function(e){ return within_invite_cap(e, ctx); });
  if (!add.length && !remove.length) return {add: [], remove: []};
  var cal_id = ctx.constants['google_calendar_id'];
  var id = event_key(event_id);
  var ev = Calendar.Events.get(cal_id, id);
  var attendees = (ev.attendees || []).filter(function(a){ return remove.indexOf(String(a.email).toLowerCase()) < 0; });
  var have = attendees.map(function(a){ return String(a.email).toLowerCase(); });
  add.filter(function(e){ return have.indexOf(e) < 0; }).forEach(function(e){ attendees.push({email: e}); });
  Calendar.Events.patch({attendees: attendees, guestsCanInviteOthers: false}, cal_id, id, {sendUpdates: 'all'});
  return {add: add, remove: remove};
}

// counts one Google email to this person; false (and the tea tsar alerted) once they had INVITE_CAP in 24 hours
function within_invite_cap(email, ctx){
  var props = PropertiesService.getScriptProperties();
  var key = INVITE_COUNT_PREFIX + email;
  var day_ago = Date.now() - 864e5;
  var times = JSON.parse(props.getProperty(key) || '[]').filter(function(t){ return t > day_ago; });
  if (times.length >= INVITE_CAP){
    alert_invite_cap(email, ctx);
    return false;
  }
  times.push(Date.now());
  props.setProperty(key, JSON.stringify(times));
  return true;
}

function alert_invite_cap(email, ctx){
  var props = PropertiesService.getScriptProperties();
  var key = 'invcap_alert:' + email;
  if (Number(props.getProperty(key) || 0) > Date.now() - 864e5) return;
  props.setProperty(key, String(Date.now()));
  var id = Object.keys(ctx.people).filter(function(k){ return String(ctx.people[k].email).toLowerCase() === email; })[0];
  var name = id ? ctx.people[id].name : email;
  var tsar = ctx.constants['admin_email'] || ctx.constants['tnjc_admin_email'];
  send_mail(tsar, 'Calendar invitations to ' + name + ' stopped', [
    'The bot was about to send ' + name + ' more than ' + INVITE_CAP + ' calendar invitations or cancellations within a day. That is almost certainly a bug, so it stopped: nothing more goes to them until a day has passed, and their other slots are unaffected.',
    'Please have a look at the "Gatsby Tea Automation log" sheet (rows "invitations"). To switch invitations off for everyone, empty INVITE_TYPES in the Automation tab of the constants sheet.',
    {link: 'Log', url: ctx.log.getUrl ? ctx.log.getUrl() : ''}
  ], ctx.constants);
  log_row(ctx, 'sync', '', null, 'invitation cap reached', name);
}

// after a cancellation: the people no longer on duty get Google's cancellation
function uninvite(row, ids, ctx){
  if (!row.gcal_id || !invites_on(ctx, row.type)) return;
  var st = load_invite_state(row.gcal_id);
  var gone = emails_of(ids, ctx.people).map(function(e){ return e.toLowerCase(); }).filter(function(e){ return st.g.indexOf(e) >= 0; });
  if (!gone.length) return;
  var done = set_guests(row.gcal_id, [], gone, ctx);
  st.g = st.g.filter(function(e){ return done.remove.indexOf(e) < 0; });
  save_invite_state(row.gcal_id, st);
}

function nudge_decline(row, email, ctx){
  var id = Object.keys(ctx.people).filter(function(k){ return String(ctx.people[k].email).toLowerCase() === email; })[0];
  var person = ctx.people[id];
  var duty = row.presenter_ids.indexOf(id) >= 0 && PRESENTER_TYPES.indexOf(row.type) >= 0 ? 'presenter' : 'tea';
  var what = duty_word(row, duty);
  var organiser = admin_email_for_type(row.type, ctx.constants);
  var soon = row.start.getTime() - Date.now() < INVITE_NUDGE_CC_DAYS * 864e5;
  var blocks = [
    'Your calendar shows the invitation for your ' + what + ' as declined. That often happens by itself: an out-of-office reply, or deleting the invitation to tidy up. Either way, nothing has changed: the slot is still yours. If it was an accident, just accept the invitation again.',
    slot_table(row),
    'If you really can\'t make it, please swap: pick someone on your tea page, and the slot moves to them once they accept. If you are away that day, adding it to your away dates there keeps you from being scheduled then in future.',
    // the personal link only when nobody else gets this email
    {link: soon ? 'Open the tea page' : 'Open my tea page', url: soon ? page_url(ctx.settings) : tea_page_link_for(id, ctx)},
    duty === 'presenter'
      ? 'Only if nobody at all can take over, there is "Nobody can take over?" on your tea page. That cancels the talk, so it is the last resort.'
      : 'If nobody at all can take over, reply to this email and the organiser will sort it out.'
  ];
  send_mail(email, 'Your ' + what + ' on ' + fmt_day(row.start) + ' is still yours', blocks, ctx.constants,
            soon ? {reply_to: organiser, cc: organiser} : {reply_to: organiser});
  log_row(ctx, 'sync', row.type, row.start, 'declined invitation', person ? person.name : email);
}

function tea_page_link_for(id, ctx){
  if (!ctx.tokens){
    ctx.tokens = {};
    identity_rows(ctx.constants).rows.forEach(function(r){ if (r.id && r.token) ctx.tokens[r.id] = r.token; });
  }
  return ctx.tokens[id] ? personal_link(ctx.tokens[id], ctx.settings) : page_url(ctx.settings);
}

function prune_invite_state(before){
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function(k){
    if (k.indexOf(INVITE_PREFIX) === 0 && JSON.parse(all[k]).d < before.getTime()) props.deleteProperty(k);
    if (k.indexOf(INVITE_COUNT_PREFIX) === 0 && JSON.parse(all[k]).every(function(t){ return t < Date.now() - 864e5; })) props.deleteProperty(k);
  });
}
