// Creating calendar events, finalising tentative slots, and swapping a duty. Titles, descriptions and the
// "schedule updated" emails match the old finalizing scripts, so nothing changes for people reading them.

const TENTATIVE_TAGS = {
  'TNJC': '[TNJC Tentative]',
  'MLJC': '[MLJC Tentative]',
  'Coffee Cleaning': '[Coffee Cleaning Tentative]',
  'talks': '[Tentative]'   // research talks, tea talks, just tea, leaving tea, external seminars
};

// rota -> organiser constant, group list constant, email subject and text (as in the old finalizing scripts)
const ROTAS = {
  'TNJC': {admin: 'tnjc_admin_email', list: 'tnjc_email', label: 'TNJC', subject: 'TNJC schedule updated',
           text: 'The TNJC schedule has been updated. You may view it on the Gatsby Rotas site or through the gatsby.tea Google Calendar.'},
  'MLJC': {admin: 'mljc_admin_email', list: 'mljc_email', label: 'MLJC', subject: 'MLJC schedule updated',
           text: 'The MLJC schedule has been updated. You may view it on the Gatsby Rotas site or through the gatsby.tea Google Calendar.'},
  'Coffee Cleaning': {admin: 'coffee_admin_email', list: 'coffee_email', label: 'Coffee cleaning', subject: 'Coffee cleaning rota updated',
           text: 'The coffee cleaning rota has been updated. You may view it on the Gatsby Rotas site or through the gatsby.tea Google Calendar.'},
  'talks': {admin: 'admin_email', list: 'unit_wide_email', label: 'Research / tea talks', subject: 'Tea schedule updated',
           text: 'The tea talk schedule has been updated for the next month and the research talk schedule for the month after. You may view it on the Gatsby Rotas site or through the gatsby.tea Google Calendar.'}
};

// talks carry the unit's Zoom link as their location too, where calendar apps show it (and a join button)
function zoom_location(row, ctx){
  return row.type === 'Coffee Cleaning' ? '' : String(ctx.constants['gatsby_zoom_link'] || '');
}

// sets the Zoom link as location of an event that has none (a room typed in by hand is kept)
function ensure_zoom_location(event, row, ctx){
  var zoom = zoom_location(row, ctx);
  if (!zoom || event.getLocation()) return false;
  event.setLocation(zoom);
  return true;
}

function event_description(row, ctx){
  if (row.type === 'Coffee Cleaning') return 'Duty Description:\n\n' + (row.description ? row.description + '\n' : '');
  var d = 'Title: ' + (is_tentative(row) ? '' : row.title) + '\nZoom Link: ' + ctx.constants['gatsby_zoom_link'];
  if (row.description) d += '\nDescription: ' + row.description;
  return d;
}

// creates the event and stores its ID in the slot's row (plus any other fields, in the same call)
function create_event(row, ctx, extra_props){
  var title = format_title(row, ctx.people);
  var end = row.end || new Date(row.start.getTime() + 3600 * 1000);
  var opts = {description: event_description(row, ctx)};
  if (zoom_location(row, ctx)) opts.location = zoom_location(row, ctx);
  var event = row.type === 'Coffee Cleaning'
    ? ctx.cal.createAllDayEvent(title, row.start, end, opts)
    : ctx.cal.createEvent(title, row.start, end, opts);
  var props = extra_props || {};
  props['GCal ID'] = {rich_text: [{text: {content: event.getId()}}]};
  notion_patch_page(row.id, props, ctx.constants);
  row.gcal_id = event.getId();
  if (ctx.settings.links_in_events) ensure_links(event, row, ctx);
  save_state(row.gcal_id, {t: title, n: notion_fingerprint(row), d: row.start.getTime()});
  return event;
}

function rota_of_type(type){
  return ROTAS[type] ? type : 'talks';
}

function tentative_rows(rota, ctx){
  var pages = notion_query(ctx.constants['notion_talk_db_id'], {property: 'Title', title: {equals: TENTATIVE_TAGS[rota]}}, [{property: 'Date', direction: 'ascending'}], ctx.constants);
  return pages.map(to_row).filter(function(r){ return r.start !== null; });
}

// What the old "<rota> Finalizing Script" did: create the events, clear "[... Tentative]", store the
// event IDs, and optionally email the group once.
function finalise_rota(rota, email_group, ctx){
  var rows = tentative_rows(rota, ctx);
  finalise_rows(rows, ctx);
  log_row(ctx, 'finalise', rota, null, 'finalised', rows.length + ' slots' + (email_group ? ', group emailed' : ''));
  if (email_group && rows.length > 0){
    var r = ROTAS[rota];
    send_mail(ctx.constants[r.list], r.subject, ['Hi friends,', r.text], ctx.constants, {reply_to: ctx.constants[r.admin]});
  }
  return rows.length;
}

