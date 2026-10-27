// remind duty people of the talk next week
function nextnextweektalkreminder_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    nextnextweektalkreminder(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Sending Talk Reminders', 'Error message:\n\n' + err, constants );
    throw err;
  }
}

function nextnextweektalkreminder(admin_email, constants){
  var today_next_next_week = new Date();
  today_next_next_week.setDate(today_next_next_week.getDate()+14);
  var email_option = "duty_people";
  var talk_name = "the week after next";
  talkreminder(admin_email, today_next_next_week, email_option, talk_name, constants);
}
