// One-off (2026-10-27): live test of cancelling, on Jan's own TNJC slot of Tue 22 Dec 2026, done the way the
// tea page does it; then everything is put back. Jan gets the one "Cancelled" email. Delete this file afterwards.
function run_once_cancel_test(){
  var constants = get_global_constants();
  var ctx = make_context(constants, get_settings());
  var rows = load_rows('TNJC', new Date(2026, 11, 22), new Date(2026, 11, 22), ctx);
  if (rows.length !== 1) throw new Error('Expected one TNJC slot on 22 Dec, found ' + rows.length);
  var row = rows[0];
  if (names_of(row.presenter_ids, ctx.people).join(', ') !== 'Jan Bauer' || row.guest) throw new Error('The 22 Dec TNJC is not Jan\'s any more; test skipped.');
  var before = {title: row.title, presenter_ids: row.presenter_ids.slice()};
  var event = ctx.cal.getEventById(row.gcal_id);
  var event_before = {title: event.getTitle(), description: event.getDescription()};
  Logger.log('Before: Notion title "' + before.title + '", presenter Jan Bauer; event "' + event_before.title + '"');
  try {
    if (!can_cancel(row, ctx)) throw new Error('The page would not offer cancelling for this slot.');
    cancel_slot(row, ctx, {source: 'page', by: 'Jan Bauer', reason: 'Live test of the new cancel option (undone straight away)'});
    var after = to_row(notion_get_page(row.id, constants));
    Logger.log('Cancelled: Notion title "' + after.title + '", presenters ' + after.presenter_ids.length + '; event "' + ctx.cal.getEventById(row.gcal_id).getTitle() + '"');
    Logger.log('Deleted events the Calendar API reports for the last 3 days: ' + Object.keys(recently_deleted_events(ctx)).length);
  } finally {
    notion_patch_page(row.id, {
      'Title': {title: before.title ? [{text: {content: before.title}}] : []},
      'Presenter': {relation: before.presenter_ids.map(function(id){ return {id: hyphenate_id(id)}; })}
    }, constants);
    event.setTitle(event_before.title);
    event.setDescription(event_before.description);
    var restored = to_row(notion_get_page(row.id, constants));
    save_state(row.gcal_id, {t: event_before.title, n: notion_fingerprint(restored), d: restored.start.getTime(), x: notion_text_fingerprint(restored)});
    log_row(ctx, 'run once', row.type, row.start, 'restored', 'after the live cancel test');
    Logger.log('Restored: Notion title "' + restored.title + '", presenter ' + names_of(restored.presenter_ids, ctx.people).join(', ') + '; event "' + event.getTitle() + '"');
  }
}

// Which recently deleted events are still linked from a Notion slot (those the new rule would cancel)?
function run_once_check_deleted(){
  var constants = get_global_constants();
  var ctx = make_context(constants, get_settings());
  var res = Calendar.Events.list(constants['google_calendar_id'], {showDeleted: true, maxResults: 250, updatedMin: new Date(Date.now() - 3 * 864e5).toISOString()});
  var deleted = (res.items || []).filter(function(e){ return e.status === 'cancelled'; });
  var linked = {};
  ctx.settings.sync_types.forEach(function(type){
    load_rows(type, start_of_today(), null, ctx).forEach(function(r){ if (r.gcal_id) linked[event_key(r.gcal_id)] = r; });
  });
  deleted.forEach(function(e){
    var r = linked[event_key(e.id)];
    Logger.log(e.id + ' "' + (e.summary || '') + '" updated ' + e.updated + ': ' + (r ? 'LINKED to ' + r.type + ' ' + fmt_day(r.start) + ' (' + (r.guest || names_of(r.presenter_ids, ctx.people).join(', ')) + ')' : 'not linked'));
  });
  Logger.log(deleted.length + ' deleted, ' + deleted.filter(function(e){ return linked[event_key(e.id)]; }).length + ' still linked from upcoming Notion slots');
}
