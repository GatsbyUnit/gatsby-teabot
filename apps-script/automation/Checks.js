// Safe checks, run by hand from the editor (open this file and press Run: it runs the first function).
// Nothing is written to Notion or the calendar.
//
//   send_examples()  emails the TNJC organiser one example of each kind of bot email, all marked
//                    "[Example]" and built with the real code (nobody else gets anything)
//   preview()  emails the TNJC organiser a sample message in the bot's format (to check how it looks in
//              a normal and in a terminal mail client) and logs the swap / title links the next upcoming
//              slot of each synced type would get

function send_examples(){
  var constants = get_global_constants();
  var ctx = make_context(constants, get_settings());
  var me = String(constants['tnjc_admin_email']);
  var real_send = send_mail;
  var sent = [];
  // every email below goes to the TNJC organiser only, whoever the real code would address
  send_mail = function(to, subject, blocks, c, options){
    real_send(me, '[Example] ' + subject, blocks, constants, {});
    sent.push(subject);
  };
  try {
    // two active people stand in for the example; nobody but the organiser receives anything
    var active = Object.keys(ctx.people).map(function(id){ return ctx.people[id]; }).filter(function(p){ return p.active && p.name; })
      .sort(function(a, b){ return a.name.localeCompare(b.name); });
    var person = active[0], other = active[1];
    var row = {id: 'x', url: constants['notion_site_url'], type: 'TNJC', title: '', description: '', start: new Date(2026, 10, 10, 13, 30), end: null,
               presenter_ids: [person.id], tea_ids: [], csnjc: false, gcal_id: '', guest: ''};

    // 1. a swap through the tea page (sent to both people)
    send_mail(me, 'Swap done: ' + fmt_day(row.start) + ' TNJC', swap_done_blocks(row, 'presenter', other.name, person.name), constants);
    // 2. a calendar event was edited by hand, so Notion was updated (sent to both people, organiser in cc)
    notify_swap_from_calendar(row, {Presenter: [other.id], Tea: []}, {Presenter: [person.id]}, ['"' + person.name.replace(/e/, '') + '" was read as ' + person.name + '.'], ctx);
    // 3. the bot could not tell who a name means (sent to the tea tsar, organiser in cc)
    var f = finding(row, 'uncertain_match', 'The calendar says "TNJC: Sam", but Notion says "TNJC: ' + person.name + '". I could not tell for sure who is meant: "Sam" could be Sam Smith or Sam Jones. Nothing was changed. Please record the right person in Notion.', false);
    send_mail(me, 'Could not match a name in the TNJC calendar', digest_blocks([f], false, ctx.log.getUrl()), constants);
    // 4. someone asked for their personal page link
    send_mail(me, 'Your tea page', page_link_blocks(page_url(ctx.settings) + '?t=' + '0'.repeat(40)), constants);
    // 5. organiser reminder (Mondays, when the schedule is running out)
    send_mail(me, 'Time to schedule more TNJC slots', [
      'The TNJC schedule currently runs until Tue 22 Dec 2026 (18 days from now).',
      'Plan the next slots in the Organiser section of your tea page: create them, delete the ones you do not need in Notion (bank holidays, UCL closures, retreat, conference deadlines), fill them with people, check, and finalise.'
    ], constants);
    // 6. a presenter reminder from the old Cron Jobs (plain text, as before), now ending with the tea page line
    MailApp.sendEmail(me, '[Example] [Gatsby Tea Bot] REMINDER TNJC Presentation on 10 Nov 2026',
      'Hi,\n\nThis is a reminder for your talk next week. \n\n=============\n\nTitle: \nType: TNJC\nTime: 13:30 - 14:30, 10 Nov 2026\nPresenter: ' + person.name + '\nZoom Link: ' + constants['gatsby_zoom_link'] + '\nDescription: \n=============\n\n' +
      '(... rest of the usual reminder text ...)\n\n' +
      'Swap your slot, add your title or set away dates on your tea page:\n' + page_url(ctx.settings) + '?t=' + '0'.repeat(40) + '\n\n\n\n--------\nGatsby Tea Bot @ 2026\n' + constants['notion_site_url'], {name: 'Gatsby Tea Bot'});
    sent.push('REMINDER TNJC Presentation (old format + page line)');
  } finally {
    send_mail = real_send;
  }
  Logger.log('Sent ' + sent.length + ' examples to ' + me + ':\n' + sent.join('\n'));
}

function preview(){
  var constants = get_global_constants();
  var ctx = make_context(constants, get_settings());
  var today = start_of_today();
  var lines = [];
  var items = [];
  ctx.settings.sync_types.forEach(function(type){
    var row = load_rows(type, today, add_days(today, 60), ctx).filter(function(r){ return !is_tentative(r); })[0];
    if (!row){ lines.push(type + ': no upcoming slot'); items.push(type + ': no upcoming slot'); return; }
    var swap = swap_link(row, ctx);
    var title = PRESENTER_TYPES.indexOf(row.type) >= 0 ? title_link(row, ctx) : null;
    lines.push(type + ' ' + fmt_day(row.start) + ' (' + format_title(row, ctx.people) + ')');
    lines.push('  swap: ' + swap);
    if (title) lines.push('  title: ' + title);
    lines.push('  footer added to the event:' + links_footer(row, ctx, false).replace(/\n/g, '\n    '));
    items.push(fmt_day(row.start) + ', ' + format_title(row, ctx.people) + ': [swap form](' + swap + ')' + (title ? ', [title form](' + title + ')' : ''));
  });
  lines.forEach(function(l){ Logger.log(l); });

  send_mail(constants['tnjc_admin_email'], 'Preview: how bot emails look', [
    'This is a sample of the new email format. Normal mail clients show this formatted version; terminal clients (mutt, alpine) show a plain-text version of the same content.',
    {heading: 'Example: a swap'},
    {table: [['Slot', 'Tue 10 Nov 2026, TNJC'], ['From', 'Ada Lovelace'], ['To', 'Alan Turing']]},
    {items: ['Notion and the shared calendar are updated', 'Both people get this email', 'Reply to reach the organiser']},
    {link: 'Open in Notion', url: constants['notion_site_url']},
    {heading: 'Links the next slot would get'},
    {items: items}
  ], constants);
  Logger.log('Sample email sent to ' + constants['tnjc_admin_email']);
}
