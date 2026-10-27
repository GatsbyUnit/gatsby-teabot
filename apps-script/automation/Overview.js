// "Who is on which rota", for organisers and the tea tsar on their tea page. Membership comes from the same
// rules the scheduler and the swap list use (can_do_duty): the TNJC / CSNJC / MLJC / Coffee ticks, Position
// and the "Excluded from …" boxes on each person's Notion page, which is where it is changed.

const ROTA_COLUMNS = [
  {key: 'tnjc', label: 'TNJC', row: {type: 'TNJC', csnjc: false}, duty: 'presenter'},
  {key: 'csnjc', label: 'CSNJC', row: {type: 'TNJC', csnjc: true}, duty: 'presenter'},
  {key: 'mljc', label: 'MLJC', row: {type: 'MLJC'}, duty: 'presenter'},
  {key: 'research', label: 'Research talk', row: {type: 'Research Talk'}, duty: 'presenter'},
  {key: 'teatalk', label: 'Tea talk', row: {type: 'Tea Talk'}, duty: 'presenter'},
  {key: 'tea', label: 'Tea', row: {type: 'Just Tea'}, duty: 'tea'},
  {key: 'coffee', label: 'Coffee', row: {type: 'Coffee Cleaning'}, duty: 'tea'}
];

function rota_overview(ctx){
  var upcoming = {};
  var today = start_of_today();
  notion_query(ctx.constants['notion_talk_db_id'], {property: 'Date', date: {on_or_after: fmt_iso_date(today)}},
               [{property: 'Date', direction: 'ascending'}], ctx.constants).map(to_row).forEach(function(r){
    if (!r.start || is_cancelled_title(r.title)) return;
    r.presenter_ids.concat(r.tea_ids).forEach(function(id){
      var u = upcoming[id] = upcoming[id] || {n: 0, next: ''};
      u.n++;
      if (!u.next) u.next = fmt_day(r.start) + ', ' + r.type + (is_tentative(r) ? ' (tentative)' : '');
    });
  });
  var people = Object.keys(ctx.people).map(function(id){ return ctx.people[id]; })
    .filter(function(p){ return p.active && p.name; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); })
    .map(function(p){
      var on = {};
      ROTA_COLUMNS.forEach(function(c){ on[c.key] = can_do_duty(p, c.row, c.duty); });
      return {id: p.id, name: p.name, position: p.position, on: on, email: !!p.email,
              upcoming: upcoming[p.id] ? upcoming[p.id].n : 0, next: upcoming[p.id] ? upcoming[p.id].next : ''};
    });
  var inactive = Object.keys(ctx.people).filter(function(id){ return !ctx.people[id].active && ctx.people[id].name; }).length;
  return {columns: ROTA_COLUMNS.map(function(c){ return {key: c.key, label: c.label}; }), people: people, inactive: inactive};
}

function api_rotas(token){
  var ctx = page_context(token);
  if (!Object.keys(ROTAS).some(function(rota){ return is_organiser(ctx, rota); })) throw new Error('Only organisers and the tea tsar can see this.');
  return rota_overview(ctx);
}
