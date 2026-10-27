// Calendar invitations: for the rotas in INVITE_TYPES, the people on duty (presenter and tea) are guests of
// their slot's event on the shared calendar, so it lands in their own calendar. The bot owns the guests it
// invited: after a swap or a cancellation, Google sends the old person a cancellation and the new one an
// invitation; guests added by hand are left alone. Title and description edits reach guests silently
// (CalendarApp never notifies them).
//
// Declining changes nothing in the rota: Outlook's out-of-office and deleting the invitation both decline
// on their own. Whoever declines gets one email saying the slot is still theirs and how to swap (organiser
// in cc when the slot is less than a week away). Cancelling stays on the tea page.

const INVITE_PREFIX = 'invite:';
const INVITE_NUDGE_CC_DAYS = 7;

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
  if (add.length || remove.length){
    set_guests(row.gcal_id, add, remove, ctx);
    log_row(ctx, 'sync', row.type, row.start, 'invitations', (add.length ? 'invited ' + add.length : '') + (add.length && remove.length ? ', ' : '') + (remove.length ? 'uninvited ' + remove.length : ''));
    out.invited = add.length;
  }
  var declined = want.filter(function(e){ return status[e] === 'declined' && st.no.indexOf(e) < 0; });
  declined.forEach(function(e){ nudge_decline(row, e, ctx); });
  var next = {d: row.start.getTime(), g: want, no: st.no.filter(function(e){ return want.indexOf(e) >= 0; }).concat(declined)};
  if (JSON.stringify(next) !== JSON.stringify(st)) save_invite_state(row.gcal_id, next);
  out.declined = declined.length;
  return out;
}

// Google emails the people added (invitation) and removed (cancellation)
function set_guests(event_id, add, remove, ctx){
  var cal_id = ctx.constants['google_calendar_id'];
  var id = event_key(event_id);
  var ev = Calendar.Events.get(cal_id, id);
  var attendees = (ev.attendees || []).filter(function(a){ return remove.indexOf(String(a.email).toLowerCase()) < 0; });
  var have = attendees.map(function(a){ return String(a.email).toLowerCase(); });
  add.filter(function(e){ return have.indexOf(e) < 0; }).forEach(function(e){ attendees.push({email: e}); });
  Calendar.Events.patch({attendees: attendees, guestsCanInviteOthers: false}, cal_id, id, {sendUpdates: 'all'});
}

// after a cancellation: the people no longer on duty get Google's cancellation
function uninvite(row, ids, ctx){
  if (!row.gcal_id || !invites_on(ctx, row.type)) return;
  var st = load_invite_state(row.gcal_id);
  var gone = emails_of(ids, ctx.people).map(function(e){ return e.toLowerCase(); }).filter(function(e){ return st.g.indexOf(e) >= 0; });
  if (!gone.length) return;
  set_guests(row.gcal_id, [], gone, ctx);
  st.g = st.g.filter(function(e){ return gone.indexOf(e) < 0; });
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
    'You declined the calendar invitation for your ' + what + '. That does not take you off the rota: the slot is still yours.',
    slot_table(row),
    'If you can\'t make it, please swap: pick someone on your tea page, and the slot moves to them once they accept.',
    {link: 'Open my tea page', url: tea_page_link_for(id, ctx)},
    duty === 'presenter'
      ? 'Only if really nobody can take over, use "Nobody can take over?" on your tea page. That cancels the talk, so it is the last resort.'
      : 'If really nobody can take over, reply to this email and the organiser will sort it out.',
    'Did your calendar decline it for you (out of office)? Then you are probably away that day: please swap, and add the dates to your away dates so you are not scheduled then again. Declined by mistake? Just accept the invitation again.'
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
  });
}
