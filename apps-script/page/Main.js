// The personal tea page (web app, runs as the bot, open to anyone with the link).
//   ?t=<token>       your page: upcoming duties (swap, edit title), away dates, email, organiser tools
//   ?confirm=<code>  confirms an email change
//   ?swap=<code>     accept or decline a swap someone asked you for
//   ?leave=1         leave the tea system (with ?t=: one click; without: pick your name, one click)
//   (nothing)        lists the registered people by name and emails the chosen one their personal link
//
// SECURITY: a web page can call every top-level function of this project through google.script.run, so this
// project must contain only doGet, doPost and these thin wrappers. All logic lives in "Gatsby Tea Automation", used
// as the library TeaBot; each api_* function there checks the visitor's token.

function doGet(e){
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('Page');
  t.token = /^[0-9a-f]{40}$/.test(p.t || '') ? p.t : '';
  t.confirm = /^[0-9a-f]{32}$/.test(p.confirm || '') ? p.confirm : '';
  t.swap = /^[0-9a-f]{32}$/.test(p.swap || '') ? p.swap : '';
  t.leave = p.leave ? '1' : '';
  var settings = {};
  try { settings = TeaBot.get_settings(); } catch (err) { console.log('settings: ' + err); }
  t.exec_url = settings.PAGE_URL || '';
  var out = t.evaluate()
    .setTitle('Gatsby tea')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // the tab icon lives in the private constants sheet (setting FAVICON_URL); a bad value never breaks the page
  try {
    if (settings.FAVICON_URL) out.setFaviconUrl(settings.FAVICON_URL);
  } catch (err) {
    console.log('favicon: ' + err);
  }
  return out;
}

// The page calls the api_* functions below with an anonymous POST rather than google.script.run, which fails
// with "Sorry, unable to open the file at this time" for people signed in to several Google accounts.
// Only the api_* functions of this project can be called; each one checks the visitor's token.
function doPost(e){
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var fn = /^api_\w+$/.test(req.fn) ? globalThis[req.fn] : null;
    if (typeof fn !== 'function') throw new Error('Unknown call.');
    out = {ok: true, result: fn.apply(null, req.args || [])};
  } catch (err) {
    out = {ok: false, error: String(err && err.message ? err.message : err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function api_state(token){ return TeaBot.api_state(token); }
function api_swap(token, row_id, duty, to_id){ return TeaBot.api_swap(token, row_id, duty, to_id); }
function api_swap_request(code){ return TeaBot.api_swap_request(code); }
function api_answer_swap(code, accept){ return TeaBot.api_answer_swap(code, accept); }
function api_answer_swap_mine(token, code, accept){ return TeaBot.api_answer_swap_mine(token, code, accept); }
function api_withdraw_swap(token, code){ return TeaBot.api_withdraw_swap(token, code); }
function api_title(token, row_id, title, description){ return TeaBot.api_title(token, row_id, title, description); }
function api_cancel(token, row_id, reason){ return TeaBot.api_cancel(token, row_id, reason); }
function api_add_away(token, from, to, reason){ return TeaBot.api_add_away(token, from, to, reason); }
function api_remove_away(token, row_number){ return TeaBot.api_remove_away(token, row_number); }
function api_change_email(token, new_email){ return TeaBot.api_change_email(token, new_email); }
function api_confirm_email(code){ return TeaBot.api_confirm_email(code); }
function api_link_people(){ return TeaBot.api_link_people(); }
function api_request_link(person_id){ return TeaBot.api_request_link(person_id); }
function api_finalise(token, rota, email_group){ return TeaBot.api_finalise(token, rota, email_group); }
function api_plan_slots(token, rota, ranges){ return TeaBot.api_plan_slots(token, rota, ranges); }
function api_fill_slots(token, rota){ return TeaBot.api_fill_slots(token, rota); }
function api_leave_info(token){ return TeaBot.api_leave_info(token); }
function api_leave(token){ return TeaBot.api_leave(token); }
function api_leave_by_name(person_id){ return TeaBot.api_leave_by_name(person_id); }
function api_rotas(token){ return TeaBot.api_rotas(token); }

// run once from the editor after creating the project, to grant it the bot's permissions. (The page's
// address is the PAGE_URL setting in the Automation tab of the constants sheet.)
function authorize(){
  Logger.log('Tea page address known to the automation: ' + TeaBot.get_settings().PAGE_URL);
}
