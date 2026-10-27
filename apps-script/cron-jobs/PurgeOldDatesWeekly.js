// this script removes old away dates automatically every week

function purgeolddates_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    purgeolddates(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Updating Away Dates', 'Error message:\n\n' + err, constants);
    throw err;
  }
}

function purgeolddates(admin_email, constants) {
  // constants
  const folder_id = constants['away_dates_folder_id'];

  /*
    purge old dates
  */
  var folder = DriveApp.getFolderById(folder_id);
  var sheets = folder.getFiles();
  var count = 0;
  while (sheets.hasNext()) {
    count++;
    var file = sheets.next();
    var fileid = file.getId();
    var sheet = SpreadsheetApp.openById(fileid).getSheets()[0];
    var today = new Date().getTime();

    var from_cell = sheet.getRange(1,2);
    var to_cell = sheet.getRange(1,3);
    var reason_cell = sheet.getRange(1,4);
    j=1;
    innerloop:
    while ( (!from_cell.isBlank()) || (!to_cell.isBlank()) ){
      if (from_cell.isBlank() || to_cell.isBlank() ){ 
        from_cell.deleteCells(SpreadsheetApp.Dimension.ROWS);
        to_cell.deleteCells(SpreadsheetApp.Dimension.ROWS); 
        reason_cell.deleteCells(SpreadsheetApp.Dimension.ROWS);
      } else {
        var from_date = new Date(from_cell.getValue()).getTime();
        var to_date = new Date(to_cell.getValue()).getTime();
        if (from_date > to_date || to_date < today ){
          from_cell.deleteCells(SpreadsheetApp.Dimension.ROWS);
          to_cell.deleteCells(SpreadsheetApp.Dimension.ROWS); 
          reason_cell.deleteCells(SpreadsheetApp.Dimension.ROWS);
        } else {
          j++;
        }
      }
      from_cell = sheet.getRange(j, 2);
      to_cell = sheet.getRange(j, 3);
      reason_cell = sheet.getRange(j, 4);
    }
  }
  

  /*
      email notification
  */
  send_email(admin_email, 'Weekly Away Date Purge Success', 'Total number of people checked: ' + count + '\n', constants);


}