function finalise_rows(rows, ctx){
  rows.forEach(function(row){
    row.title = '';
    create_event(row, ctx, {'Title': {title: [{text: {content: ''}}]}});
  });
}

// Swap one person's duty in a slot for another person: rota data, calendar, and one email to both.
// Returns a short message for the person who asked; throws with a readable message if not possible.
function validate_swap(row, duty, from_id, to_id, ctx){
  var ids = duty === 'tea' ? row.tea_ids : row.presenter_ids;
  if (is_tentative(row)) throw new Error('This slot is still tentative, so it cannot be swapped yet.');
  if (is_cancelled_title(row.title)) throw new Error('This talk has been cancelled.');
  if (ids.indexOf(from_id) < 0) throw new Error('This slot has changed in the meantime. Please reload the page.');
  if (from_id === to_id) throw new Error('The slot already belongs to this person.');
  if (!ctx.people[to_id] || !ctx.people[to_id].active) throw new Error('That person is not on the active list.');
  if (!is_live(ctx, row.type)) throw new Error('Swaps for ' + row.type + ' are not switched on yet. Please ask the organiser.');
  return ids;
}

function apply_swap(row, duty, from_id, to_id, ctx){
  validate_swap(row, duty, from_id, to_id, ctx);
  replace_on_duty(row, duty, from_id, to_id, ctx);
  var from_name = names_of([from_id], ctx.people)[0];
  var to_name = names_of([to_id], ctx.people)[0];
  log_row(ctx, 'swap', row.type, row.start, 'swapped', (duty === 'tea' ? 'tea: ' : '') + from_name + ' -> ' + to_name);

  var organiser = admin_email_for_type(row.type, ctx.constants);
  var both = emails_of([from_id, to_id], ctx.people);
  var what = duty === 'tea' ? (row.type === 'Coffee Cleaning' ? 'coffee duty' : 'tea duty') : 'presenter';
  send_mail(both.length ? both.join(',') : organiser, 'Swap done: ' + fmt_day(row.start) + ' ' + row.type, swap_done_blocks(row, what, from_name, to_name), ctx.constants, {reply_to: organiser, as: both.length ? undefined : row.type});
  if (both.length < 2) send_mail(organiser, 'Swap: please check', ['A swap went through, but one of the two people has no registered email, so they were not told.', {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['Before', from_name], ['Now', to_name]]}], ctx.constants, {as: row.type});
  return 'Done: ' + to_name + ' now has this ' + what + '. You both got an email.';
}

// one person's duty in a slot goes to another: rota data, and the calendar event if there is one (no emails)
function replace_on_duty(row, duty, from_id, to_id, ctx){
  var ids = duty === 'tea' ? row.tea_ids : row.presenter_ids;
  var new_ids = ids.map(function(id){ return id === from_id ? to_id : id; });
  var props = {};
  props[duty === 'tea' ? 'Tea' : 'Presenter'] = {relation: new_ids.map(function(id){ return {id: hyphenate_id(id)}; })};
  notion_patch_page(row.id, props, ctx.constants);
  if (duty === 'tea') row.tea_ids = new_ids; else row.presenter_ids = new_ids;

  var event = row.gcal_id ? ctx.cal.getEventById(row.gcal_id) : null;
  if (event){
    var title = keep_label(event.getTitle(), format_title(row, ctx.people), row.type);
    event.setTitle(title);
    save_state(row.gcal_id, {t: title, n: notion_fingerprint(row), d: row.start.getTime(), x: notion_text_fingerprint(row)});
    try { sync_invites(row, ctx); } catch (err) { Logger.log('Could not update the guests: ' + err); }   // else the hourly sync does it
  }
}

function swap_done_blocks(row, what, from_name, to_name){
  return [
    'The ' + what + ' for this slot has been swapped. The site and the shared calendar are updated.',
    {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['Before', from_name], ['Now', to_name]]},
    '[Open on the site](' + row.url + ')'
  ];
}

