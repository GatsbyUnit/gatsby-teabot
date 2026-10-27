// REMEMBER to set if_email_reminder=FALSE if you are just making minor changes!!!
//
// this confirms the scheduling by removing [Tentative] from the title, updating it to Google Calendar and send out emails to everyone
//
// If you want to highlight bank holidays / ucl closure, you may want to add additional events directly to Google Calendar
//

function finalise_tentative_talks_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants["coffee_admin_email"];
  var if_email_reminder = true;
  try{
    finalise_tentative_talks(admin_email, if_email_reminder, constants);
  } catch (err) {
    send_email(admin_email, 'Error When Finalising Scheduling', 'Error message:\n\n' + err, constants);
    throw err;
  }
}

function finalise_tentative_talks(admin_email, if_email_reminder, constants){
  // const
  const notion_token = constants['notion_token'];
  const talk_db_id = constants['notion_talk_db_id'];
  const people_db_id = constants['notion_people_db_id'];
  const calendar_id = constants['google_calendar_id'];
  const cal = CalendarApp.getCalendarById(calendar_id);
  const email_coffee = constants['coffee_email'];
  
  /* 
      get list of active people from Notion, including those excluded from schedule
  */
  var data = {
	  'filter': {
	    'and': [
	      {
	        'property': 'Active',
					'checkbox': {
						'equals': true
					}
	      },
			]
		}
	};
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var people = send_http_request_fs('https://api.notion.com/v1/databases/' + people_db_id + '/query', data, params, admin_email, constants);
  if (people === false) { return; }

  // check people data
  if (people.length == 0){
    send_email(admin_email, 'Urgent: no people found', 'No active people found in the database.', constants)
    Logger.log('No active people');
    return;
  }
  /* 
      get talks with title [Coffee Cleaning Tentative] from Notion, assuming that there is only one [Coffee Cleaning Tentative] talk per day
  */ 
  var data = {
	  'filter': {
        'property': 'Title',
        'text': {
          'equals': '[Coffee Cleaning Tentative]'
        }
		}
	};
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var talks = send_http_request_fs('https://api.notion.com/v1/databases/' + talk_db_id + '/query', data, params, admin_email, constants);
  if (talks === false) { return; }

  
  for (var i=0; i< talks.length; i=i+1){
    var talk = talks[i];
    var talk_id = talk['id'];
    var talk_description_text = talk['properties']['Description']['rich_text'];
    var talk_description = "";
    if (talk_description_text.length > 0){
      for (var t=0; t<talk_description_text.length; t=t+1 ){
        talk_description += talk_description_text[t]['plain_text'] + "\n";
      }
    }
    /* get the date without time component; also only put one event on Monday about this */
    var proxy = new Date(talk['properties']['Date']['date']['start']);
    var talk_start_time = new Date(proxy.toDateString());
    proxy.setDate(proxy.getDate()+1);
    var talk_end_time = new Date(proxy.toDateString());

    var tea_ids = talk['properties']['Tea']['relation'];
    var tea_names = get_names_from_ids(tea_ids, people);

    var cal_title = "Coffee Duty This Week: " + tea_names.join(", ");
    var cal_desc = "Duty Description:\n\n" + talk_description;
    
    // add to Google Calendar
    var event = cal.createAllDayEvent(cal_title, talk_start_time, talk_end_time, {description: cal_desc});
    var eventid = event.getId();

    // update Notion
    /*
      update title
    */
    var data = {
      'properties': {
        'Title': { 'title': [{ 'text': { 'content': '' } }] },  // remove [Tentative]
        'GCal ID': { 'rich_text': [{ 'text': { 'content': eventid } }] }
      }
    };
    var params = {
      'headers':{
        'Authorization': 'Bearer ' + notion_token + '',
        'Content-Type' : 'application/json',
        'Notion-Version': '2021-08-16'
      },
      'method' : 'patch'
    };
    var response = send_http_request_fs('https://api.notion.com/v1/pages/' + talk_id, data, params, admin_email, constants);
    if (response === false) { return; }  
  }

  // email everyone to confirm
  if (if_email_reminder === true){
    send_email(email_coffee, "Coffee cleaning rota updated", 
      "Hi friends,\n\n" + 
      "The coffee cleaning rota has been updated. You may view it on the Notion Page or through the gatsby.tea Google Calendar.\n\n", constants, admin_email );
  }
}



function send_http_request_fs(url, data, params, email, constants){
  params['muteHttpExceptions'] = true;
  params['payload'] = JSON.stringify(data);

  var response = UrlFetchApp.fetch(url, params);

  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();

  Logger.log(responseCode);
  Logger.log(responseBody);

  var results = false;
  if (responseCode == 200){
    responseJson = JSON.parse(responseBody);
    results = responseJson['results'];
    if (responseJson['has_more'] === true){
      data['start_cursor'] = responseJson['next_cursor'];
      params['payload'] = JSON.stringify(data);
      next_results = send_http_request_fs(url, data, params, email, constants);
      results = results.concat(next_results); 
    }
  } else {   
    send_email(email, 'Notion API Failed When Finalising Scheduling', 'Notion does not seem to be responding. Please try again later or contact the tea tsar. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody, constants  );  
  }
  return results;
}
