// This function changes people's emails

function onsubmit_wrapper(e){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    onsubmit(e, admin_email, constants);
  } catch (err) {
    mark_response_invalid(e);
    var items = e['namedValues'];
    var current_email = items['Current email for the tea system'][0];
    send_email(current_email, 'Error When Changing Email', 'Reply to this email to talk to the tea tsar if you think there is an issue. Error message:\n\n' + err, constants, admin_email );
    throw err;
  }
}


function onsubmit(e, admin_email, constants){
  // constants
  const mapping_sheet_id = constants['identity_mapping_id'];
  var mapping_sheet = SpreadsheetApp.openById(mapping_sheet_id).getSheets()[0];


  /* 
    get form response
  */
  var items = e['namedValues'];
  var current_email = items['Current email for the tea system'][0];
  var new_email = items['New email for the tea system'][0];


  // validate current email  
  var text_finder = mapping_sheet.createTextFinder(current_email).findNext();
  if (text_finder === null){
    mark_response_invalid(e);
    send_email(current_email, 'Error When Changing Email', 'No email [' + current_email + '] found.', constants, admin_email);
    return;
  }
  var email_row = text_finder.getRow();


  // validate and change new email
  if (new_email !== ""){ // only process if non-empty
    if (validate_email(new_email) === false){
      mark_response_invalid(e);
      send_email(current_email, 'Error When Changing Email', 'New email suggested [' + new_email + '] is of an invalid format.', constants, admin_email);
      return;
    } else {
      mapping_sheet.getRange(email_row, 3).setValue(new_email);
      send_email(admin_email, 'Change Email Success', 'A request was successfully processed for changing [' + current_email + '] to [' + new_email + '] for the tea system.', constants);
      send_email(current_email + ',' + new_email, 'Change Email Success', 'New email [' + new_email + '] has successfully replaced the original email [' + current_email + '] for the tea system.', constants, admin_email);
    }
  }


}

function validate_email(email){
  var email_pattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
  return email_pattern.test(email);
}

function mark_response_invalid(e){
  const response_sheet_id = '1r3d9RVVr_yNcB1qx9sVP05j6Z7iWU1kXIbeVOXvuXlo';
  
  var row = e['range']['rowEnd'];
  var col_end = e['range']['columnEnd'];

  var response_sheet = SpreadsheetApp.openById(response_sheet_id).getSheets()[0];
  response_sheet.getRange(row, col_end + 1).setValue('invalid');
}

