// One-off live test: invite Jan to his own 22 Dec TNJC slot (INVITE_TYPES stays empty). Run it again after
// declining the invitation to get the "still yours" email. Also adds the new INVITE_TYPES row to the
// Automation tab. Remove afterwards.
function run_once_invite_test(){
  ensure_settings_tabs();
  var ctx = make_context(get_global_constants(), get_settings());
  ctx.settings = Object.assign({}, ctx.settings, {invite_types: ['TNJC']});
  var day = new Date(2026, 11, 22);
  var row = load_rows('TNJC', day, day, ctx).filter(function(r){ return names_of(r.presenter_ids, ctx.people).indexOf('Jan Bauer') >= 0; })[0];
  if (!row) throw new Error('No TNJC slot of Jan on 22 Dec');
  var res = sync_invites(row, ctx);
  Logger.log(JSON.stringify(res) + ' state: ' + JSON.stringify(load_invite_state(row.gcal_id)));
}

// One-off check of "Who is on which rota" against the live data: counts only.
function run_once_overview_check(){
  var r = rota_overview(make_context(get_global_constants(), get_settings()));
  var counts = {};
  r.columns.forEach(function(c){ counts[c.label] = r.people.filter(function(p){ return p.on[c.key]; }).length; });
  Logger.log('active ' + r.people.length + ', inactive ' + r.inactive + ', without email ' + r.people.filter(function(p){ return !p.email; }).length +
             ', with upcoming slots ' + r.people.filter(function(p){ return p.upcoming; }).length + ', per rota ' + JSON.stringify(counts));
}