// Cancelling a talk, a last resort: swapping is always better. The slot stays on the site, titled "Cancelled",
// without its presenter, so they keep their turn and are scheduled again soon; tea duty stays, so it is just tea
// (how.keep_tea false, from a tsar: the tea people come off too and keep their turn). A just tea loses its tea
// people, who keep their turn. how.source is 'page' (the presenter on their tea page), 'site' (a tsar on the
// Rotas site; both with how.by and how.reason), 'deleted' or 'renamed' (by hand in the calendar). One email to
// the people on the slot (how.email: only these ids), with the organiser in cc; nobody chosen: the organiser
// alone, unless they cancelled it themselves (how.by_organiser). Returns {emailed: [names], no_address: [names]}.
function cancel_slot(row, ctx, how){
  var just_tea = row.type === 'Just Tea';
  var drop_tea = !just_tea && how.keep_tea === false && row.tea_ids.length > 0;
  var thing = just_tea ? 'just tea' : drop_tea ? 'talk and tea' : 'talk';
  var bumped = (just_tea ? row.tea_ids : row.presenter_ids.concat(drop_tea ? row.tea_ids : [])).slice();
  var was = (just_tea ? '' : row.guest) || names_of(just_tea ? row.tea_ids : row.presenter_ids, ctx.people).join(', ');
  var tea_was = just_tea ? '' : names_of(row.tea_ids, ctx.people).join(', ');
  var on_duty = (just_tea ? row.tea_ids : row.presenter_ids.concat(row.tea_ids)).slice();
  var props = {'Title': {title: [{text: {content: CANCELLED_TITLE}}]}};
  if (just_tea || drop_tea) props['Tea'] = {relation: []};
  if (!just_tea) props['Presenter'] = {relation: []};
  if (!just_tea && ctx.has_guest_prop && row.guest) props[GUEST_PROP] = {rich_text: []};
  notion_patch_page(row.id, props, ctx.constants);
  row.title = CANCELLED_TITLE;
  if (just_tea || drop_tea) row.tea_ids = [];
  if (!just_tea){
    row.presenter_ids = [];
    row.guest = '';
  }

  var event = how.source === 'deleted' || !row.gcal_id ? null : ctx.cal.getEventById(row.gcal_id);
  if (event){
    var title = how.source === 'renamed' ? event.getTitle() : cancelled_title(row, ctx.people);
    if (title !== event.getTitle()) event.setTitle(title);
    event.setDescription(event_description(row, ctx));
    if (ctx.settings.links_in_events) ensure_links(event, row, ctx);
    save_state(row.gcal_id, {t: title, n: notion_fingerprint(row), d: row.start.getTime(), x: notion_text_fingerprint(row)});
    try { uninvite(row, bumped, ctx); } catch (err) { Logger.log('Could not update the guests: ' + err); }
  }

  var has_address = function(id){ return !!(ctx.people[id] && ctx.people[id].email); };
  var chosen = how.email ? on_duty.filter(function(id){ return how.email.indexOf(id) >= 0; }) : on_duty;
  var to = emails_of(chosen, ctx.people);
  var by_person = how.source === 'page' || how.source === 'site';
  var why = by_person ? how.by + ': ' + how.reason : (how.source === 'deleted' ? 'event deleted in the calendar' : 'event renamed in the calendar');
  var told = to.length ? 'emailed ' + names_of(chosen.filter(has_address), ctx.people).join(', ') : 'nobody on the slot emailed';
  log_row(ctx, by_person ? how.source : 'sync', row.type, row.start, drop_tea ? 'cancelled talk and tea' : 'cancelled',
          why + (was ? ' (was: ' + was + ')' : '') + '; ' + told);

  var organiser = admin_email_for_type(row.type, ctx.constants);
  var role = just_tea ? 'tea person' : 'presenter';
  var table = [['Slot', fmt_day(row.start) + ', ' + fmt_time(row.start) + ', ' + row.type], [just_tea ? 'Tea' : 'Presenter', was || '–']];
  if (tea_was) table.push(['Tea', tea_was + (drop_tea ? ' (cancelled too)' : ' (still on)')]);
  if (by_person) table.push(['Reason', how.reason]);
  var opening = !by_person
    ? 'This ' + thing + ' was ' + (how.source === 'deleted' ? 'deleted from' : 'marked as cancelled in') + ' the calendar, so the bot has recorded it as cancelled.'
    : just_tea ? how.by + ' has cancelled this just tea.'
    : drop_tea ? how.by + ' has cancelled the talk and the tea.'
    : how.by + ' has cancelled the talk.' + (row.tea_ids.length ? ' Tea still goes ahead: it is just tea this time.' : '');
  var blocks = [opening, {table: table}];
  if (bumped.length) blocks.push((drop_tea ? 'The presenter and the tea person are' : 'The ' + role + ' is') + ' no longer recorded for this slot, so they keep their turn and will be scheduled again soon.');
  if (row.tea_ids.length) blocks.push('Tea duty stays as it is unless the organiser changes it.');
  blocks.push('Organiser: the calendar shows the ' + thing + ' as cancelled; please let the group know if needed. To undo, put the ' + (drop_tea ? 'presenter and tea person' : role) + ' back on the site, remove "' + CANCELLED_TITLE + '" from the slot\'s title and rename the calendar event.');
  var subject = 'Cancelled: ' + row.type + (drop_tea ? ' and tea' : '') + ' on ' + fmt_day(row.start) + (!just_tea && row.tea_ids.length ? ' (just tea now)' : '');
  if (to.length) send_mail(to.join(','), subject, blocks, ctx.constants, {reply_to: organiser, cc: organiser});
  else if (!how.by_organiser) send_mail(organiser, subject, blocks, ctx.constants, {as: row.type});
  return {emailed: names_of(chosen.filter(has_address), ctx.people),
          no_address: names_of(chosen.filter(function(id){ return !has_address(id); }), ctx.people)};
}
