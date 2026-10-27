// reminder for coffee duties throughout the week (based on data on the Monday of that week)
function coffeereminder_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    coffeereminder(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Sending Talk Reminders', 'Error message:\n\n' + err, constants );
    throw err;
  }
}

function coffeereminder(admin_email, constants){  
  var prevMonday = new Date();
  prevMonday.setDate(prevMonday.getDate() - (prevMonday.getDay() + 6) % 7);
  var email_option = "coffee_people";
  var talk_name = "today";
  talkreminder(admin_email, prevMonday, email_option, talk_name, constants);
}