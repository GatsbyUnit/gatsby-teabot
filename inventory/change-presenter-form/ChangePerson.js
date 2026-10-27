// This scripts allows changing of a talk's presenter / tea person. The only case where someone may update another person's talk's title is when admins update the titles direclty in Notion.

function onsubmit_wrapper(e){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    onsubmit(e, admin_email, constants);
  } catch (err) {
    mark_response_invalid(e);
    var items = e['namedValues'];
    var original_email = items['Email for the original slot owner'][0];
    var new_email = items['Email for the new slot owner'][0];
    send_email(  original_email + ',' + new_email,  'Error When Changing Presenter / Tea Person', 'Reply to this email to talk to the tea tsar if you think there is an issue. Error message:\n\n' + err, constants, admin_email );
    throw err;
  }
}


function onsubmit(e, admin_email, constants) {
  // constants

  var notion_site_url = constants['notion_site_url'];
  const notion_token = constants['notion_token'];
  const talk_db_id = constants['notion_talk_db_id'];
  const people_db_id = constants['notion_people_db_id'];
  const mapping_sheet_id = constants['identity_mapping_id'];
  const calendar_id = constants['google_calendar_id'];

  /* 
    get form response
  */
  var items = e['namedValues'];
  var original_email = items['Email for the original slot owner'][0];
  var new_email = items['Email for the new slot owner'][0];
  var date_string = items['Date of the slot'][0];
  var duty_type = items['Duty type'][0];
  var slot_type = items['Slot type'][0];
  var emails = original_email + ',' + new_email;
  
  var date = new Date(date_string);
  date_string = fmt_date(date);

  // set up calendar
  var gcal = null;
  try {
    gcal = CalendarApp.getCalendarById(calendar_id);
  } catch (err) {
    mark_response_invalid(e);
    send_email(admin_email,  'URGENT: Google Calendar Failure When Changing Talk Presenter / Tea Person', 'Google Calendar integration failed due to calendar ID not found. Error message:\n\n' + err, constants );
    send_email(emails, 'Google Calendar Failure When Changing Talk Presenter / Tea Person', 'Google Calendar integration failed. The tea tsar is looking into this. Error message:\n\n' + err, constants, admin_email );
    Logger.log("GCal integration failed. Calendar ID not found.")
    return;
  }

  // validate email
  var original_response = get_notion_id(original_email, mapping_sheet_id);
  if (typeof original_response == 'string'){
    mark_response_invalid(e);
    send_email(emails, 'Invalid Email When Changing Presenter / Tea Person', 'The following error occurs when looking up the email address ' + original_email + ' in the Gatsby database:\n\n' + original_response + '\n\nPlease reply to this email to contact the tea tsar to be added.', constants, admin_email );
    Logger.log(original_response);
    return;
  }
  var original_id = original_response[0];

  var new_response = get_notion_id(new_email, mapping_sheet_id);
  if (typeof new_response == 'string'){
    mark_response_invalid(e);
    send_email(emails, 'Invalid Email When Changing Presenter / Tea Person', 'The following error occurs when looking up the email address ' + new_email + ' in the Gatsby database:\n\n' + new_response + '\n\nPlease contact the tea tsar to be added.', constants, admin_email );
    Logger.log(new_response);
    return;
  }
  var new_id = new_response[0];

  // check duty type
  var present_duty = true;
  var duty_small = "presenter";
  var duty_caps = "Presenter";
  if ( duty_type != "Presenter"){
    present_duty = false;
    duty_small = "tea / coffee person";
    duty_caps = "Tea / Coffee person";
  }

 
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
  var people = send_http_request_cp('https://api.notion.com/v1/databases/' + people_db_id + '/query', data, params, emails, e, duty_caps, constants);
  if (people === false) { return; }


  // check people data
  if (people.length == 0){
    send_email(admin_email, 'Urgent: no people found', 'No active people found in the database.', constants, admin_email)
    Logger.log('No active people');
    return;
  }

  /* 
      get current talk people from Notion, assuming that there is only one talk of the same type per day
  */
  if (slot_type == 'Coffee Cleaning'){
    /* for coffee cleaning, look at an entire week */
    var prevMonday = new Date(date.getTime());
    prevMonday.setDate(prevMonday.getDate() - (prevMonday.getDay() + 6) % 7);
    var end_of_week = new Date(date.getTime());
    end_of_week.setDate(end_of_week.getDate()+5);
    var data = {
        'filter': {
          'and': [
            {
              'property': 'Date',
              'date': {
                'on_or_after': fmt_date_for_notion(prevMonday),
              }
            },
            {
              'property': 'Date',
              'date': {
                'on_or_before': fmt_date_for_notion(end_of_week),
              }
            },
            {
              'property': 'Type',
              'select': {
                'equals': slot_type
              }
            }
          ]
        }
      };
  } else {
    var data = {
      'filter': {
        'and': [
          {
            'property': 'Date',
            'date': {
              'equals': fmt_date_for_notion(date)
            }
          },
          {
            'property': 'Type',
            'select': {
              'equals': slot_type
            }
          }
        ]
      }
    };
  }
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var talks = send_http_request_cp('https://api.notion.com/v1/databases/' + talk_db_id + '/query', data, params, emails, e, duty_caps, constants);
  if (talks === false) { return; }

  // validate talk data

  if (talks.length == 0){
    mark_response_invalid(e);
    send_email(emails, 'Talk Not Found', 'No talk is found on ' + date_string + ' when attempting to update talk title.\nPlease make sure you have entered the correct date, or contact the tea tsar if you believe there is an error.' , constants, admin_email);
    Logger.log('No talk is found on ' + date_string);
    return;
  }
  if (talks.length > 1){
    mark_response_invalid(e);
    send_email(admin_email, 'URGENT: More Than 1 Talks Found', 'More than 1 talks are found on ' + date_string + ' when attempting to update talk title.' , constants);
    send_email(emails, 'More Than 1 Talks Found', 'More than 1 talks are found on ' + date_string + ' when attempting to update talk title. That is too good to be true. The tea tsar will address this shortly.', constants, admin_email );
    Logger.log('More than 1 talks are found on ' + date_string);
    return;
  }

  // verify that the talk is not tentative
  var talk = talks[0];
  var talk_id = talk['id'];
  var tmp = talk['properties']['Title']['title'];
  if (tmp.length > 0){
    notion_site_url = notion_site_url + tmp[0]['text']['content'].replace(/ /g, '-') + '-';
    if (tmp[0]['text']['content'] == "[Tentative]" || tmp[0]['text']['content'] == "[MLJC Tentative]" || tmp[0]['text']['content'] == "[TNJC Tentative]" || tmp[0]['text']['content'] == "[Coffee Tentative]" ){
      mark_response_invalid(e);
      send_email(emails, 'Attempt to change a tentative talk', 'The talk on ' + date_string + ' was tentatively generated by the scheduling algorithm and has not been confirmed yet. Please come back to it later to change the presenter / tea person.', constants, admin_email );
      Logger.log('Attempted to change a tentative talk on ' + date_string);
      return;
    }
  }

  // obtain the ids of presenters and tea people. No verification needed as there may be 0 presenters or 0 tea people
  var presenters = talk['properties']['Presenter']['relation'];
  var tea_people = talk['properties']['Tea']['relation'];   

  var presenter_ids = [];
  for (var i=0; i< presenters.length; i=i+1 ){
    presenter_ids.push({"id": presenters[i]['id']});
  }

  var tea_people_ids = [];
  for (var i=0; i< tea_people.length; i=i+1 ){
    tea_people_ids.push({"id": tea_people[i]["id"]});
  }

  // check whether original id belongs to presenters / tea people
  var found = false;

  if (present_duty){
    var new_presenter_ids = [];
    for (var i=0;i<presenter_ids.length; i=i+1){
      Logger.log(remove_hyphen_from_id(presenter_ids[i]["id"]));
      Logger.log(original_id);
      if (remove_hyphen_from_id(presenter_ids[i]["id"]) == original_id){
        found = true;
        new_presenter_ids.push({"id": add_hyphen_to_id(new_id)});
      } else {
        new_presenter_ids.push({"id": presenter_ids[i]["id"]});
      }
    }
    presenter_ids = new_presenter_ids;
  } else {
    var new_tea_people_ids = [];
    for (var i=0;i<tea_people_ids.length; i=i+1){
      if (remove_hyphen_from_id(tea_people_ids[i]["id"]) == original_id){
        found = true;
        new_tea_people_ids.push({"id": add_hyphen_to_id(new_id)});
      } else {
        new_tea_people_ids.push({"id": tea_people_ids[i]["id"]});
      }
    }
    tea_people_ids = new_tea_people_ids;
  }

  if ( found === false ){
    mark_response_invalid(e);
    send_email(emails, "Do not change others' slots :/", "We don't think [" + original_email + "] is the " + duty_small + " for the talk on " + date_string + '.  Please make sure you have entered the correct date / email, or contact the tea tsar if you believe there is an error.' , constants, admin_email);
    Logger.log('Original email [' + original_email + '], new email [' + new_email + ']. Attempt to change ' + duty_small + ' on ' + date_string);
    return;
  }

  // get names
  var presenter_names = get_names_from_ids(presenter_ids, people);
  var tea_people_names = get_names_from_ids(tea_people_ids, people);

  // validate Google Calendar Event ID
  var tmp = talk['properties']['GCal ID']['rich_text'];
  var gcal_event = null;
  if (tmp.length > 0){
    var gcal_eid = tmp[0]['text']['content'];
    gcal_event = gcal.getEventById(gcal_eid);
    if (gcal_event === null){
      mark_response_invalid(e);
      send_email(email, "Invalid GCal ID for the talk", 'Invalid GCal ID [' + gcal_eid + '] found on Notion for the talk on ' + date_string + ' when trying to change talk presenter / tea person. The tea tsar is looking into this.', constants, admin_email );
      send_email(admin_email, "Invalid GCal ID for the talk", 'Invalid GCal ID [' + gcal_eid + '] found on Notion for the talk on ' + date_string + ' when trying to update talk title.', constants );
      Logger.log('Invalid GCal ID [' + gcal_eid + '] detected for the talk on ' + date_string);
      return;
    }
  } else {
    mark_response_invalid(e);
    send_email(admin_email, "Urgent: No GCal ID detected for the talk", 'No GCal ID found on Notion for the talk on ' + date_string + ' when trying to change talk presenter / tea person. The tea tsar is looking into this.' , constants);
    send_email(admin_email, "No GCal ID detected for the talk", 'No GCal ID found on Notion for the talk on ' + date_string + ' when trying to change talk presenter / tea person.', constants );
    Logger.log('No GCal ID detected for the talk on ' + date_string);
    return;
  }


  /*
    update person
  */
  if ( present_duty ){
    var data = {
      'properties': {
        'Presenter': { 'relation': presenter_ids }
      }
    };
  } else {
    var data = {
      'properties': {
        'Tea': { 'relation': tea_people_ids }
      }
    };  
  }
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'patch'
  };
  var results = send_http_request_cp('https://api.notion.com/v1/pages/' + talk_id, data, params, emails, e, duty_caps, constants);
  if (results === false) { return; }
  
  /*
    update gcal
  */
  var talk_type = talk['properties']['Type']['select']['name'];
  var talk_title =  talk_type.toUpperCase();
  if (talk_type == 'Research Talk' || talk_type == 'Tea Talk'){
    talk_title += ": " + presenter_names.join(", ") + " TEA: " + tea_people_names.join(", ");
  } 
  else if ( talk_type == 'Just Tea' || talk_type == 'External Seminar' || talk_type == 'Leaving Tea' ) {
    talk_title += ". TEA: " + tea_people_names.join(", ");
  }
  else if (talk_type == 'MLJC' || talk_type == 'TNJC') {
    talk_title += ": " + presenter_names.join(", ");
  } 
  else if (talk_type == 'Coffee Cleaning') {
    talk_title = "Coffee Duty This Week: " + tea_people_names.join(", ");
  }
  gcal_event.setTitle( talk_title );
  
  /*
    email notification
  */
  if ( present_duty === true){
    send_email(emails, 'Change ' + duty_caps + ' Success', duty_caps + ' for the talk on ' + date_string + ' has been updated successfully. Check it out now at ' + notion_site_url + remove_hyphen_from_id(talk_id), constants, admin_email);
  } else {
    send_email(emails, 'Change ' + duty_caps + ' Success', duty_caps + ' for the talk on ' + date_string + ' has been updated successfully. Check it out now at ' + notion_site_url + remove_hyphen_from_id(talk_id), constants, admin_email);
  }
}


function send_http_request_cp(url, data, params, email, e, duty_caps, constants){
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
      next_results = send_http_request_cp(url, data, params, email, e, duty_caps, constants);
      results = results.concat(next_results); 
    }
  } else {
    mark_response_invalid(e);
    send_email(email, 'Notion API Failed When Changing ' + duty_caps, 'Notion does not seem to be responding. Please try again later or contact the tea tsar. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody  , constants, admin_email);
   }
  return results;
}


function mark_response_invalid(e){
  const response_sheet_id = '1AwdUBzdb5aDjs6koyd3seyRuQaaxDZmbpu1Yc5mvgno';
  
  var row = e['range']['rowEnd'];
  var col_end = e['range']['columnEnd'];

  var response_sheet = SpreadsheetApp.openById(response_sheet_id).getSheets()[0];
  response_sheet.getRange(row, col_end + 1).setValue('invalid');
}

