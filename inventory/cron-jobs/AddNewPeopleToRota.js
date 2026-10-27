// this function periodically adds people to rota. Periods of exemption differ according to their positions, for which the data is obtained from the Notion page.

function add_new_people_to_rota_wrapper(){
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    add_new_people_to_rota(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Adding New People to Rota', 'Error message:\n\n' + err, constants );
    throw err;
  }

}


function add_new_people_to_rota(admin_email, constants) {
  // constants

  const notion_token = constants['notion_token'];
  const people_db_id = constants['notion_people_db_id'];
  const rota_rules_db_id = constants['notion_rota_rules_db_id'];

  /*
    Read rota rules, interpret only the leading numbers as days
  */
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var rules = send_http_request_anptr('https://api.notion.com/v1/databases/' + rota_rules_db_id + '/query', {}, params, admin_email, constants);
  if (rules === false){ return; }

  var duty_types = ["Tea Duty", "Research Duty", "Tea Talk Duty"];
  var exclude_duty_checkboxes = ["Excluded from tea", "Excluded from research talk", "Excluded from tea talk"];

  var count = 0;
  var success_count = 0;  
  var fail_count = 0; 

  for (var i=0; i<rules.length; i=i+1 ){
    var rule = rules[i];
    //var position = rule['properties']['Type']['title'][0]["text"]["content"];
    if (rule['properties'] && rule['properties']['Type'] && rule['properties']['Type']['title'] 
    && Array.isArray(rule['properties']['Type']['title']) && rule['properties']['Type']['title'][0] 
    && rule['properties']['Type']['title'][0]["text"] 
    && rule['properties']['Type']['title'][0]["text"]["content"]) {

    var position = rule['properties']['Type']['title'][0]["text"]["content"];
    } else {
    Logger.log("Missing or invalid 'Type' property in rule:", rule);
    var position = "Unknown"; // Set a default value or handle the case properly
    }
    //
    //
    //
    for (var d=0; d<duty_types.length; d=d+1){
      var and_conds = [{ 
          'property': 'Active', 
          'checkbox': { 'equals': true } 
      }, { 
          'property': 'Position', 
          'select': { 'equals': position } 
      }];
      var duty = duty_types[d];
      var exclude_duty_checkbox = exclude_duty_checkboxes[d];
      and_conds.push({ 
          'property': exclude_duty_checkbox,
          'checkbox': { 'equals': true }
      });
      //var duty_day_string = rule['properties'][duty]["select"]["name"].split(" ")[0];
      if (rule['properties'] && rule['properties'][duty] && rule['properties'][duty]["select"] 
    && rule['properties'][duty]["select"]["name"]) {

    var duty_day_string = rule['properties'][duty]["select"]["name"].split(" ")[0];

    } else {
    Logger.log("Missing or invalid duty property in rule:", rule);
    var duty_day_string = "Unknown"; // Set a default value or handle the case properly
    }
    //
    //
    //
      if (isNumeric(duty_day_string)){
        // add the condition only when a valid number is supplied
        var duty_day = + duty_day_string;
        var today_x_days_before = new Date();
        today_x_days_before.setDate(today_x_days_before.getDate() - duty_day);
        and_conds.push({
              'property': 'Join Date',
              'date': { 'on_or_before': fmt_date_for_notion(today_x_days_before) }
        });

        // get people who fulfil the conditions from Notion
        var data = {
          'filter': {
            'and': and_conds
          }
        };
        var params = {
          'headers':{
            'Authorization': 'Bearer ' + notion_token + '',
            'Content-Type' : 'application/json',
            'Notion-Version': '2021-08-16'
          },
          'method' : 'post'
        };
        var people = send_http_request_anptr('https://api.notion.com/v1/databases/' + people_db_id + '/query', data, params, admin_email, constants);
        if (people === false) { return; }

        var count = count + people.length;
  
        // set these people's excluded from schedule property to be false
        for (var p=0; p<people.length; p=p+1){
          var notion_id = people[p]['id']; 
          var prop = {};
          prop[exclude_duty_checkbox] = { 'checkbox': false };
          var data = {
            'properties': prop
          };
          var params = {
            'headers':{
              'Authorization': 'Bearer ' + notion_token + '',
              'Content-Type' : 'application/json',
              'Notion-Version': '2021-08-16'
            },
            'method' : 'patch'
          };
          results = send_http_request_anptr('https://api.notion.com/v1/pages/' + notion_id, data, params, admin_email, constants);
          if (results === false) { 
            fail_count = fail_count + 1;
          } else {
            success_count = success_count + 1;
          } 
        }
      }
    }
  }

  /*
      email notification
  */
  send_email(admin_email, 'Weekly New People Addition to Rota Success', 'Total number of people to be added: ' + count + '\nTotal number of successful additions: ' + success_count + '\nTotal number of failed additions: ' + fail_count, constants);

}

function send_http_request_anptr(url, data, params, email, constants){
  params['muteHttpExceptions'] = true;
  params['payload'] = JSON.stringify(data);

  var response = UrlFetchApp.fetch(url, params);

  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();

  Logger.log(responseCode);
  Logger.log(responseBody);

  var results = false;
  if (responseCode == 200){
    responseJson = JSON.parse(responseBody);
    results = responseJson['results'];
    if (responseJson['has_more'] === true){
      data['start_cursor'] = responseJson['next_cursor'];
      params['payload'] = JSON.stringify(data);
      next_results = send_http_request_anptr(url, data, params, email, constants);
      results = results.concat(next_results); 
    }
  } else {
    send_email(email, 'Notion API Failed When Adding New People to Rota', 'Notion does not seem to be responding. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody, constants  );
  }
  return results;
}

