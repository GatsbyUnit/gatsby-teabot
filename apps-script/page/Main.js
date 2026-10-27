// The personal tea page (web app, runs as the bot, open to anyone with the link).
//   ?t=<token>       your page: upcoming duties (swap, edit title), away dates, email, organiser tools
//   ?confirm=<code>  confirms an email change
//   (nothing)        asks for your registered email and sends you your personal link
//
// SECURITY: a web page can call every top-level function of this project through google.script.run, so this
// project must contain only doGet and these thin wrappers. All logic lives in "Gatsby Tea Automation", used
// as the library TeaBot; each api_* function there checks the visitor's token.

function doGet(e){
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('Page');
  t.token = /^[0-9a-f]{40}$/.test(p.t || '') ? p.t : '';
  t.confirm = /^[0-9a-f]{32}$/.test(p.confirm || '') ? p.confirm : '';
  return t.evaluate()
    .setTitle('Gatsby tea')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function api_state(token){ return TeaBot.api_state(token); }
function api_swap(token, row_id, duty, to_id){ return TeaBot.api_swap(token, row_id, duty, to_id); }
function api_title(token, row_id, title, description){ return TeaBot.api_title(token, row_id, title, description); }
function api_cancel(token, row_id, reason){ return TeaBot.api_cancel(token, row_id, reason); }
function api_add_away(token, from, to, reason){ return TeaBot.api_add_away(token, from, to, reason); }
function api_remove_away(token, row_number){ return TeaBot.api_remove_away(token, row_number); }
function api_change_email(token, new_email){ return TeaBot.api_change_email(token, new_email); }
function api_confirm_email(code){ return TeaBot.api_confirm_email(code); }
function api_request_link(email){ return TeaBot.api_request_link(email); }
function api_finalise(token, rota, email_group){ return TeaBot.api_finalise(token, rota, email_group); }
function api_create_slots(token, rota, ranges){ return TeaBot.api_create_slots(token, rota, ranges); }
function api_fill_slots(token, rota){ return TeaBot.api_fill_slots(token, rota); }
function api_request_zoom(token, row_id, reason){ return TeaBot.api_request_zoom(token, row_id, reason); }
function api_set_away_calendar(token, calendar_id){ return TeaBot.api_set_away_calendar(token, calendar_id); }

// run once from the editor after creating the project, to grant it the bot's permissions. (The page's
// address is the PAGE_URL setting in the Automation tab of the constants sheet.)
function authorize(){
  Logger.log('Tea page address known to the automation: ' + TeaBot.get_settings().PAGE_URL);
}
