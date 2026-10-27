// Leaving the tea system: the "Leave the tea system (no longer a member of the Unit)" link at the end of every
// bot email. It only concerns the tea system: the person is marked inactive in Notion (no more scheduling),
// their registered email and tea-page code are cleared (no more emails from the bot or the Cron Jobs), their
// open swap requests are dropped, and the tea tsar gets an email (organisers of slots they still hold in cc).
// Gatsby's mailing lists are not touched. To come back, the tea tsar ticks Active on their Notion page and
// fills in their email again.
//
// Links in emails are opened by mail scanners, so leaving takes one click on the page, but no confirmation
// by email: people who left the Unit often can't read their university address any more. An email to several
// people (or with someone in cc) carries the general link, where they pick their name; as anyone could do
// that, the tea tsar's email says so, and the person's registered address gets a note too.

function leave_url(to, options, constants){
  try {
    var settings = get_settings();
    if (!page_url(settings)) return '';
    var single = String(to).indexOf(',') < 0 && !(options && options.cc);
    if (single){
      if (!identity_token_cache) identity_token_cache = identity_rows(constants).rows;
      var want = String(to).trim().toLowerCase();
      var hit = identity_token_cache.filter(function(r){ return r.email.toLowerCase() === want && r.token; })[0];
      if (hit) return page_link(settings, {t: hit.token, leave: 1});
    }
    return page_link(settings, {leave: 1});
  } catch (e) {
    return '';
  }
}

var identity_token_cache = null;

// upcoming slots where this person presents or does tea
function upcoming_rows_of(id, ctx){
  var pages = notion_query(ctx.constants['notion_talk_db_id'], {and: [
    {property: 'Date', date: {on_or_after: fmt_iso_date(start_of_today())}},
    {or: [{property: 'Presenter', relation: {contains: hyphenate_id(id)}}, {property: 'Tea', relation: {contains: hyphenate_id(id)}}]}
  ]}, [{property: 'Date', direction: 'ascending'}], ctx.constants);
  return pages.map(to_row).filter(function(r){ return r.start && !is_cancelled_title(r.title); });
}

function slot_line(row, id){
  var duty = row.presenter_ids.indexOf(id) >= 0 && PRESENTER_TYPES.indexOf(row.type) >= 0 ? 'presenter' : 'tea';
  return fmt_day(row.start) + ': ' + duty_word(row, duty) + (is_tentative(row) ? ' (tentative)' : '');
}

function api_leave_info(token){
  var ctx = page_context(token);
  return {name: ctx.me.name, active: ctx.me.active,
          slots: upcoming_rows_of(ctx.me.id, ctx).map(function(r){ return slot_line(r, ctx.me.id); })};
}

const LEFT_MESSAGE = 'Done: you have left the Gatsby tea system. You will not be scheduled again, and the tea bot will not email you any more. If you change your mind, ask the tea tsar.';

function api_leave(token){
  var ctx = page_context(token);
  with_script_lock(function(){ leave_tea_system(ctx, 'own link'); });
  return LEFT_MESSAGE;
}

// the general page (with the unit key): pick your name, one click
function api_leave_by_name(key, person_id){
  check_page_key(key);
  person_id = normalise_id(String(person_id || '').trim());
  if (!/^[0-9a-f]{32}$/.test(person_id)) throw new Error('Please pick your name.');
  var cache = CacheService.getScriptCache();
  var total = Number(cache.get('leave:all') || 0);
  if (total >= 5) throw new Error('Several people have left in the last hour. Please try again later, or ask the tea tsar.');
  var ctx = make_context(get_global_constants(), get_settings());
  var me = ctx.people[person_id];
  if (!me || !me.active) throw new Error('This name is not in the tea system (any more).');
  ctx.me = me;
  ctx.me_identity = identity_rows(ctx.constants).rows.filter(function(r){ return r.id === person_id; })[0] || {email: ''};
  cache.put('leave:all', String(total + 1), 3600);
  with_script_lock(function(){ leave_tea_system(ctx, 'name picked on the tea page'); });
  return LEFT_MESSAGE;
}

function with_script_lock(fn){
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try { fn(); } finally { lock.releaseLock(); }
}

// how: 'own link' (their personal link) or 'name picked on the tea page' (anyone could have done it)
function leave_tea_system(ctx, how){
  var me = ctx.me;
  var rows = upcoming_rows_of(me.id, ctx);
  notion_patch_page(me.id, {'Active': {checkbox: false}}, ctx.constants);
  swap_requests().filter(function(r){ return r.from === me.id || r.to === me.id; }).forEach(function(r){ drop_swap_request(r.code); });
  var tsar = ctx.constants['admin_email'];
  var email = ctx.me_identity.email;
  if (email){
    send_mail(email, 'You have left the Gatsby tea system', [
      'You have left the Gatsby tea system: you will not be scheduled for talks, journal clubs, tea or coffee duty any more, and this is the last email from the tea bot.',
      'This was only about the tea system. Gatsby\'s mailing lists are not affected, so group announcements still reach you.',
      'Was this not you, or do you want to come back? Reply to this email and the tea tsar will put you back.'
    ], ctx.constants, {reply_to: tsar});
  }
  var ident = identity_rows(ctx.constants);
  var mine = ident.rows.filter(function(r){ return r.id === me.id; })[0];
  if (mine) ident.sheet.getRange(mine.row, 3, 1, 2).setValues([['', '']]);   // email, tea-page code
  CacheService.getScriptCache().remove(PEOPLE_CACHE_KEY);
  identity_token_cache = null;
  log_row(ctx, 'page', '', null, 'left the tea system', me.name + (rows.length ? ', ' + rows.length + ' upcoming slots to reassign' : ''));

  // one email to the tea tsar; the organisers of slots they still hold in cc
  var cc = rows.map(function(r){ return admin_email_for_type(r.type, ctx.constants); })
    .filter(function(o, i, a){ return o && o !== tsar && a.indexOf(o) === i; });
  var blocks = [
    me.name + ' has left the Gatsby tea system (no longer a member of the Unit), using the link at the end of the bot\'s emails. They are now inactive in Notion, so they will not be scheduled again, and the bot no longer emails them.',
    how === 'own link' ? 'They used their personal link.' : 'They picked their name on the tea page, which anyone could do. If this looks wrong, undo it (below) and let them know.'
  ];
  if (rows.length){
    blocks.push('They still hold these slots. Please give them to someone else: in Notion or the calendar, or for tentative slots with "Fill … again" on the tea page after clearing them' + (cc.length ? ' (the organisers are in cc)' : '') + '.');
    blocks.push({items: rows.map(function(r){ return '[' + slot_line(r, me.id) + '](' + r.url + ')'; })});
  } else {
    blocks.push('They had no upcoming slots.');
  }
  blocks.push('To undo: tick Active on their Notion page and put their email back in column C of the identity sheet.');
  send_mail(tsar || ctx.constants['tnjc_admin_email'], me.name + ' has left the tea system', blocks, ctx.constants, cc.length ? {cc: cc.join(',')} : {});
}
