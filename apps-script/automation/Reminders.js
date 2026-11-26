// Daily: reminders for organisers, then the autopilot (Autopilot.js). (Reminders for presenters and tea people
// stay in the old Cron Jobs.)
//  - fixed dates from the "Automation reminders" tab of the constants sheet (seeded with DEFAULT_DATE_REMINDERS)

const DEFAULT_DATE_REMINDERS = [
  {month: 4, day: 22, type: 'TNJC', subject: 'Add the first years as TNJC presenters',
   body: 'Third term has started. Add this year\'s first years as TNJC presenters on the site: open their page (People) and tick TNJC (and CSNJC if they want).'},
  {month: 10, day: 1, type: 'TNJC', subject: 'New academic year: update the TNJC mailing list and presenters',
   body: 'Add the new students to the gatsby-tnjc Google Group (Group → People → Add members; direct adding only works for Gmail addresses, others need an invite). On the site, untick TNJC / CSNJC for people who have left.'}
];

function run_daily_reminders(){
  var constants = get_global_constants();
  var failed = null;
  try {
    daily_reminders(constants, get_settings());
  } catch (err) {
    notify_error('Organiser reminders', err, constants);
    failed = err;
  }
  try {
    run_autopilot(constants, get_settings());
  } catch (err) {
    notify_error('Autopilot', err, constants);
    failed = failed || err;
  }
  try { telemetry_prune(); } catch (err) { Logger.log('telemetry prune: ' + err); }
  if (failed) throw failed;
}

function daily_reminders(constants, settings){
  var today = start_of_today();
  var handbook = settings.HANDBOOK_URL ? [{link: 'Organiser handbook', url: settings.HANDBOOK_URL}] : [];

  settings.date_reminders.forEach(function(r){
    if (today.getMonth() + 1 === r.month && today.getDate() === r.day){
      send_mail(admin_email_for_type(r.type, constants), r.subject, [r.body].concat(handbook), constants, {as: r.type});
    }
  });
}

