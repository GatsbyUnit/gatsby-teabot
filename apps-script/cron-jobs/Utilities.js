function get_global_constants(){
  const const_sheet_id = '1ZH80lgLYGEfc4d_lp4awKlKyMEUqnbMS122Cgf4wyl4';
  var sheet = SpreadsheetApp.openById(const_sheet_id).getSheets()[0];
  var constants = {
    'admin_email': sheet.getRange(2, 2).getValue(),
    'mljc_admin_email': sheet.getRange(3, 2).getValue(),
    'tnjc_admin_email': sheet.getRange(4, 2).getValue(),
    'coffee_admin_email': sheet.getRange(5, 2).getValue(),
    'swc_cluster_bot_email': sheet.getRange(6, 2).getValue(),
    'unit_wide_email': sheet.getRange(7, 2).getValue(),
    'mljc_email': sheet.getRange(8, 2).getValue(),
    'tnjc_email': sheet.getRange(9, 2).getValue(),
    'csnjc_email': sheet.getRange(10, 2).getValue(),
    'gatsby_zoom_link': sheet.getRange(11, 2).getValue(),
    'old_format_tea_people_file_id': sheet.getRange(12, 2).getValue(),
    'old_format_tea_talk_people_file_id': sheet.getRange(13, 2).getValue(),
    'old_format_research_talk_people_file_id': sheet.getRange(14, 2).getValue(),
    'old_format_names_file_id': sheet.getRange(15, 2).getValue(),
    'old_format_schedule_folder_id': sheet.getRange(16, 2).getValue(),
    'away_dates_folder_id': sheet.getRange(17, 2).getValue(),
    'away_dates_sheet_template_id': sheet.getRange(18, 2).getValue(),
    'identity_mapping_id': sheet.getRange(19, 2).getValue(),
    'google_calendar_id': sheet.getRange(20, 2).getValue(),
    'notion_token': sheet.getRange(21, 2).getValue(),
    'notion_people_db_id': sheet.getRange(22, 2).getValue(),
    'notion_rota_rules_db_id': sheet.getRange(23, 2).getValue(),
    'notion_talk_db_id': sheet.getRange(24, 2).getValue(),
    'notion_site_url': sheet.getRange(25, 2).getValue(),
  }
  return constants;
}

function fmt_date(date){
  var timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, 'dd MMM yyyy');
}

function fmt_time_simple(date){
  var timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, 'h:mm a');
}

function fmt_date_for_notion(date){
  var timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

function get_notion_id_url(email, mapping_sheet_id){  
  var mapping_sheet = SpreadsheetApp.openById(mapping_sheet_id).getSheets()[0];
  var text_finder = mapping_sheet.createTextFinder(email).findNext();
  if (text_finder === null){
    return "No email [" + email + "] found.";
  }

  var email_row = text_finder.getRow();
  var notion_url = mapping_sheet.getRange(email_row, 1).getValue();
  var notion_id = get_notion_id_from_url(notion_url);
  if (notion_id === false){
    return "Invalid Notion URL for email [" + email + "]";
  } else {
    return [notion_id];
  }
}

function validate_email(email){
  var email_pattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
  return email_pattern.test(email);
}

function get_notion_id_from_url(notion_url){
  var tmp = notion_url.split('-');
  if (tmp.length < 2){
    return false;
  } else {
    return tmp[tmp.length - 1];
  }
}

function check_email_in_user_array(email, user_array){
  for (var i = 0; i < user_array.length; i++) {
    if (email == user_array[i].getEmail()){ return true;}
  }
  return false;
}

function get_email_from_notion_id_vanilla(notion_id, mapping_sheet_id){
  var mapping_sheet = SpreadsheetApp.openById(mapping_sheet_id).getSheets()[0];
  var text_finder = mapping_sheet.createTextFinder(remove_hyphen_from_id(notion_id)).findNext();
  if (text_finder === null){
    return "No id [" + notion_id + "] found.";
  }
  
  var email_row = text_finder.getRow();
  var email = mapping_sheet.getRange(email_row, 3).getValue();
  if (validate_email(email) === false){
    return false;
  } else {
    return email;
  }
}

function get_email_from_notion_id(notion_id, mapping_sheet_id){
  var email = get_email_from_notion_id_vanilla(notion_id, mapping_sheet_id)
  if (email === false){
    return "Invalie email [" + email + "] for notion id [" + notion_id + "]"
  } else {
    return [email];
  }
}

function send_email(email, title, body, constants, replyto_email){  
  const notion_site_url =  constants['notion_site_url'];  
  const today = new Date();
  var page = tea_page_url();
  var footer = '--------\nGatsby Tea Bot @ ' + today.getFullYear() + '\n' + notion_site_url + '\n\nMake me smarter at scheduling by keeping your away dates up to date' + (page ? ' on your tea page (' + page + ') or' : '') + ' in your away-date sheet (linked from your profile on ' + notion_site_url + ').';
  body = body + '\n\n\n' + footer;
  
  if ( replyto_email == null ){
    opt = {}
  } else {
    opt = {replyTo: replyto_email}
  }

  // send email
  MailApp.sendEmail(
    email,
    '[Gatsby Tea Bot] ' + title,
    body,
    opt
  );
}

function get_names_from_ids(ids, people){
  var names = [];
  for (var i=0; i<ids.length; i=i+1){
    var id = ids[i]['id'];
people_loop:
    for (var p=0; p<people.length; p=p+1){
      if (people[p]['id'] == id){
        var name_text = people[p]['properties']['Name']['title'];
        if (name_text.length > 0){ // only push valid names
          names.push(name_text[0]['text']['content']);
        }
        break people_loop;
      }
    }
  }
  return names;
}

function get_clusterids_from_ids(ids, people){
  var clusterids = [];
  for (var i=0; i<ids.length; i=i+1){
    var id = ids[i]['id'];
clusterid_loop:
    for (var p=0; p<people.length; p=p+1){
      if (people[p]['id'] == id){
        var clusterid_text = people[p]['properties']['Cluster ID']['rich_text'];
        if (clusterid_text.length > 0){ 
          clusterids.push(clusterid_text[0]['text']['content']);
        } else {
          return false;
        }
        break clusterid_loop;
      }
    }
  }
  return clusterids;
}

function print_ids(ids, people){
  var print_arr = [];
  for (var i=0; i<ids.length; i=i+1){
    var id = ids[i]['id'];
    var tmp = get_names_from_ids([id], people);
    if (tmp.length == 0){
      print_arr.push(id);
    } else {
      print_arr.push(tmp[0]);
    }
  }
  return print_arr.join('\n');
}

function string_to_dates(date_string){
  var tmp = date_string.split(' - ');
  return [new Date(tmp[0]), new Date(tmp[1])];
}

function dates_to_string(dates){
  return fmt_date(dates[0]) + ' - ' + fmt_date(dates[1]);
}

function remove_hyphen_from_id(id_string){
  return id_string.replace(/-/g, '');
}

function isNumeric(num){
  return !isNaN(num)
}

