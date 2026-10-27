// remind everyone of the talk on that day
function uploadslidesreminder_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    uploadslidesreminder(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Sending Talk Reminders', 'Error message:\n\n' + err , constants );
    throw err;
  }
}

function uploadslidesreminder(admin_email, constants){
  var today = new Date();
  var email_option = "duty_people";
  slidesreminder(admin_email, today, email_option, constants);
}

function slidesreminder(admin_email, talk_date, email_option, constants) {
  // email_option has to be "duty_people" or "group"
  if (email_option !== "duty_people"){
    send_email(admin_email, 'Urgent: bug in talk reminder script', 'email_option is invalid; need to be "duty_people".', constants)
    Logger.log('email_option is invalid');
    return;
  }
  // constants
  const notion_token = constants['notion_token'];
  const talk_db_id = constants['notion_talk_db_id'];
  const people_db_id = constants['notion_people_db_id'];
  const mapping_sheet_id = constants['identity_mapping_id'];

  const talk_date_string = fmt_date(talk_date);
  const slides_faq_link = 'https://www.notion.so/gcnu/Gatsby-Tea-System-2444835e8eab46fa9a7c792877e09620?pvs=4#b336808b691c4e25b407103950f50d6d';
  
  /* 
      get recent talks for people from Notion, assuming that there is only one talk per day
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
    find talk on the relevant date
  */
  var relevant_talks = [];
  for (var i=0; i < talks.length; i=i+1){
    var current_talk = talks[i];
    var current_talk_date = new Date(current_talk['properties']['Date']['date']['start']);
    if ( current_talk_date.getDate().valueOf() == talk_date.getDate().valueOf()){
      relevant_talks.push(current_talk);
    } 
  }

  
  for (var r=0; r< relevant_talks.length; r=r+1){
    var relevant_talk = relevant_talks[r];
    var talk_type = relevant_talk['properties']['Type']['select']['name'];
    var talk_title_text = relevant_talk['properties']['Title']['title'];
    if (talk_title_text.length > 0){
      var talk_title = talk_title_text[0]['text']['content'];
    } else {
      var talk_title = '';
    }
    console.log(relevant_talk['properties']['Date']['date']['start']);
    var presenter_ids = relevant_talk['properties']['Presenter']['relation'];
    var tea_people_ids = relevant_talk['properties']['Tea']['relation'];


    // extract tea people for completeness
    email_list = [];
    for (var i=0; i<tea_people_ids.length; i=i+1){
      var email_response = get_email_from_notion_id(tea_people_ids[i]['id'], mapping_sheet_id);
      if (typeof email_response == "string"){
        send_email(admin_email, 'Invalid Email When Sending Talk Reminders for ' + talk_date_string, email_response , constants);
        Logger.log(email_response); // skip this email
      } else {
        email_list.push(email_response[0]);
      }
    }
    
    // send emails to presenters if talk type is tea talk or research talk
    if (talk_type == 'Research Talk' || talk_type == 'Tea Talk') {
      var email_list = [];
      for (var i=0; i<presenter_ids.length; i=i+1){
        var email_response = get_email_from_notion_id(presenter_ids[i]['id'], mapping_sheet_id);
        if (typeof email_response == "string"){
          send_email(admin_email, 'Invalid Email When Sending Talk Reminders for ' + talk_date_string, email_response, constants );
          Logger.log(email_response); // skip this email
        } else {
          email_list.push(email_response[0]);
        }
      }
      send_email(email_list.join(","), "REMINDER Please upload your slides", 
        "Hi,\n\n" +
        "Thank you for giving your talk today! \n\n" +
        "Please update your talk title through the Notion site if you haven't already done so. \n\n" +
        "Also, please upload your slides in PDF format to the cluster, as detailed below: \n" +
        slides_faq_link , constants, admin_email);
    }
  }
}
