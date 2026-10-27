// remind everyone of the talk on that day
function todaytalkreminder_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    todaytalkreminder(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Sending Talk Reminders', 'Error message:\n\n' + err, constants );
    throw err;
  }
}

function todaytalkreminder(admin_email, constants){
  var today = new Date();
  var email_option = "duty_people";  // originally "group" (reminder of the talk today was sent to everyone)
  var talk_name = "today";
  talkreminder(admin_email, today, email_option, talk_name, constants);
}