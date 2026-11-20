function putawaydate_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    putawaydatereminder(admin_email, constants);
  } catch (err) {
    send_tsar_email(admin_email, 'Urgent: Unknown Error When Sending Away Date Reminders', 'Error message:\n\n' + err, constants );
    throw err;
  }
}

function putawaydatereminder(admin_email, constants) {
  // constants
  const email_group = constants['unit_wide_email'];
  const today = new Date();
  
  // send reminder for people to put in away dates on 18th
  const today_date = today.getDate();
  // Not sent while the talks are on autopilot (Autopilot.js): everyone it pencils in is told by email, and until
  // three weeks before, adding away dates hands their slot to the next free person by itself.
  if (today_date == 11 && !auto_rota_on('talks')){
    // send talk reminders
    send_email(email_group, "Please update your away dates", 
      "Hi friends,\n\n" + 
      "This is a reminder to update your away dates for next month and the month after before the 17th of this month. Tea talks for next month and research talks for the month after will be scheduled after the 17th." +
      (tea_page_url() ? "\n\nThe easiest way is your tea page (pick your name to get your personal link):\n" + tea_page_url() + "\nYour away-date sheet works as before; both hold the same dates." : ""), constants, admin_email );
  }
}

// whether the tea bot schedules this rota by itself (AUTO_TYPES in the automation's settings); false if unreadable
function auto_rota_on(rota){
  try {
    return TeaBot.get_settings().auto_rotas.indexOf(rota) >= 0;
  } catch (err) {
    return false;
  }
}

// remind tea tsar to schedule talks (not needed once the talks are on autopilot)
function scheduletalksreminder_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  const today = new Date();
  const today_date = today.getDate();
  if (today_date == 18 && !auto_rota_on('talks')){
    send_tsar_email(admin_email, "Reminder: Schedule Talks",
    "Please schedule tea talks for next month and research talks for the month after.", constants);
  }
}