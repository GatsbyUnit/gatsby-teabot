// Daily: reminders for organisers. (Reminders for presenters and tea people stay in the old Cron Jobs.)
//  - Mondays: if a type's schedule ends within SCHEDULE_WARNING_DAYS, nudge its organiser to run scheduling
//  - fixed dates from the "Automation reminders" tab of the constants sheet (seeded with DEFAULT_DATE_REMINDERS)

const DEFAULT_DATE_REMINDERS = [
  {month: 4, day: 22, type: 'TNJC', subject: 'Add the first years as TNJC presenters',
   body: 'Third term has started. Add this year\'s first years as TNJC presenters in Notion: open their People page and tick TNJC (and CSNJC if they want).'},
  {month: 10, day: 1, type: 'TNJC', subject: 'New academic year: update the TNJC mailing list and presenters',
   body: 'Add the new students to the gatsby-tnjc Google Group (Group → People → Add members; direct adding only works for Gmail addresses, others need an invite). In Notion, untick TNJC / CSNJC for people who have left.'}
];

function run_daily_reminders(){
  var constants = get_global_constants();
  try {
    daily_reminders(constants, get_settings());
  } catch (err) {
    notify_error('Organiser reminders', err, constants);
    throw err;
  }
}

function daily_reminders(constants, settings){
  var today = start_of_today();
  var handbook = settings.HANDBOOK_URL ? [{link: 'Organiser handbook', url: settings.HANDBOOK_URL}] : [];

  if (today.getDay() === 1){
    settings.reminder_types.forEach(function(type){
      var last = last_scheduled_date(type, constants);
      var days = last ? Math.round((last - today) / (24 * 3600 * 1000)) : -1;
      if (last && days > settings.schedule_warning_days) return;
      var when = last ? 'The ' + type + ' schedule currently runs until ' + fmt_day(last) + ' (' + days + ' days from now).' : 'There are no upcoming ' + type + ' slots in Notion.';
      send_mail(admin_email_for_type(type, constants), 'Time to schedule more ' + type + ' slots', [
        when,
        'Plan the next slots in the Organiser section of your tea page: create them, delete the ones you do not need in Notion (bank holidays, UCL closures, retreat, conference deadlines), fill them with people, check, and finalise.'
      ].concat(handbook), constants);
    });
  }

  settings.date_reminders.forEach(function(r){
    if (today.getMonth() + 1 === r.month && today.getDate() === r.day){
      send_mail(admin_email_for_type(r.type, constants), r.subject, [r.body].concat(handbook), constants);
    }
  });
}

function last_scheduled_date(type, constants){
  var res = notion_request('post', 'databases/' + constants['notion_talk_db_id'] + '/query', {
    filter: {property: 'Type', select: {equals: type}},
    sorts: [{property: 'Date', direction: 'descending'}],
    page_size: 1
  }, constants);
  if (res.results.length === 0) return null;
  var row = to_row(res.results[0]);
  return row.start;
}
