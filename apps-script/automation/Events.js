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
           text: 'The TNJC schedule has been updated. You may view it on the Notion Page or through the gatsby.tea Google Calendar.'},
  'MLJC': {admin: 'mljc_admin_email', list: 'mljc_email', label: 'MLJC', subject: 'MLJC schedule updated',
           text: 'The MLJC schedule has been updated. You may view it on the Notion Page or through the gatsby.tea Google Calendar.'},
  'Coffee Cleaning': {admin: 'coffee_admin_email', list: 'coffee_email', label: 'Coffee cleaning', subject: 'Coffee cleaning rota updated',
           text: 'The coffee cleaning rota has been updated. You may view it on the Notion Page or through the gatsby.tea Google Calendar.'},
  'talks': {admin: 'admin_email', list: 'unit_wide_email', label: 'Research / tea talks', subject: 'Tea schedule updated',
           text: 'The tea talk schedule has been updated for the next month and the research talk schedule for the month after. You may view it on the Notion Page or through the gatsby.tea Google Calendar.'}
};

function event_description(row, ctx){
  if (row.type === 'Coffee Cleaning') return 'Duty Description:\n\n' + (row.description ? row.description + '\n' : '');
  var d = 'Title: ' + (is_tentative(row) ? '' : row.title) + '\nZoom Link: ' + ctx.constants['gatsby_zoom_link'];
  if (row.description) d += '\nDescription: ' + row.description;
  return d;
}

// creates the event and stores its ID in Notion (plus any extra Notion properties, in the same call)
function create_event(row, ctx, extra_props){
  var title = format_title(row, ctx.people);
  var end = row.end || new Date(row.start.getTime() + 3600 * 1000);
  var opts = {description: event_description(row, ctx)};
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
  rows.forEach(function(row){
    row.title = '';
    create_event(row, ctx, {'Title': {title: [{text: {content: ''}}]}});
  });
  log_row(ctx, 'finalise', rota, null, 'finalised', rows.length + ' slots' + (email_group ? ', group emailed' : ''));
  if (email_group && rows.length > 0){
    var r = ROTAS[rota];
    send_mail(ctx.constants[r.list], r.subject, ['Hi friends,', r.text], ctx.constants, {reply_to: ctx.constants[r.admin]});
  }
  return rows.length;
}

// Swap one person's duty in a slot for another person: Notion, calendar, and one email to both.
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
  var ids = validate_swap(row, duty, from_id, to_id, ctx);
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
  var from_name = names_of([from_id], ctx.people)[0];
  var to_name = names_of([to_id], ctx.people)[0];
  log_row(ctx, 'swap', row.type, row.start, 'swapped', (duty === 'tea' ? 'tea: ' : '') + from_name + ' -> ' + to_name);

  var organiser = admin_email_for_type(row.type, ctx.constants);
  var both = emails_of([from_id, to_id], ctx.people);
  var what = duty === 'tea' ? (row.type === 'Coffee Cleaning' ? 'coffee duty' : 'tea duty') : 'presenter';
  send_mail(both.length ? both.join(',') : organiser, 'Swap done: ' + fmt_day(row.start) + ' ' + row.type, swap_done_blocks(row, what, from_name, to_name), ctx.constants, {reply_to: organiser});
  if (both.length < 2) send_mail(organiser, 'Swap: please check', ['A swap went through, but one of the two people has no registered email, so they were not told.', {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['Before', from_name], ['Now', to_name]]}], ctx.constants);
  return 'Done: ' + to_name + ' now has this ' + what + '. You both got an email.';
}

function swap_done_blocks(row, what, from_name, to_name){
  return [
    'The ' + what + ' for this slot has been swapped. Notion and the shared calendar are updated.',
    {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['Before', from_name], ['Now', to_name]]},
    '[Open in Notion](' + row.url + ')'
  ];
}

// Cancelling a talk, a last resort: swapping is always better. The slot stays in Notion, titled "Cancelled",
// without its presenter, so they keep their turn and are scheduled again soon; tea duty stays. A just tea
// (cancelled in the calendar only) loses its tea people instead, who keep their turn. how.source is 'page'
// (the presenter on their tea page, with how.by and how.reason), 'deleted' or 'renamed' (by hand in the
// calendar). One email to the presenter and the tea people, with the organiser in cc.
function cancel_slot(row, ctx, how){
  var just_tea = row.type === 'Just Tea';
  var thing = just_tea ? 'just tea' : 'talk';
  var bumped = (just_tea ? row.tea_ids : row.presenter_ids).slice();
  var was = (just_tea ? '' : row.guest) || names_of(bumped, ctx.people).join(', ');
  var props = {'Title': {title: [{text: {content: CANCELLED_TITLE}}]}};
  props[just_tea ? 'Tea' : 'Presenter'] = {relation: []};
  if (!just_tea && ctx.has_guest_prop && row.guest) props[GUEST_PROP] = {rich_text: []};
  notion_patch_page(row.id, props, ctx.constants);
  row.title = CANCELLED_TITLE;
  if (just_tea){
    row.tea_ids = [];
  } else {
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
  var why = how.source === 'page' ? how.by + ': ' + how.reason : (how.source === 'deleted' ? 'event deleted in the calendar' : 'event renamed in the calendar');
  log_row(ctx, how.source === 'page' ? 'page' : 'sync', row.type, row.start, 'cancelled', why + (was ? ' (was: ' + was + ')' : ''));

  var organiser = admin_email_for_type(row.type, ctx.constants);
  var to = emails_of(bumped.concat(row.tea_ids), ctx.people);
  var role = just_tea ? 'tea person' : 'presenter';
  var table = [['Slot', fmt_day(row.start) + ', ' + fmt_time(row.start) + ', ' + row.type], [just_tea ? 'Tea' : 'Presenter', was || '–']];
  if (how.source === 'page') table.push(['Reason', how.reason]);
  var blocks = [
    how.source === 'page' ? how.by + ' has cancelled this talk.'
      : 'This ' + thing + ' was ' + (how.source === 'deleted' ? 'deleted from' : 'marked as cancelled in') + ' the calendar, so the bot has recorded it as cancelled.',
    {table: table}
  ];
  if (bumped.length) blocks.push('The ' + role + ' is no longer recorded for this slot, so they keep their turn and will be scheduled again soon.');
  if (row.tea_ids.length) blocks.push('Tea duty stays as it is unless the organiser changes it.');
  blocks.push('Organiser: the calendar shows the ' + thing + ' as cancelled; please let the group know if needed. To undo, put the ' + role + ' back in Notion, remove "' + CANCELLED_TITLE + '" from the slot\'s title and rename the calendar event.');
  send_mail(to.length ? to.join(',') : organiser, 'Cancelled: ' + row.type + ' on ' + fmt_day(row.start), blocks, ctx.constants, to.length ? {reply_to: organiser, cc: organiser} : {});
}
