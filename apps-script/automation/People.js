// People come from the Notion People database; registered emails come from the identity sheet
// (column A = Notion URL, B = name, C = email), which the old Cron Jobs keep in sync.

const PEOPLE_CACHE_KEY = 'people:v4';

function load_people(constants){
  var cache = CacheService.getScriptCache();
  var cached = cache.get(PEOPLE_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  // all people, inactive included, so that older slots still resolve to names
  var pages = notion_query(constants['notion_people_db_id'], null, null, constants);
  var emails = load_identity_emails(constants);
  var people = {};
  pages.forEach(function(p){
    var id = normalise_id(p.id);
    var props = p.properties;
    people[id] = {
      id: id,
      name: plain_text(props['Name']).trim(),
      active: !!(props['Active'] && props['Active'].checkbox),
      tnjc: !!(props['TNJC'] && props['TNJC'].checkbox),
      csnjc: !!(props['CSNJC'] && props['CSNJC'].checkbox),
      mljc: !!(props['MLJC'] && props['MLJC'].checkbox),
      coffee: !!(props['Coffee'] && props['Coffee'].checkbox),
      position: props['Position'] && props['Position'].select ? props['Position'].select.name : '',
      tea_excluded: !!(props['Excluded from tea'] && props['Excluded from tea'].checkbox),
      tt_excluded: !!(props['Excluded from tea talk'] && props['Excluded from tea talk'].checkbox),
      rt_excluded: !!(props['Excluded from research talk'] && props['Excluded from research talk'].checkbox),
      away_sheet: props['Away Date Sheet'] && props['Away Date Sheet'].url ? props['Away Date Sheet'].url : '',
      away_calendar: emails[id] ? emails[id].away_calendar : '',
      email: emails[id] ? emails[id].email : ''
    };
  });
  try { cache.put(PEOPLE_CACHE_KEY, JSON.stringify(people), 300); } catch (e) { /* too big for the cache: just reload next time */ }
  return people;
}

// {notion id: {email, away_calendar}} from the identity sheet (A = Notion URL, C = email, E = away calendar)
function load_identity_emails(constants){
  var values = SpreadsheetApp.openById(constants['identity_mapping_id']).getSheets()[0].getRange('A:E').getValues();
  var out = {};
  for (var i = 1; i < values.length; i++){
    if (!values[i][0]) continue;
    var id = id_from_notion_url(values[i][0]);
    var email = String(values[i][2]).trim();
    if (id && email) out[id] = {email: email, away_calendar: String(values[i][4] || '').trim()};
  }
  return out;
}

function normalise_name(name){
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Matches a name typed into a calendar event to a registered person, tolerating accents, typos,
// first-name-only and initials. Active people are preferred; inactive ones are only considered when no
// active person is plausible. Returns {status, person, score, candidates}:
//   'match'      one person, score >= MATCH_CONFIDENT and clearly ahead of the runner-up
//   'uncertain'  someone is plausible (>= MATCH_POSSIBLE) but not confidently one person
//   'none'       nobody close: probably a guest
const MATCH_CONFIDENT = 0.9;
const MATCH_POSSIBLE = 0.8;
const MATCH_MARGIN = 0.05;

function match_name(name, people){
  var q = normalise_name(name);
  var everyone = Object.keys(people).map(function(id){ return people[id]; }).filter(function(p){ return p.name; });
  var score_all = function(list){
    return list.map(function(p){ return {person: p, score: name_score(q, normalise_name(p.name))}; })
      .sort(function(a, b){ return b.score - a.score; });
  };
  var scored = score_all(everyone.filter(function(p){ return p.active; }));
  if (!scored.length || scored[0].score < MATCH_POSSIBLE) scored = score_all(everyone);
  var candidates = scored.filter(function(s){ return s.score >= MATCH_POSSIBLE; }).slice(0, 3);
  var best = scored[0];
  var second = scored[1];
  if (best && best.score >= MATCH_CONFIDENT && (!second || best.score - second.score >= MATCH_MARGIN)){
    return {status: 'match', person: best.person, score: best.score, candidates: candidates};
  }
  if (candidates.length > 0) return {status: 'uncertain', person: null, score: best.score, candidates: candidates};
  return {status: 'none', person: null, score: best ? best.score : 0, candidates: []};
}

// 1 = same name. Compares first and last names separately (surname weighted higher), so a shared
// first name alone never makes a match.
function name_score(q, c){
  if (q === c) return 1;
  var qt = q.split(' ');
  var ct = c.split(' ');
  var q_first = qt[0], q_last = qt[qt.length - 1], c_first = ct[0], c_last = ct[ct.length - 1];
  if (qt.length === 1) return (q_first === c_first || q_first === c_last) ? 0.92 : 0.9 * jaro_winkler(q_first, c_first);
  if (q_first.length === 1) return (q_first === c_first[0] && q_last === c_last) ? 0.93 : 0.5 * jaro_winkler(q_last, c_last);
  if (q_first === c_first && q_last === c_last) return 0.97;  // middle names differ
  var f = jaro_winkler(q_first, c_first);
  var l = jaro_winkler(q_last, c_last);
  var score = 0.4 * f + 0.6 * l;
  // a clearly different first or last name ("Jon" vs "Jan") is at most 'uncertain', never a match
  return (f < 0.85 || l < 0.85) ? Math.min(score, MATCH_CONFIDENT - 0.01) : score;
}

function jaro_winkler(a, b){
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  var range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  var a_hit = [], b_hit = [], matches = 0;
  for (var i = 0; i < a.length; i++){
    for (var j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++){
      if (!b_hit[j] && a[i] === b[j]){ a_hit[i] = b_hit[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  var t = 0, k = 0;
  for (var i = 0; i < a.length; i++){
    if (!a_hit[i]) continue;
    while (!b_hit[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  var jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  var prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function names_of(ids, people){
  return ids.map(function(id){ return people[id] ? people[id].name : '(unknown)'; });
}

function emails_of(ids, people){
  return ids.map(function(id){ return people[id] ? people[id].email : ''; }).filter(function(e){ return e !== ''; });
}
