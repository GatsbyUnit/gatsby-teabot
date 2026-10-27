// in case calendar ID is lost, specify start time and end time and retrieve events between them

function retrieve_calendar_id_wrapper(){
  var start_time = new Date("2023-09-25T13:30:00.000+01:00");
  var end_time = new Date("2023-09-25T14:30:00.000+01:00");
  retrieve_calendar_id(start_time, end_time);
}

function retrieve_calendar_id(start_time, end_time){
  const calendar_id = 'gatsby.tea@gmail.com';
  const cal = CalendarApp.getCalendarById(calendar_id);
  Logger.log(start_time);
  Logger.log(end_time);

  var events = cal.getEvents(start_time, end_time);
  for (var i=0; i<events.length; i=i+1 ){
    Logger.log(events[i].getId());
  }
}