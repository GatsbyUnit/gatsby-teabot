function talkreminder(admin_email, talk_date, email_option, talk_date_name, constants) {
  // email_option has to be "duty_people" or "group"
  if (email_option !== "group" && email_option !== "duty_people" && email_option !== "coffee_people"){
    send_email(admin_email, 'Urgent: bug in talk reminder script', 'email_option is invalid; need to be "duty_people" or "group".', constants)
    Logger.log('email_option is invalid');
    return;
  }
  // constants

  const notion_token = constants['notion_token'];
  const talk_db_id = constants['notion_talk_db_id'];
  const people_db_id = constants['notion_people_db_id'];
  const mapping_sheet_id = constants['identity_mapping_id'];
  const gatsby_zoom_link = constants['gatsby_zoom_link'];
  
  const email_group = constants['unit_wide_email'];
  const email_MLJC = constants['mljc_email'];
  const email_TNJC = constants['tnjc_email'];
  const email_CSNJC = constants['csnjc_email'];

  const admin_email_MLJC = constants['mljc_admin_email'];
  const admin_email_TNJC = constants['tnjc_admin_email'];
  const admin_email_coffee = constants['coffee_admin_email'];

  const talk_date_string = fmt_date(talk_date);
  
  var end_of_week = new Date(talk_date.getTime());
  end_of_week.setDate(end_of_week.getDate()+5);
  
  if (email_option !== 'coffee_people'){ // coffee has a special way of filtering because coffee duties on Notion are displayed for a week
    /* 
          get recent talks for people from Notion
      */
      var data = {
        'filter': {
          'or': [
            {
              'property': 'Date',
              'date': {
                'equals': fmt_date_for_notion(talk_date)
              }
            },
          ]
        }
      };

      // if sending group reminder and today is Monday, add CSNJC check 
      if (email_option == 'group' && talk_date.getDay() == 1){
        data['filter']['or'].push(
            {
              'and': [
                {
                  'property': 'Date',
                  'date': {
                    'on_or_after': fmt_date_for_notion(talk_date),
                  }
                },
                {
                  'property': 'Date',
                  'date': {
                    'on_or_before': fmt_date_for_notion(end_of_week),
                  }
                },
                {
                  'property': 'CSNJC',    
                  'checkbox': {
                    "equals": true
                  }
                }
              ]
            }
          );
      }
  } else { // coffee duty is scheduled for the entire week, so this picks up the one duty that spans Monday to Friday
      var data = {
        'filter': {
          'and': [
            {
              'property': 'Date',
              'date': {
                'on_or_after': fmt_date_for_notion(talk_date),
              }
            },
            {
              'property': 'Date',
              'date': {
                'on_or_before': fmt_date_for_notion(end_of_week),
              }
            },
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
  var talks = send_http_request_tr('https://api.notion.com/v1/databases/' + talk_db_id + '/query', data, params, admin_email, constants);
  if (talks === false) { return; }

  // check talk data
  if (talks.length == 0){
    Logger.log('No talk is found on ' + talk_date_string);
    return;
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
  var people = send_http_request_tr('https://api.notion.com/v1/databases/' + people_db_id + '/query', data, params, admin_email, constants);
  if (people === false) { return; }

  // check people data        
  if (people.length == 0){
    send_email(admin_email, 'Urgent: no people found', 'No active people found in the database.', constants)
    Logger.log('No active people');
    return;
  }
  
  /*
    loop through talks
  */
  for (var r=0; r< talks.length; r=r+1){
    var relevant_talk = talks[r];
    var talk_type_content = relevant_talk['properties']['Type']['select'];
    if (talk_type_content !== null ){
      var talk_type = talk_type_content['name'];
    } else {
      send_email(admin_email, 'Skipped a talk reminder for ' + talk_date_string, 'Skipped a talk reminder for ' + talk_date_string + ' as the type of talk is not specified', constants );
      continue;
    }
    var talk_title_text = relevant_talk['properties']['Title']['title'];
    var talk_title = "";
    if (talk_title_text.length > 0){
      for (var t=0; t<talk_title_text.length; t=t+1 ){
        talk_title += talk_title_text[t]['plain_text'];
      }
    }
    var talk_description_text = relevant_talk['properties']['Description']['rich_text'];
    var talk_description = "";
    if (talk_description_text.length > 0){
      for (var t=0; t<talk_description_text.length; t=t+1 ){
        talk_description += talk_description_text[t]['plain_text'] + "\n";
      }
    }
    var talk_if_CSNJC = relevant_talk['properties']['CSNJC']['checkbox'];
    var talk_actual_date = relevant_talk['properties']['Date']['date']['start'].slice(0,10);

    console.log(relevant_talk['properties']['Date']['date']['start']);
    var talk_start_time = fmt_time_simple(new Date(relevant_talk['properties']['Date']['date']['start']));
    var talk_end_time = fmt_time_simple(new Date(relevant_talk['properties']['Date']['date']['end']));
    var talk_start_date = fmt_date(new Date(relevant_talk['properties']['Date']['date']['start']));
    var talk_end_date = fmt_date(new Date(relevant_talk['properties']['Date']['date']['end']));

    var presenter_ids = relevant_talk['properties']['Presenter']['relation'];
    var tea_people_ids = relevant_talk['properties']['Tea']['relation'];
    var presenter_names = get_names_from_ids(presenter_ids, people);
    var tea_people_names = get_names_from_ids(tea_people_ids, people);
    if ( presenter_names.length > 0 ){
      var presenter_title_text = " by " + presenter_names.join(", ");
    } else {
      var presenter_title_text = "";
    }

    // send group reminders about the talk

    if (email_option == 'group'){
      if (talk_type == 'Research Talk' || talk_type == 'Tea Talk' || talk_type == 'Just Tea' || talk_type == 'External Seminar' || talk_type == 'Leaving Tea' ) {
        // send reminder to everyone about the talk
        send_email(email_group, talk_date_name.toUpperCase() + " " + talk_start_time + ", " + talk_type + presenter_title_text, 
          "Hi friends,\n\n" + 
          "This is a reminder for the talk / tea " + talk_date_name + ". \n\n=============\n\n" +
          "Title: " + talk_title + "\n" +
          "Type: " + talk_type + "\n" +
          "Time: " + talk_start_time + " - " + talk_end_time + "\n" +
          "Presenter: " + presenter_names.join(", ") + "\n" +
          "Tea: " + tea_people_names.join(", ") + "\n" +
          "Zoom Link: " + gatsby_zoom_link + "\n\n" +
          "Description: " + talk_description + "\n=============\n\n" , constants, admin_email);
      } else if (talk_type == 'MLJC' ) {
        // send reminder for MLJC
        send_email(email_MLJC, talk_date_name.toUpperCase() + " " + talk_start_time + ", " + talk_type + presenter_title_text, 
          "Hi friends,\n\n" + 
          "This is a reminder for the MLJC " + talk_date_name + ". \n\n=============\n\n" +
          "Title: " + talk_title + "\n" +
          "Type: " + talk_type + "\n" +
          "Time: " + talk_start_time + " - " + talk_end_time + "\n" +
          "Presenter: " + presenter_names.join(", ") + "\n" +
          "Zoom Link: " + gatsby_zoom_link + "\n\n" +
          "Description: " + talk_description + "\n=============\n\n" , constants, admin_email_MLJC);
      } else if (talk_type == 'TNJC' ) {
        // send reminder for TNJC
        if (talk_if_CSNJC === true){ var talk_type_name = 'TNJC (CSNJC)'; } else { var talk_type_name = 'TNJC'; }
        // send reminder for TNJC only on the day itself
        if (fmt_date_for_notion(talk_date) == talk_actual_date){
          send_email(email_TNJC, talk_date_name.toUpperCase() + " " + talk_start_time + ", " + talk_type + presenter_title_text, 
            "Hi friends,\n\n" + 
            "This is a reminder for the " + talk_type_name + " " + talk_date_name + ". \n\n=============\n\n" +
            "Title: " + talk_title + "\n" +
            "Type: " + talk_type + "\n" +
            "Time: " + talk_start_time + " - " + talk_end_time + "\n" +
            "Presenter: " + presenter_names.join(", ") + "\n" +
            "Zoom Link: " + gatsby_zoom_link + "\n\n" +
            "Description: " + talk_description + "\n=============\n\n" , constants, admin_email_TNJC);
        }
        // send additional reminder for CSNJC in advance, don't care whether it is hapeening today
        if (talk_if_CSNJC === true){
          send_email(email_CSNJC, talk_date_string + " " + talk_start_time + ", Gatsby " + talk_type + presenter_title_text, 
            "Hi friends,\n\n" + 
            "This is a reminder for the " + talk_type_name + " on " + talk_actual_date + ". \n\n=============\n\n" +
            "Title: " + talk_title + "\n" +
            "Type: " + talk_type + "\n" +
            "Time: " + talk_start_time + " - " + talk_end_time + "\n" +
            "Presenter: " + presenter_names.join(", ") + "\n" +
            "Zoom Link: " + gatsby_zoom_link + "\n\n" +
            "Description: " + talk_description + "\n=============\n\n", constants, admin_email_TNJC);
        }
      }
    }
  
    // reminder people with duty about the talk
    if (email_option == 'group' || email_option == 'duty_people'){
      // send emails to tea people, if any
      email_list = [];
      for (var i=0; i<tea_people_ids.length; i=i+1){
        var email_response = get_email_from_notion_id(tea_people_ids[i]['id'], mapping_sheet_id);
        if (typeof email_response == "string"){
          send_email(admin_email, 'Invalid Email When Sending Talk Reminders for ' + talk_date_string, email_response, constants );
          Logger.log(email_response); // skip this email
        } else {
          email_list.push(email_response[0]);
        }
      }  

      if  (email_list.length > 0){
        if (talk_type !== 'Coffee Cleaning' ) {
          send_email(email_list.join(","), "REMINDER " + talk_type + " Tea Duty on " + talk_date_string, 
            "Hi,\n\n" + 
            "This is a reminder for your tea duty " + talk_date_name + ". \n\n=============\n\n" +
            "Title: " + talk_title + "\n" +
            "Type: " + talk_type + "\n" +
            "Time: " + talk_start_time + " - " + talk_end_time + ", " + talk_date_string + "\n" +
            "Presenter: " + presenter_names.join(", ") + "\n" +
            "Tea: " + tea_people_names.join(", ") + "\n" +
            "Zoom Link: " + gatsby_zoom_link + "\n=============\n\n" + tea_page_line(email_list), constants, admin_email );
        } 
      }

      // send emails to presenters 
      if (talk_type == 'Research Talk' || talk_type == 'Tea Talk'  || talk_type == 'MLJC' || talk_type == 'TNJC') {
        var replyto_email = admin_email; /* default reply to tea tsar */
        if ( talk_type == 'MLJC' ){
          replyto_email = admin_email_MLJC;
        } else if ( talk_type == 'TNJC' ){
          replyto_email = admin_email_TNJC;
        }

        var email_list = [];
        for (var i=0; i<presenter_ids.length; i=i+1){
          var email_response = get_email_from_notion_id(presenter_ids[i]['id'], mapping_sheet_id);
          if (typeof email_response == "string"){
            send_email(admin_email, 'Invalid Email When Sending Talk Reminders for ' + talk_date_string, email_response , constants);
            Logger.log(email_response); // skip this email
          } else {
            email_list.push(email_response[0]);
          }
        }
        if  (email_list.length > 0){
          send_email(email_list.join(","), "REMINDER " + talk_type + " Presentation on " + talk_date_string, 
            "Hi,\n\n" + 
            "This is a reminder for your talk " + talk_date_name + ". \n\n=============\n\n" +
            "Title: " + talk_title + "\n" +
            "Type: " + talk_type + "\n" +
            "Time: " + talk_start_time + " - " + talk_end_time + ", " + talk_date_string + "\n" +
            "Presenter: " + presenter_names.join(", ") + "\n" +
            "Zoom Link: " + gatsby_zoom_link + "\n" +
            "Description: " + talk_description + "\n=============\n\n" +
            "⏰ Research talks start at 3pm and should be kept to 50 minutes including audience questions \n ⏱️ Tea talks start at 3:30pm and should be kept to 15 minutes including audience questions \n\n" +
            "Please update your talk title and description (include paper url wherever relevant) through the Notion site if you haven't already done so. They will be made available on the Google Calendar and sent out with the reminder email on the day of the presentation. For journal club presenters, it is *important* for you to include the paper url in advance." + "\n\n" + tea_page_line(email_list), constants, replyto_email );
        }
      }
    }
    
    // remind coffee people
    if (email_option == 'coffee_people'){
      // get people's emails
      email_list = [];
      for (var i=0; i<tea_people_ids.length; i=i+1){
        var email_response = get_email_from_notion_id(tea_people_ids[i]['id'], mapping_sheet_id);
        if (typeof email_response == "string"){
          send_email(admin_email, 'Invalid Email When Sending Talk Reminders for ' + talk_date_string, email_response, constants );
          Logger.log(email_response); // skip this email
        } else {
          email_list.push(email_response[0]);
        }
      }  

      if  (email_list.length > 0){
        if (talk_type == 'Coffee Cleaning' ) {
          /* add a special nudge if it's a Wednesday */ 
          var wed_special_text = "";
          if (talk_date.getDay() == 3 && talk_name == "today"){
            wed_special_text = "It's also a Wednesday, so time for doing the weekly duties!"; 
          }
          /* send reminder */
          send_email(email_list.join(","), "REMINDER " + talk_type + " on " + talk_date_name, 
            "Hi,\n\n" + 
            "This is a reminder for your coffee cleaning duty. " + wed_special_text + "\n\n=============\n\n" +
            "Week: " + talk_start_date + " - " + talk_end_date + ", i.e. " + talk_date_name + "\n" +
            "In-charge: " + tea_people_names.join(", ") + "\n" +
            "Duty description: " + talk_description + "\n=============\n\n" + tea_page_line(email_list), constants, admin_email_coffee);
        }
      }
    }
  }
}


function send_http_request_tr(url, data, params, email, constants){
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
      next_results = send_http_request_tr(url, data, params, email, constants);
      results = results.concat(next_results); 
    }
  } else {    
    send_email(email, 'Notion API Failed When Sending Reminder On ' + fmt_date(new Date()), 'Notion does not seem to be responding. Please try again later or contact the tea tsar. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody , constants );  
  }
  return results;
}
