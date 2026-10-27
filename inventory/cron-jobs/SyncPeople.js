// this function periodically syncs current people in Notion with Google, by
// 1. making sure that all active people in Notion have a corresponding away date sheet
// 2. making sure that all active people appear in the notion email mapping sheet
// 3. saving the current list of people to old format

function sync_people_wrapper() {
  const constants = get_global_constants();
  var admin_email = constants['admin_email'];

  try{
    sync_people(admin_email, constants);
  } catch (err) {
    send_email(admin_email, 'Urgent: Unknown Error When Saving People to Old Format', 'Error message:\n\n' + err, constants );
    throw err;
  }

}

function sync_people(admin_email, constants){
  // constants
  const notion_token = constants['notion_token'];
  const people_db_id = constants['notion_people_db_id'];
  const names_file_id = constants['old_format_names_file_id'];
  const research_talk_people_file_id = constants['old_format_research_talk_people_file_id'];
  const tea_talk_people_file_id = constants['old_format_tea_talk_people_file_id'];
  const tea_people_file_id = constants['old_format_tea_people_file_id'];
  const swc_cluster_bot_email = constants['swc_cluster_bot_email'];

  /* check files */
  var names_file = null; var rt_file = null; var tt_file = null; var t_file = null;
  try {
    names_file = DriveApp.getFileById(names_file_id);
  } catch (err) {
    send_email(admin_email, 'Names file not found in Drive when saving people to old format', 'If you have uploaded another names file, please update the names_file_id constant in the script in Gatsby Tea Cron Jobs. \n \n Error Code: ' + err, constants);
    return;    
  }

  try {
    rt_file = DriveApp.getFileById(research_talk_people_file_id);
  } catch (err) {
    send_email(admin_email, 'Researchpeople file not found in Drive when saving people to old format', 'If you have uploaded another researchpeople file, please update the names_file_id constant in the script in Gatsby Tea Cron Jobs. \n \n Error Code: ' + err, constants);
    return;    
  }
  
  try {
    tt_file = DriveApp.getFileById(tea_talk_people_file_id);
  } catch (err) {
    send_email(admin_email, 'Talkpeople file not found in Drive when saving people to old format', 'If you have uploaded another talkpeople file, please update the names_file_id constant in the script in Gatsby Tea Cron Jobs. \n \n Error Code: ' + err, constants);
    return;    
  }

  try {
    t_file = DriveApp.getFileById(tea_people_file_id);
  } catch (err) {
    send_email(admin_email, 'Teapeople file not found in Drive when saving people to old format', 'If you have uploaded another teapeople file, please update the tea_people_file_id constant in the script in Gatsby Tea Cron Jobs. \n \n Error Code: ' + err, constants);
    return;    
  }

  /* get people from notion */
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'post'
  };
  var people = send_http_request_sp('https://api.notion.com/v1/databases/' + people_db_id + '/query', 
              {"sorts": [ { "property": "Name",  "direction": "ascending" } ] }, params, admin_email, constants);
  if (people === false) { return; } 

  /* perform actions */
  sync_identity_sheet(people, admin_email, constants);
  sync_away_date_sheets(swc_cluster_bot_email, people, admin_email, notion_token, constants);
  fill_in_name_files(people, admin_email, names_file, rt_file, tt_file, t_file, constants);
}

