function putawaydate_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    putawaydatereminder(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Sending Away Date Reminders', 'Error message:\n\n' + err, constants );
    throw err;
  }
}

function putawaydatereminder(admin_email, constants) {
  // constants
  const email_group = constants['unit_wide_email'];
  const today = new Date();
  
  // send reminder for people to put in away dates on 18th
  const today_date = today.getDate();
  if (today_date == 11){
    // send talk reminders
    send_email(email_group, "Please update your away dates", 
      "Hi friends,\n\n" + 
      "This is a reminder to update your away dates for next month and the month after before the 17th of this month. Tea talks for next month and research talks for the month after will be scheduled after the 17th.", constants, admin_email );
  }
}

// remind tea tsar to schedule talks
function scheduletalksreminder_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  const today = new Date();
  const today_date = today.getDate();
  if (today_date == 18){
    send_email(admin_email, "Reminder: Schedule Talks",
    "Please schedule tea talks for next month and research talks for the month after.", constants);
  }
}