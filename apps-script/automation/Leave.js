// Leaving the tea system: the "Leave the tea system" link at the end of every bot email. It only concerns the
// tea system: the person is marked inactive in Notion (no more scheduling), their registered email and
// tea-page code are cleared (no more emails from the bot or the Cron Jobs), their open swap requests are
// dropped, and the organisers are told about any upcoming slots they still hold. Gatsby's mailing lists are
// not touched. To come back, the tea tsar ticks Active on their Notion page and fills in their email again.
//
// Links in emails are opened by mail scanners, so leaving always takes a click on the page. An email to
// several people (or with someone in cc) carries the general link: pick your name, and the confirmation
// link goes to your registered address.

function leave_url(to, options, constants){
  try {
    var url = page_url(get_settings());
    if (!url) return '';
    var single = String(to).indexOf(',') < 0 && !(options && options.cc);
    if (single){
      if (!identity_token_cache) identity_token_cache = identity_rows(constants).rows;
      var want = String(to).trim().toLowerCase();
      var hit = identity_token_cache.filter(function(r){ return r.email.toLowerCase() === want && r.token; })[0];
      if (hit) return personal_link(hit.token, get_settings()) + '&leave=1';
    }
    return url + '?leave=1';
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

function api_leave(token){
  var ctx = page_context(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  try {
    leave_tea_system(ctx);
  } finally {
    lock.releaseLock();
  }
  return 'Done: you have left the Gatsby tea system. You will not be scheduled again, and the tea bot will not email you any more. If you change your mind, ask the tea tsar.';
}

function leave_tea_system(ctx){
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

  // the organisers of the slots they still hold, else the tea tsar, are told
  var by_organiser = {};
  rows.forEach(function(r){ var o = admin_email_for_type(r.type, ctx.constants); (by_organiser[o] = by_organiser[o] || []).push(r); });
  if (!rows.length) by_organiser[tsar] = [];
  Object.keys(by_organiser).forEach(function(organiser){
    var list = by_organiser[organiser];
    var blocks = [me.name + ' has left the Gatsby tea system (with the link at the end of the bot\'s emails). They are now inactive in Notion, so they will not be scheduled again, and the bot no longer emails them.'];
    if (list.length){
      blocks.push('They still hold these slots. Please give them to someone else: in Notion or the calendar, or for tentative slots with "Fill … again" on your tea page after clearing them.');
      blocks.push({items: list.map(function(r){ return '[' + slot_line(r, me.id) + '](' + r.url + ')'; })});
    }
    blocks.push('To undo: tick Active on their Notion page and put their email back in column C of the identity sheet.');
    send_mail(organiser, me.name + ' has left the tea system', blocks, ctx.constants, tsar && tsar !== organiser ? {cc: tsar} : {});
  });
}

// the page without a personal link: emails the chosen person a link to confirm leaving
function api_request_leave_link(person_id){
  return send_personal_link(person_id, 'Leaving the Gatsby tea system', function(url){
    var leave = url + '&leave=1';
    return [
      'Someone, hopefully you, asked on the Gatsby tea page to leave the tea system with this address. To confirm, open this link and press the button there:',
      {link: 'Leave the tea system', url: leave},
      'Or copy this address into your browser: ' + leave,
      'If you want to stay, just ignore this email; nothing changes.'
    ];
  });
}
