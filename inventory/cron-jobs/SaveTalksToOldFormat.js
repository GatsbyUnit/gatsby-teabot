// this function periodically saves talks to old format. 

function save_talks_to_old_fmt_wrapper() {
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    save_talks_to_old_fmt(admin_email);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Saving Talks to Old Format', 'Error message:\n\n' + err, constants );
    throw err;
  }

}

function save_talks_to_old_fmt(admin_email){
  // constants
  const notion_token = constants['notion_token'];
  const talk_db_id = constants['notion_talk_db_id'];
  const people_db_id = constants['notion_people_db_id'];
  const schedule_folder_id = constants['old_format_schedule_folder_id'];
  
  const schedule_folder = DriveApp.getFolderById(schedule_folder_id);

  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate()-1);
  var last_month_start = new Date(yesterday.getFullYear().toString() + "-" + (yesterday.getMonth() + 1).toString() + "-01");

  /* 
      get all people's data from Notion
  */
  var data = {
    'sorts': [{
        'property': 'Active',
        'direction': 'descending'
    }]
  };
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var people = send_http_request_sttof('https://api.notion.com/v1/databases/' + people_db_id + '/query', data, params, admin_email, constants);
  if (people === false) { return; } 

  /* 
      get all talks's data from Notion from the last month
  */
  var data = {
	  'filter': {
	    'and': [
	      {
	        'property': 'Date',
					'date': {
						'on_or_before': fmt_date_for_notion(yesterday)
					}
	      },
	      {
	        'property': 'Date',
					'date': {
						'on_or_after': fmt_date_for_notion(last_month_start)
					}
	      },
			]
		},
    'sorts': [{
        'property': 'Date',
        'direction': 'ascending'
    }]
  }
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var talks = send_http_request_sttof('https://api.notion.com/v1/databases/' + talk_db_id + '/query', data, params, admin_email, constants);
  if (talks === false) { return; } 

  var schedule_str_arr = []; 
  for (var i=0; i<talks.length; i=i+1){
    var current_talk = talks[i];
    var current_talk_date = new Date(current_talk['properties']['Date']['date']['start']);
    var schedule_arr = fmt_date_for_notion(current_talk_date).split("-");

    var talk_type = current_talk['properties']['Type']['select']['name'];    
    var presenter_ids = current_talk['properties']['Presenter']['relation'];
    var tea_people_ids = current_talk['properties']['Tea']['relation'];
    var presenter_clusterids = get_clusterids_from_ids(presenter_ids, people);
    var tea_people_clusterids = get_clusterids_from_ids(tea_people_ids, people);

    var talk_title_text = current_talk['properties']['Title']['title'];
    if (talk_title_text.length > 0){
      var talk_title = talk_title_text[0]['text']['content'];
    } else {
      var talk_title = '';
    }
    
    if (presenter_clusterids === false){
      send_email(admin_email, 'Missing Cluster ID And Hence Error When Saving Talks to Old Format', 'People with missing cluster ids :\n\n' + print_ids(presenter_ids, people), constants );
      return;
    }

    if (tea_people_clusterids === false){
      send_email(admin_email, 'Missing Cluster ID And Hence Error When Saving Talks to Old Format', 'People with missing cluster ids :\n\n' + print_ids(tea_people_ids, people), constants );
      return;
    }

    if (talk_type == "Research Talk" && presenter_clusterids.length > 0){
      schedule_arr.push(presenter_clusterids.join(' '));
    } else {
      schedule_arr.push('.');
    }
    
    if (talk_type == "Tea Talk" && presenter_clusterids.length > 0){
      schedule_arr.push(presenter_clusterids.join(' '));
    } else {      
      schedule_arr.push('.');
    }

    if (tea_people_clusterids.length > 0){
      schedule_arr.push(tea_people_clusterids.join(' '));
    } else {
      schedule_arr.push('.');
    }
    
    if (talk_title !== ''){
      schedule_arr.push(talk_title);
    } else {
      schedule_arr.push('.');
    }

    schedule_str_arr.push(schedule_arr.join('\t'));
  }

  /* create file */
  schedule_folder.createFile('list_' + yesterday.getFullYear().toString() + '_' + (yesterday.getMonth()+1).toString() + '_01', schedule_str_arr.join('\n'));

  send_email(admin_email, 'Saved Talks to Old Format Success', 'Saved talks to old format successful.', constants);
}


function send_http_request_sttof(url, data, params, email, constants){
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
      next_results = send_http_request_sttof(url, data, params, email, constants);
      results = results.concat(next_results); 
    }
  } else {
    send_email(email, 'Notion API Failed When Saving Talks to Old Format', 'Notion does not seem to be responding. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody, constants );
  }
  return results;
}

