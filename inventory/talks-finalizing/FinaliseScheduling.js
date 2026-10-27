// REMEMBER to set if_email_reminder=FALSE if you are just making minor changes!!!
//
// this confirms the scheduling by removing [Tentative] from the title, updating it to Google Calendar and send out emails to everyone
//
// If you want to highlight bank holidays / ucl closure, you may want to add additional events directly to Google Calendar
//

function finalise_tentative_talks_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  var if_email_reminder = true;
  try{
    finalise_tentative_talks(admin_email, if_email_reminder, constants);
  } catch (err) {
    send_email(admin_email, 'Error When Finalising Scheduling', 'Error message:\n\n' + err , constants);
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

  const gatsby_zoom_link = constants['gatsby_zoom_link'];
  const email_group = constants['unit_wide_email'];
  
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
      get talks with title [Tentative] from Notion, assuming that there is only one [Tentative] talk per day
  */ 
  var data = {
	  'filter': {
        'property': 'Title',
        'text': {
          'equals': '[Tentative]'
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

    var talk_type = talk['properties']['Type']['select']['name'];

    // no title by default
    var talk_title = '';

    var talk_start_time = new Date(talk['properties']['Date']['date']['start']);
    var talk_end_time = new Date(talk['properties']['Date']['date']['end']);    

    var presenter_ids = talk['properties']['Presenter']['relation'];
    var tea_people_ids = talk['properties']['Tea']['relation'];
    var presenter_names = get_names_from_ids(presenter_ids, people);
    var tea_people_names = get_names_from_ids(tea_people_ids, people);

    if (talk_type == 'Just Tea') { 
      var cal_title = talk_type.toUpperCase() + ": " + tea_people_names.join(", ");
    } else {
      var cal_title = talk_type.toUpperCase() + ": " + presenter_names.join(", ") + " TEA: " + tea_people_names.join(", ");
    }
    var cal_desc = "Title: " + talk_title + "\nZoom Link: " + gatsby_zoom_link;
    
    // add to Google Calendar
    var event = cal.createEvent(cal_title, talk_start_time, talk_end_time, {description: cal_desc});
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
    send_email(email_group, "Tea schedule updated", 
      "Hi friends,\n\n" + 
      "The tea talk schedule has been updated for the next month and the research talk schedule for the month after. You may view it on the Notion Page or through the gatsby.tea Google Calendar.\n\n", constants, admin_email );
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
    send_email(email, 'Notion API Failed When Finalising Scheduling', 'Notion does not seem to be responding. Please try again later or contact the tea tsar. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody , constants  );  
  }
  return results;
}
