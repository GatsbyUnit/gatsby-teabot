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
    'gatsby_admin_email': sheet.getRange(27, 2).getValue(),
  }
  return constants;
}

function fmt_date(date){
  var timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, 'dd MMM yyyy');
}

function fmt_date_for_notion(date){
  var timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

function get_notion_id(email, mapping_sheet_id){  
  var mapping_sheet = SpreadsheetApp.openById(mapping_sheet_id).getSheets()[0];
  var text_finder = mapping_sheet.createTextFinder(email).findNext();
  if (text_finder === null){
    return "No email [" + email + "] found.";
  }

  var email_row = text_finder.getRow();
  var notion_url = mapping_sheet.getRange(email_row, 1).getValue();
  var tmp = notion_url.split('-');
  if (tmp.length < 2){
    return "Invalid Notion URL for email [" + email + "]";
  } else {
    return [notion_url];
  }
}

function send_email(email, title, body, constants, replyto_email){  
  const notion_site_url =  constants['notion_site_url'];  
  const today = new Date();
  var footer = '--------\nGatsby Tea Bot @ ' + today.getFullYear() + '\n' + notion_site_url + '\n\nMake me smarter at scheduling by keeping your away dates updated. Get your away date spreadsheet from ' + notion_site_url + '.';
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

function remove_hyphen_from_id(id_string){
  return id_string.replace(/-/g, '');
}