function sync_identity_sheet(people, admin_email, constants){
  const mapping_sheet_id = constants['identity_mapping_id'];
  var mapping_sheet = SpreadsheetApp.openById(mapping_sheet_id).getSheets()[0];
  var sheet_values = mapping_sheet.getRange('A:C').getValues();

  // set people's found status to be false
  for (var p=0; p<people.length; p=p+1){
    // TEMP
    people[p]['found_in_mapping_sheet'] = false;
    people[p]['eligible_for_mapping_sheet'] = false;

    var text_response = people[p]['properties']['Name']['title'];
    var active = people[p]['properties']['Active']['checkbox'];

    if ( active === false ){
      continue; // skip if inactive
    }

    if ( text_response.length > 0){
      if ( !('text' in text_response[0]) ){
        continue; // skip if missing name
      }
    } else {
      continue;  // skip if missing name
    }
    
    // only include valid people
    people[p]['eligible_for_mapping_sheet'] = true;
  }
   
  // go through the entire sheet and check whether each row corresponds to an active person
  // rows are 1-indexing but sheet_values is 0-indexing; start from i=0 so that we don't care about the zeroth row of sheet_values
    // go through the entire sheet and check whether each row corresponds to an active person
  var i = 1;
  var deleted_count = 0;

  while (sheet_values[i] && sheet_values[i][0] != '') {
    var found_person = false;

    var sheet_url = sheet_values[i][0];
    var sheet_notion_id = notion_id_from_url(sheet_url);
    var current_sheet_row = i + 1 - deleted_count;

    inner_loop:
    for (var p = 0; p < people.length; p = p + 1) {
      if (people[p]['eligible_for_mapping_sheet'] === false) {
        continue;
      }

      var notion_url = people[p]['url'];
      var notion_id = normalise_notion_id(people[p]['id']);

      var same_exact_url = notion_url === sheet_url;
      var same_id_from_old_url =
        sheet_notion_id !== '' && sheet_notion_id === notion_id;

      // Match either:
      // 1. exact old URL
      // 2. Notion page ID extracted from old URL
      if (same_exact_url || same_id_from_old_url) {
        found_person = true;
        people[p]['found_in_mapping_sheet'] = true;

        // Keep column C email untouched.
        // But refresh URL/name so future runs use the current Notion URL.
        var title = get_notion_person_title(people[p]);

        if (notion_url && mapping_sheet.getRange(current_sheet_row, 1).getValue() !== notion_url) {
          mapping_sheet.getRange(current_sheet_row, 1).setValue(notion_url);
        }

        if (title && mapping_sheet.getRange(current_sheet_row, 2).getValue() !== title) {
          mapping_sheet.getRange(current_sheet_row, 2).setValue(title);
        }

        break inner_loop;
      }
    }

    if (found_person == false) {
      // If it doesn't correspond to an active person, delete.
      // This still deletes column C, but only for rows that fail both URL and ID matching.
      mapping_sheet.deleteRow(i + 1 - deleted_count);
      deleted_count++;
    }

    i++;
  }

  // add people who were not found
  var new_people_count = 0;
  for (var p=0; p<people.length; p=p+1){
    if ( people[p]['found_in_mapping_sheet'] === false && people[p]['eligible_for_mapping_sheet'] === true){
      new_people_count++;
    }
  }
  if (new_people_count > 0){ mapping_sheet.insertRows(i + 1 - deleted_count, new_people_count); }
  for (var p=0; p<people.length; p=p+1){
    if ( people[p]['found_in_mapping_sheet'] === false && people[p]['eligible_for_mapping_sheet'] === true){
      var notion_url = people[p]['url'];
      var text_response = people[p]['properties']['Name']['title'];
      var title = "";
      if ( text_response.length > 0){
        if ( 'text' in text_response[0] ){
          title = "";
          for (var ti=0; ti<text_response.length; ti=ti+1){
             title = title + text_response[ti]['text']['content'];
          }
        } else {
          continue; // skip
        }
      } else {
        continue;  // skip
      }
      mapping_sheet.getRange(i + 1 - deleted_count, 1).setValue(notion_url);
      mapping_sheet.getRange(i + 1 - deleted_count, 2).setValue(title);
      i++;
    }
  }

  // email
  send_email(admin_email, 'Synced People with Notion-Email Mapping Sheet', 'Sync successful. ' + new_people_count.toString() + ' people added. '
  + deleted_count.toString() + ' people deleted.', constants );
}

