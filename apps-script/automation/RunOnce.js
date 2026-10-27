// One-off (2026-10-27): closes the forms close_old_forms() missed, the separate "Request Zoom for Talks"
// form and the 2023 copies of the old forms in _backups, so that they point to the tea page as well. The
// archive helper then moves them into the archive folder. Delete this file after running it.
const LEFTOVER_FORMS = {
  '11p79kQIQzKZNNGOVQuGuOG7i1WdfGdJgn-g-BNgvXLI': 'Zoom request form',
  '1NthxEQGuSy062nqIhBGYcVNhXmsmc_Pj7nvGeOkzGDk': '2023 copy of the title form',
  '1wXqOc4MOWy0Br3XF6d9OEDCPB6KCXBOH0kuMxcZ5000': '2023 copy of the title form',
  '1MU46qF3qTNp2G4-Zn30nme7CEaUJq6QOzFWl8coaI1k': '2023 copy of the swap form',
  '1c4wTzTpPXZ1zMlU-5tLRpCg-cdTG8zFhXGbI997AiX8': '2023 copy of the swap form',
  '1JM1gFDyq2OdE3e0vbH3VsFzLI3cc6PHRQqh8mJ_ZTYk': '2023 copy of the change-email form',
  '1EmTqAn0n_fBA2mlBcpfcZtF53Y0b3QiPCpXzsSQF9Ww': '2023 copy of the change-email form'
};

function close_leftover_forms(){
  var url = page_url(get_settings());
  Object.keys(LEFTOVER_FORMS).forEach(function(id){
    var form = FormApp.openById(id);
    var was_open = form.isAcceptingResponses();
    form.setCustomClosedFormMessage('This form has been replaced by the tea page, where you can swap your slots, add your talk title, request Zoom and set your away dates: ' + url);
    form.setAcceptingResponses(false);
    Logger.log(LEFTOVER_FORMS[id] + ' "' + form.getTitle() + '": ' + (was_open ? 'was open, now closed' : 'was already closed') +
               ', ' + form.getResponses().length + ' responses');
  });
}
