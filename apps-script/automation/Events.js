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
function apply_swap(row, duty, from_id, to_id, ctx){
  var ids = duty === 'tea' ? row.tea_ids : row.presenter_ids;
  if (is_tentative(row)) throw new Error('This slot is still tentative, so it cannot be swapped yet.');
  if (ids.indexOf(from_id) < 0) throw new Error('This slot has changed in the meantime. Please reload the page.');
  if (from_id === to_id) throw new Error('The slot already belongs to this person.');
  if (!ctx.people[to_id] || !ctx.people[to_id].active) throw new Error('That person is not on the active list.');
  if (!is_live(ctx, row.type)) throw new Error('Swaps for ' + row.type + ' are not switched on yet. Please ask the organiser.');

  var new_ids = ids.map(function(id){ return id === from_id ? to_id : id; });
  var props = {};
  props[duty === 'tea' ? 'Tea' : 'Presenter'] = {relation: new_ids.map(function(id){ return {id: hyphenate_id(id)}; })};
  notion_patch_page(row.id, props, ctx.constants);
  if (duty === 'tea') row.tea_ids = new_ids; else row.presenter_ids = new_ids;

  var event = row.gcal_id ? ctx.cal.getEventById(row.gcal_id) : null;
  if (event){
    var title = keep_label(event.getTitle(), format_title(row, ctx.people), row.type);
    event.setTitle(title);
    save_state(row.gcal_id, {t: title, n: notion_fingerprint(row), d: row.start.getTime()});
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
