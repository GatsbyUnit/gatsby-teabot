// Added 2026-10 (github.com/GatsbyUnit/gatsby-teabot): a line with the personal tea page link for reminder
// emails. The page address comes from the "Automation" tab of the constants sheet, the person's token from
// column D of the identity sheet. Any problem just leaves the line out, so a reminder is never blocked.
// address of the tea page (PAGE_URL in the Automation tab of the constants sheet) with these parameters, '' if
// not set. Links without a personal code carry the unit key (PAGE_KEY there), without which the page shows nothing.
function tea_page_url(params){
  try {
    var tab = SpreadsheetApp.openById('1ZH80lgLYGEfc4d_lp4awKlKyMEUqnbMS122Cgf4wyl4').getSheetByName('Automation');
    if (!tab) return '';
    var s = {};
    tab.getRange(1, 1, tab.getLastRow(), 2).getValues().forEach(function(r){ s[r[0]] = String(r[1]).trim(); });
    if (!s.PAGE_URL) return '';
    params = params || {};
    var q = s.PAGE_KEY && !params.t ? ['k=' + encodeURIComponent(s.PAGE_KEY)] : [];
    Object.keys(params).forEach(function(k){ q.push(k + '=' + encodeURIComponent(params[k])); });
    return s.PAGE_URL + (q.length ? '?' + q.join('&') : '');
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
          return 'Swap your slot, add your title or set away dates on your tea page:\n' + tea_page_url({t: values[i][3]}) + '\n\n';
        }
      }
    }
    return 'Swap a slot, add a title or set away dates on the tea page:\n' + url + '\n\n';
  } catch (e) {
    Logger.log('tea_page_line: ' + e);
    return '';
  }
}

// Added 2026-11: the "Can't make it" line for reminders. Until HANDON_DAYS before the slot, "Can't make it" on the
// tea page hands the duty to the next person in line (the automation's CantMakeIt.js, same numbers; tests check),
// so the two-week reminder still leaves time for it; later reminders point to a swap. role: 'presenter' or 'tea'
// (tea and coffee duty).
var HANDON_DAYS = {presenter: 12, tea: 3};

function cant_make_it_line(talk_date, role){
  try {
    var last = new Date(talk_date.getFullYear(), talk_date.getMonth(), talk_date.getDate() - HANDON_DAYS[role === 'tea' ? 'tea' : 'presenter']);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today.getTime() <= last.getTime()){
      return "Can't make it? Press \"Can't make it\" on your tea page by " + Utilities.formatDate(last, 'Europe/London', 'EEE d MMM') +
        ": the bot hands it to the next person in line, and you keep your turn. After that, agree a swap with a colleague.\n\n";
    }
    return "Can't make it? Agree a swap with a colleague and hand it over on your tea page.\n\n";
  } catch (e) {
    Logger.log('cant_make_it_line: ' + e);
    return '';
  }
}
