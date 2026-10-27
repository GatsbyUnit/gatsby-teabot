// The tea page's back end (web app, runs as the bot, open to anyone). The page itself is static, on GitHub Pages
// (site/index.html), because Apps Script web pages don't open for people signed in to several Google accounts;
// it calls the api_* functions below through doPost. Old links to this address get a link to the same place there.
//
// SECURITY: a web page can call every top-level function of this project through google.script.run, so this
// project must contain only doGet, doPost and these thin wrappers. All logic lives in "Gatsby Tea Automation", used
// as the library TeaBot; each api_* function there checks the visitor's personal code or the unit key.

const PAGE_PARAMS = {t: /^[0-9a-f]{40}$/, confirm: /^[0-9a-f]{32}$/, swap: /^[0-9a-f]{32}$/, leave: /^1$/, k: /^[\w-]{6,64}$/};

function doGet(e){
  var p = (e && e.parameter) || {};
  var settings = {};
  try { settings = TeaBot.get_settings(); } catch (err) { console.log('settings: ' + err); }
  var q = Object.keys(PAGE_PARAMS).filter(function(k){ return PAGE_PARAMS[k].test(p[k] || ''); }).map(function(k){ return k + '=' + p[k]; });
  var url = (settings.PAGE_URL || '') + (q.length ? '?' + q.join('&') : '');
  return HtmlService.createHtmlOutput('<style>body{font:16px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 16px}</style>' +
      '<p>The tea page has moved.</p><p><a href="' + url + '" target="_top">Open the tea page</a></p>')
    .setTitle('Gatsby tea')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// The page calls the api_* functions below with an anonymous POST. Only the api_* functions of this project can
// be called; each one checks the visitor's personal code or the unit key.
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
function api_link_people(key){ return TeaBot.api_link_people(key); }
function api_request_link(key, person_id){ return TeaBot.api_request_link(key, person_id); }
function api_page_icon(){ return TeaBot.api_page_icon(); }
function api_finalise(token, rota, email_group){ return TeaBot.api_finalise(token, rota, email_group); }
function api_plan_slots(token, rota, ranges){ return TeaBot.api_plan_slots(token, rota, ranges); }
function api_fill_slots(token, rota){ return TeaBot.api_fill_slots(token, rota); }
function api_leave_info(token){ return TeaBot.api_leave_info(token); }
function api_leave(token){ return TeaBot.api_leave(token); }
function api_leave_by_name(key, person_id){ return TeaBot.api_leave_by_name(key, person_id); }
function api_rotas(token){ return TeaBot.api_rotas(token); }

// run once from the editor after creating the project, to grant it the bot's permissions. (The page's
// address is the PAGE_URL setting in the Automation tab of the constants sheet.)
function authorize(){
  Logger.log('Tea page address known to the automation: ' + TeaBot.get_settings().PAGE_URL);
}