function get_notion_person_title(person) {
  var text_response = person['properties']['Name']['title'];

  if (!text_response || text_response.length === 0) {
    return '';
  }

  var title = '';

  for (var ti = 0; ti < text_response.length; ti = ti + 1) {
    if ('text' in text_response[ti]) {
      title = title + text_response[ti]['text']['content'];
    }
  }

  return title;
}


function normalise_notion_id(id) {
  if (!id) {
    return '';
  }

  return id.toString().replace(/-/g, '').toLowerCase();
}


function notion_id_from_url(url) {
  if (!url) {
    return '';
  }

  var s = url.toString();

  // Hyphenated UUID form:
  // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  var uuidMatches = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g);
  if (uuidMatches && uuidMatches.length > 0) {
    return normalise_notion_id(uuidMatches[uuidMatches.length - 1]);
  }

  // Compact Notion page ID form:
  // 32 hexadecimal characters
  var compactMatches = s.match(/[0-9a-fA-F]{32}/g);
  if (compactMatches && compactMatches.length > 0) {
    return normalise_notion_id(compactMatches[compactMatches.length - 1]);
  }

  return '';
}

function sync_away_date_sheets(swc_cluster_bot_email, people, admin_email, notion_token, constants){
  const mapping_sheet_id = constants['identity_mapping_id'];
  const folder_id = constants['away_dates_folder_id'];
  const template_id = constants['away_dates_sheet_template_id']; 
  const file_name_prefix = '[Gatsby Tea Away Dates] ';
  
  var folder = DriveApp.getFolderById(folder_id);
  var sheets = folder.getFiles();
  var template = DriveApp.getFileById(template_id);

  // set people's found status to be false, and check eligibility
  for (var p=0; p<people.length; p=p+1){
    people[p]['found_in_away_date_folder'] = false;
    people[p]['eligible_for_away_date_folder'] = false;
    
    var text_response = people[p]['properties']['Name']['title'];
    var active = people[p]['properties']['Active']['checkbox'];
    var if_need_away_date_sheet = people[p]['properties']['Away Date Sheet?']['checkbox'];
    var notion_id = people[p]['id'];
    var email = get_email_from_notion_id_vanilla(notion_id, mapping_sheet_id);
    people[p]['email'] = email;

    if ( active === false || if_need_away_date_sheet === false){
      continue; // skip if inactive or do not need away date sheet
    }

    if ( text_response.length > 0){
      if ( !('text' in text_response[0]) ){  continue; /* skip if missing name */ }
    } 
    else {   continue;  /* skip if missing name */ }

    // only generate sheets for valid people that are active and have names
    people[p]['eligible_for_away_date_folder'] = true;
  }

  // remove away sheets for those not eligible
  for (var p=0; p<people.length; p=p+1){
    if (people[p]['eligible_for_away_date_folder'] === false){
      var notion_id = people[p]['id'];
      var away_date_sheet_url = people[p]['properties']['Away Date Sheet']['url'];
      if (away_date_sheet_url){ update_away_date_sheet_url(notion_id, null, admin_email, notion_token, constants); }
    }
  }
   
  // go through the entire folder and check whether each file corresponds to an active person
  var deleted_count = 0;
  while (sheets.hasNext()) {
    var file = sheets.next();
    var sheet = SpreadsheetApp.openById(file.getId()).getSheets()[0];
    var file_name = file.getName();
    var sheet_title = sheet.getRange('F2').getValue();
    var sheet_notion_url = sheet.getRange('H2').getValue();
    var sheet_cluster_id = sheet.getRange('J2').getValue();

    var found_person = false;

    inner_loop:
    for (var p=0; p<people.length; p=p+1){
      // get notion url and verify that this is a valid person
      var notion_id = people[p]['id'];
      var notion_url = people[p]['url'];
      var text_response = people[p]['properties']['Name']['title'];
      var active = people[p]['properties']['Active']['checkbox'];
      var email = people[p]['email'];
      var away_date_sheet_url = people[p]['properties']['Away Date Sheet']['url'];

      if ( active === false ){
        continue; // skip if inactive
      }

      if ( text_response.length > 0){
        if ( 'text' in text_response[0] ){
          var title = text_response[0]['text']['content'];
        } else {
          continue; // skip
        }
      } else {
        continue;  // skip
      }

      var text_response = people[p]['properties']['Cluster ID']['rich_text'];
      if ( text_response.length > 0){
        if ( 'text' in text_response[0] ){
          var cluster_id = text_response[0]['text']['content'];
        } else {
          var cluster_id = "MISSING";
        }
      } else {
        var cluster_id =  "MISSING";
      }

      // check if the file corresponds to the person
      if ( notion_url === sheet_notion_url ){
        found_person = true;
        people[p]['found_in_away_date_folder'] = true;

        // update info if different
        if (file_name != file_name_prefix + title) { file.setName(file_name_prefix + title); }
        if (sheet_title != title) { sheet.getRange('F2').setValue(title); }
        if (sheet_notion_url != notion_url) { sheet.getRange('H2').setValue(notion_url); }
        if (sheet_cluster_id != cluster_id) { sheet.getRange('J2').setValue(cluster_id); }
        if ( email !== false ) {
          if ( !check_email_in_user_array(email, file.getEditors())) { file.addEditor(email); }
        }
        if (away_date_sheet_url !== file.getUrl()){ update_away_date_sheet_url(notion_id, file.getUrl(), admin_email, notion_token, constants);  }
        break inner_loop;
      }
    }

    if ( found_person == false){ // if doesn't correspond to an active person, trash the sheet
      file.setTrashed(true);
      deleted_count++;
    }
  }

  // add people who were not found
  var new_people_count = 0;
  for (var p=0; p<people.length; p=p+1){
    if ( people[p]['found_in_away_date_folder'] === false && people[p]['eligible_for_away_date_folder'] === true){
      new_people_count++;
    }
  }

  for (var p=0; p<people.length; p=p+1){
    if ( people[p]['found_in_away_date_folder'] === false && people[p]['eligible_for_away_date_folder'] === true){
      var notion_id = people[p]['id'];
      var notion_url = people[p]['url'];
      var email = people[p]['email'];

      var text_response = people[p]['properties']['Name']['title'];
      if ( text_response.length > 0){
        if ( 'text' in text_response[0] ){
          var title = text_response[0]['text']['content'];
        } else {
          continue; // skip
        }
      } else {
        continue;  // skip
      }

      var text_response = people[p]['properties']['Cluster ID']['rich_text'];
      if ( text_response.length > 0){
        if ( 'text' in text_response[0] ){
          var cluster_id = text_response[0]['text']['content'];
        } else {
          var cluster_id = "MISSING";
        }
      } else {
        var cluster_id =  "MISSING";
      }

      var new_file = template.makeCopy(file_name_prefix + title, folder);
      var new_sheet = SpreadsheetApp.openById(new_file.getId()).getSheets()[0];
      
      new_sheet.getRange('F2').setValue(title);
      new_sheet.getRange('H2').setValue(notion_url);
      new_sheet.getRange('J2').setValue(cluster_id);
      if ( email!== false ) { new_file.addEditor(email); }
      new_file.addEditor(swc_cluster_bot_email); /* this is so that people can still update from the cluster */
      update_away_date_sheet_url(notion_id, new_file.getUrl(), admin_email, notion_token, constants); 
    }
  }

  // email
  send_email(admin_email, 'Synced People with Away Date Sheets', 'Sync successful. ' + new_people_count.toString() + ' people added. '
  + deleted_count.toString() + ' people deleted.', constants );
}


