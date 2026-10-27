// Minimal Notion API client. Throws on errors so callers fail loudly (and the trigger emails the organiser).

const NOTION_VERSION = '2022-06-28';

function notion_request(method, path, payload, constants){
  var params = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + constants['notion_token'],
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    }
  };
  if (payload) params.payload = JSON.stringify(payload);
  for (var attempt = 0; attempt < 4; attempt++){
    var response;
    try {
      response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, params);
    } catch (e) {
      // network hiccups ("Address unavailable", timeouts) come as exceptions: wait and try again
      if (attempt === 3) throw e;
      Utilities.sleep(2000 * (attempt + 1));
      continue;
    }
    var code = response.getResponseCode();
    if (code === 429 || code >= 500){
      Utilities.sleep(1000 * (attempt + 1));
      continue;
    }
    if (code !== 200){
      throw new Error('Notion ' + method + ' ' + path + ' failed (' + code + '): ' + response.getContentText().slice(0, 500));
    }
    return JSON.parse(response.getContentText());
  }
  throw new Error('Notion ' + method + ' ' + path + ' kept failing (rate limit or server error)');
}

function notion_query(db_id, filter, sorts, constants){
  var results = [];
  var body = {page_size: 100};
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  while (true){
    var page = notion_request('post', 'databases/' + db_id + '/query', body, constants);
    results = results.concat(page.results);
    if (!page.has_more) break;
    body.start_cursor = page.next_cursor;
  }
  return results;
}

function notion_get_page(page_id, constants){
  return notion_request('get', 'pages/' + page_id, null, constants);
}

function notion_patch_page(page_id, properties, constants){
  return notion_request('patch', 'pages/' + page_id, {properties: properties}, constants);
}

function notion_get_database(db_id, constants){
  return notion_request('get', 'databases/' + db_id, null, constants);
}

function plain_text(prop){
  if (!prop) return '';
  var parts = prop.title || prop.rich_text || [];
  return parts.map(function(t){ return t.plain_text; }).join('');
}

function normalise_id(id){
  return String(id).replace(/-/g, '').toLowerCase();
}

function hyphenate_id(id){
  id = normalise_id(id);
  return id.slice(0, 8) + '-' + id.slice(8, 12) + '-' + id.slice(12, 16) + '-' + id.slice(16, 20) + '-' + id.slice(20);
}

// Notion page URLs end in "<Title-Words>-<32 hex id>", possibly followed by a query string
function id_from_notion_url(url){
  var last = String(url).split('?')[0].split('/').pop();
  var tail = last.split('-').pop();
  return /^[0-9a-f]{32}$/i.test(tail) ? tail.toLowerCase() : '';
}
