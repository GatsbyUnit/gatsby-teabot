// This scripts sends zoom request to 1) presenter, tea person and seminar organizer for internal talks, and 2) the unit admin for external talks.

function onsubmit_wrapper(e){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    onsubmit(e, admin_email, constants);
  } catch (err) {
    mark_response_invalid(e);
    send_email(e['namedValues']['Email'][0], 'Error When Sending Zoom Request', 'Reply to this email to talk to the tea tsar if you think there is an issue. Error message:\n\n' + err, constants, admin_email );
    throw err;
  }
}

function onsubmit(e, admin_email, constants) {
  // constants
  var notion_site_url = constants['notion_site_url'];
  const notion_token = constants['notion_token'];
  const talk_db_id = constants['notion_talk_db_id'];
  const mapping_sheet_id = constants['identity_mapping_id'];
  const gatsby_zoom_link = constants['gatsby_zoom_link'];
  const gatsby_admin_email = constants['gatsby_admin_email'];

  /* 
    get form response
  */
  var items = e['namedValues'];
  var email = items['Email'][0];
  var date_string = items['Date of the Talk'][0];
  var talk_type = items['Talk type'][0];
  var reason = items['Reason'][0];
  
  var date = new Date(date_string);
  date_string = fmt_date(date);

  // validate email
  var notion_response = get_notion_id(email, mapping_sheet_id);
  if (typeof notion_response == 'string'){
    mark_response_invalid(e);
    send_email(email, 'Invalid Email When Sending Zoom Request', 'The following error occurs when looking up your email address in the Gatsby database:\n\n' + notion_response + '\n\nPlease reply to this email to contact the tea tsar to be added.' , constants, admin_email );
    Logger.log(notion_response);
    return;
  }
  var notion_url = notion_response[0];

  /* 
      get current talk from Notion, assuming that there is only one talk per day
  */
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
						'equals': talk_type
					}
	      }
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
  var talks = send_http_request_utt('https://api.notion.com/v1/databases/' + talk_db_id + '/query', data, params, email, e, constants);
  if (talks === false) { return; }

  // validate talk data
  if (talks.length == 0){
    mark_response_invalid(e);
    send_email(email, 'Talk Not Found', 'No talk is found on ' + date_string + ' when attempting to send Zoom request.\nPlease make sure you have entered the correct date, or contact the tea tsar if you believe there is an error.', constants, admin_email  );
    Logger.log('No talk is found on ' + date_string);
    return;
  }
  if (talks.length > 1){
    mark_response_invalid(e);
    send_email(admin_email, 'URGENT: More Than 1 Talks Found', 'More than 1 talks are found on ' + date_string + ' when attempting to update talk title.' , constants  );
    send_email(email, 'More Than 1 Talks Found', 'More than 1 talks are found on ' + date_string + ' when attempting to send Zoom request. That is too good to be true. The tea tsar will address this shortly.', constants , admin_email  );
    Logger.log('More than 1 talks are found on ' + date_string);
    return;
  }

  var talk = talks[0];
  
  if (talk_type == "External Seminar"){
    send_email(gatsby_admin_email, 'Zoom Request for External Seminar on ' + date_string, 
    'A request has been received for enabling Zoom for the external seminar on ' + date_string + ':\n\n'
    +
    '============\n\n'
    +
    'Email: ' + email + '\n'
    +
    'Notion profile: ' + notion_url + '\n'
    +
    'Reason: ' + reason + '\n\n'
    +
    '============\n\n'
    +  
    'Please help to set up Zoom on the day of the talk. You may reply to this email ', constants , email  );
  }

  // validate presenter
  var presenters = talk['properties']['Presenter']['relation'];
  if ( presenters.length == 0 ){
    mark_response_invalid(e);
    send_email(email, 'No Presenter Found for Talk', 'No presenters are found for the talk on ' + date_string + ' when attempting to update talk title. Please make sure you have entered the correct date, or contact the tea tsar if you believe there is an error.', constants , admin_email  );
    Logger.log('No presenters are found for the talk on ' + date_string);
    return;
  }
  var presenter_found = false;
  for (var i=0; i<presenters.length; i=i+1){
    var current_id = remove_hyphen_from_id(presenters[i]['id']);
    if (current_id == presenter_id){
      presenter_found = true;
      break;
    }
  }
  if ( presenter_found === false ){
    mark_response_invalid(e);
    send_email(email, "Do Not Change Others' Talk Content :/", "We don't think you are the presenter for the talk on " + date_string + '. Please make sure you have entered the correct date, or contact the tea tsar if you believe there is an error.' , constants, admin_email  );
    Logger.log('Email ' + email + ' attempts to change talk title on ' + date_string);
    return;
  }

  // validate that the talk is not tentative  
  var tmp = talk['properties']['Title']['title'];
  if (tmp.length > 0){
    if (tmp[0]['text']['content'] == "[Tentative]"){
      mark_response_invalid(e);
      send_email(email, "Attempt to update a tentative talk's title", 'The talk on ' + date_string + ' was tentatively generated by the scheduling algorithm and has not been confirmed yet. Please come back to it later to edit the talk title.', constants, admin_email   );
      Logger.log('Attempted to edit a tentative talk on ' + date_string);
      return;
    }
  }

  // validate Google Calendar Event ID
  var tmp = talk['properties']['GCal ID']['rich_text'];
  if (tmp.length > 0){
    var gcal_eid = tmp[0]['text']['content'];
    var gcal_event = gcal.getEventById(gcal_eid);
    if (gcal_event === null){
      mark_response_invalid(e);
      send_email(email, "Invalid GCal ID for the talk", 'Invalid GCal ID [' + gcal_eid + '] found on Notion for the talk on ' + date_string + ' when trying to update talk title. The tea tsar is looking into this.', constants , admin_email  );
      send_email(admin_email, "Invalid GCal ID for the talk", 'Invalid GCal ID [' + gcal_eid + '] found on Notion for the talk on ' + date_string + ' when trying to update talk title.', constants  );
      Logger.log('Invalid GCal ID [' + gcal_eid + '] detected for the talk on ' + date_string );
      return;
    }
  } else {
    mark_response_invalid(e);
    send_email(email, "No GCal ID detected for the talk", 'No GCal ID found on Notion for the talk on ' + date_string + ' when trying to update talk title. The tea tsar is looking into this.' , constants , admin_email );
    send_email(admin_email, "No GCal ID detected for the talk", 'No GCal ID found on Notion for the talk on ' + date_string + ' when trying to update talk title.', constants );
    Logger.log('No GCal ID detected for the talk on ' + date_string  );
    return;
  }

  /*
    update title
  */
  var prop = {};  
  if ( update_title == true ){
    prop['Title'] = { 'title': [{ 'text': { 'content': talk_title } }] };
  }
  if ( update_desc == true ){
    prop['Description'] = { 'rich_text': [{ 'text': { 'content': talk_desc } }] };
  }
  var data = {
    'properties': prop
  };
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'patch'
  };
  var results = send_http_request_utt('https://api.notion.com/v1/pages/' + talk_id, data, params, email, e, constants);
  if (results === false) { return; }  
  
  /*
    update gcal
  */
  gcal_event.setDescription("Title: " + talk_title + "\nZoom Link: " + gatsby_zoom_link + "\nDescription: " + talk_desc);

  /*
    email notification
  */
  send_email(email, 'Talk Title Update Success', 'The title of your talk on ' + date_string + ' has been updated successfully. Check it out now at ' + notion_site_url + remove_hyphen_from_id(talk_id) , constants, admin_email  );
}



function send_http_request_utt(url, data, params, email, e, constants){
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
      next_results = send_http_request_utt(url, data, params, email, e, constants);
      results = results.concat(next_results); 
    }
  } else {
    mark_response_invalid(e);
    send_email(email, 'Notion API Failed When Updating Talk Title', 'Notion does not seem to be responding. Please try again later or reply to this email to contact the tea tsar. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody, constants, admin_email  );
   }
  return results;
}


function mark_response_invalid(e){
  const response_sheet_id = '1XeSjwN9z9WnkW4_4E8Cocbr-bmGHIMwEPfKshbxKOCw';
  
  var row = e['range']['rowEnd'];
  var col_end = e['range']['columnEnd'];

  var response_sheet = SpreadsheetApp.openById(response_sheet_id).getSheets()[0];
  response_sheet.getRange(row, col_end + 1).setValue('invalid');
}