function fill_in_name_files(people, admin_email, names_file, rt_file, tt_file, t_file, constants){
  var names_ls = [];
  var rt_fac = []; var rt_postdoc = []; var rt_student = {}; var rt_staff = []; var rt_visitor = [];  // research talk
  var tt_fac = []; var tt_postdoc = []; var tt_student = {}; var tt_staff = []; var tt_visitor = []; // tea talk
  var t_fac = [];  var t_postdoc = [];  var t_student = {};  var t_staff = [];  var t_visitor = [];    // tea
  
  /* loop through everyone, identify whether they are faculty, postdoc, student, staff or visitor, and add them to list according to their duties */
  for (var p=0; p<people.length; p=p+1){
    var text_response = people[p]['properties']['Name']['title'];
    if ( text_response.length > 0){
      if ( 'text' in text_response[0] ){
        var title = text_response[0]['text']['content'];
      } else {
        continue; // skip
      }
    } else {
      continue;  // skip
    }
    var text_response = people[p]['properties']['Cluster ID']['rich_text'];
    if ( text_response.length > 0){
      if ( 'text' in text_response[0] ){
        var cluster_id = text_response[0]['text']['content'];
      } else {
        var cluster_id = "#" + title + "-[NO CLUSTER ID]-#";
      }
    } else {
      var cluster_id =  "#" + title + "-[NO CLUSTER ID]-#";
    }
    
    var active = people[p]['properties']['Active']['checkbox'];
    var exc_research_talk = people[p]['properties']['Excluded from research talk']['checkbox'];
    var exc_tea_talk = people[p]['properties']['Excluded from tea talk']['checkbox'];
    var exc_tea = people[p]['properties']['Excluded from tea']['checkbox'];
    var position_select = people[p]['properties']['Position']['select'];

    var position_select = people[p]['properties']['Position']['select'];
    if (position_select === null && active === true) {
      throw new Error(
        'Missing Position for "' + title + '". Notion page: ' + people[p]['url']
      );
    }
    var position = position_select === null ? '' : position_select['name'];
    
    var date_obj = null; var date_int = 0;

    // add to names file
    names_ls.push(title + "\t" + cluster_id);

    // add to relevant files
    var status_clusterid = cluster_id;
    if (active === false){
      status_clusterid = "#" + status_clusterid;
    }

    if (exc_research_talk === false){
      if (position == "Faculty"){
        rt_fac.push(status_clusterid);
      } else if (position == "Postdoc"){
        rt_postdoc.push(status_clusterid);
      } else if (position == "PhD student"){
        date_obj = people[p]['properties']['Join Date']['date'];
        date_int = 0;
        if ( date_obj !== null){
          if ( 'start' in date_obj ){
            date_int = new Date(date_obj['start']).getFullYear();
          } 
        }
        if ( date_int in rt_student){
          rt_student[date_int].push(status_clusterid);
        } else {
          rt_student[date_int] = [status_clusterid];
        }
      } else if (position == "Staff"){
        rt_staff.push(status_clusterid);
      } else if (position == "Visitor"){
        rt_visitor.push(status_clusterid);
      }
    }

    if (exc_tea_talk === false){
      if (position == "Faculty"){
        tt_fac.push(status_clusterid);
      } else if (position == "Postdoc"){
        tt_postdoc.push(status_clusterid);
      } else if (position == "PhD student"){
        date_obj = people[p]['properties']['Join Date']['date'];
        date_int = 0;
        if ( date_obj !== null){
          if ( 'start' in date_obj ){
            date_int = new Date(date_obj['start']).getFullYear();
          } 
        }
        if ( date_int in tt_student){
          tt_student[date_int].push(status_clusterid);
        } else {
          tt_student[date_int] = [status_clusterid];
        }
      } else if (position == "Staff"){
        tt_staff.push(status_clusterid);
      } else if (position == "Visitor"){
        tt_visitor.push(status_clusterid);
      }
    }

    if (exc_tea === false){
      if (position == "Faculty"){
        t_fac.push(status_clusterid);
      } else if (position == "Postdoc"){
        t_postdoc.push(status_clusterid);
      } else if (position == "PhD student"){
        date_obj = people[p]['properties']['Join Date']['date'];
        date_int = 0;
        if ( date_obj !== null){
          if ( 'start' in date_obj ){
            date_int = new Date(date_obj['start']).getFullYear();
          } 
        }
        if ( date_int in t_student){
          t_student[date_int].push(status_clusterid);
        } else {
          t_student[date_int] = [status_clusterid];
        }
      } else if (position == "Staff"){
        t_staff.push(status_clusterid);
      } else if (position == "Visitor"){
        t_visitor.push(status_clusterid);
      }
    }
    
  }
  
  /* concatenate */
  var names_str = names_ls.join("\n");
  var rt_str = form_people_str("# add new post-docs 6 months after joining\n# add new phd 1 year after joining", rt_fac, rt_postdoc, rt_student, rt_staff, rt_visitor);
  var tt_str = form_people_str("# add new post-docs 4 months after joining\n# add new phds in 6 months after joining", tt_fac, tt_postdoc, tt_student, tt_staff, tt_visitor);
  var t_str = form_people_str("# add new post-docs 3 months after joining\n# add new phds in 6 months after joining", t_fac, t_postdoc, t_student, t_staff, t_visitor);

  /* write */
  names_file.setContent(names_str);
  rt_file.setContent(rt_str);
  tt_file.setContent(tt_str);
  t_file.setContent(t_str);

  send_email(admin_email, 'Saved People to Old Format Success', 'Saved people to old format successful.', constants);
}

