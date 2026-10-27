// Added 2026-10 (github.com/GatsbyUnit/gatsby-teabot): a line with the personal tea page link for reminder
// emails. The page address comes from the "Automation" tab of the constants sheet, the person's token from
// column D of the identity sheet. Any problem just leaves the line out, so a reminder is never blocked.
// address of the tea page (PAGE_URL in the Automation tab of the constants sheet), '' if not set
function tea_page_url(){
  try {
    var tab = SpreadsheetApp.openById('1ZH80lgLYGEfc4d_lp4awKlKyMEUqnbMS122Cgf4wyl4').getSheetByName('Automation');
    if (!tab) return '';
    var url = '';
    tab.getRange(1, 1, tab.getLastRow(), 2).getValues().forEach(function(r){ if (r[0] === 'PAGE_URL') url = String(r[1]).trim(); });
    return url;
  } catch (e) {
    Logger.log('tea_page_url: ' + e);
    return '';
  }
}

function tea_page_line(emails){
  try {
    var url = tea_page_url();
    if (!url) return '';
    if (emails.length === 1){
      var constants = get_global_constants();
      var ids = SpreadsheetApp.openById(constants['identity_mapping_id']).getSheets()[0];
      var values = ids.getRange(1, 1, ids.getLastRow(), 4).getValues();
      var want = String(emails[0]).trim().toLowerCase();
      for (var i = 1; i < values.length; i++){
        if (String(values[i][2]).trim().toLowerCase() === want && /^[0-9a-f]{40}$/.test(String(values[i][3]))){
          return 'Swap your slot, add your title or set away dates on your tea page:\n' + url + '?t=' + values[i][3] + '\n\n';
        }
      }
    }
    return 'Swap a slot, add a title or set away dates on the tea page:\n' + url + '\n\n';
  } catch (e) {
    Logger.log('tea_page_line: ' + e);
    return '';
  }
}