function form_people_str(forewords, fac, postdoc, student_dict, staff, visitor){
  var people_str = forewords + "\n#=============== FACULTY\n" + fac.join("\n") + "\n\n#=============== POSTDOCS\n" + postdoc.join("\n") + "\n\n#=============== STUDENTS\n";
  var student_arr = [];
  for (var date_int in student_dict){
    student_arr.push({"cohort": date_int, "students": student_dict[date_int]} );
  }
  student_arr.sort(function(a,b){return a["cohort"] > b["cohort"] ? 1 : -1;});
  for (var i=0; i<student_arr.length; i=i+1){
    if (student_arr[i]["cohort"] == 0){
      people_str = people_str + "\n" + student_arr[i]["students"].join("\n") + "\n";
    } else {
      people_str = people_str + "\n#-------------- " + student_arr[i]["cohort"].toString() + " intake\n" + student_arr[i]["students"].join("\n") + "\n";
    }
  }
  people_str = people_str + "\n#=============== STAFF\n" + staff.join("\n") + "\n\n#=============== VISITOR\n" + visitor.join("\n");
  return people_str;
}


function send_http_request_sp(url, data, params, email, constants){
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
      next_results = send_http_request_sp(url, data, params, email, constants);
      results = results.concat(next_results); 
    }
  } else {
    send_email(email, 'Notion API Failed When Syncing People', 'Notion does not seem to be responding. \n\nResponse Code: ' + responseCode + '\n\nResponse Body: ' + responseBody, constants  );
  }
  return results;
}

function update_away_date_sheet_url(notion_id, url, admin_email, notion_token, constants){
  var data = {
    'properties': {
      'Away Date Sheet': { 'url': url }
    }
  };
  var params = {
    'headers':{
      'Authorization': 'Bearer ' + notion_token + '',
      'Content-Type' : 'application/json',
      'Notion-Version': '2021-08-16'
    },
    'method' : 'patch'
  };
  results = send_http_request_sp('https://api.notion.com/v1/pages/' + notion_id, data, params, admin_email, constants);  
  if ( results === false ){ 
    send_email(admin_email, 'SyncPeople: Failed to update away date url for notion_id ' + notion_id, constants);
  }
}