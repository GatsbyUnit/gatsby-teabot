// Diagnostics from the site and the tea page (site/telemetry.js), for debugging: how long the bot's answers take,
// which calls fail or never arrive, and script errors in the browser. Anonymous: no names, person ids, codes,
// addresses or page addresses; a visit id that is random per page load (not stored in the browser), so visits
// can't be linked to each other. Rows go to the "Telemetry" tab of the log spreadsheet and are deleted after
// TELEMETRY_DAYS days (telemetry_prune, from the daily job). Browsers with Do Not Track / Global Privacy Control,
// or that opted out on the privacy page, send nothing. Anyone can call api_telemetry, so it is capped.

const TELEMETRY_TAB = 'Telemetry';
const TELEMETRY_DAYS = 30;
const TELEMETRY_MAX_EVENTS = 40;     // per call
const TELEMETRY_PER_MINUTE = 300;    // rows, all visitors together
const TELEMETRY_PER_DAY = 5000;
const TELEMETRY_HEADER = ['When', 'Visit', 'Page', 'Kind', 'Name', 'ms', 'Outcome', 'Attempt', 'Detail', 'Browser', 'System', 'Screen', 'Version', 'Signed in'];
const TELEMETRY_KINDS = ['view', 'call', 'error', 'slow'];
const TELEMETRY_OUTCOMES = ['ok', 'error', 'timeout', 'network', 'gave up', ''];

function api_telemetry(batch){
  try {
    var rows = telemetry_rows(batch, new Date());
    if (rows.length && telemetry_allow(rows.length)) telemetry_append(rows);
  } catch (err) {
    Logger.log('telemetry: ' + err);
  }
  return true;
}

// the batch as sheet rows, every field checked and cut to size; [] if it doesn't look like ours
function telemetry_rows(batch, now){
  if (!batch || typeof batch !== 'object' || !Array.isArray(batch.ev)) return [];
  var visit = /^[0-9a-z]{6,12}$/.test(batch.s || '') ? batch.s : '';
  var page = ['tea', 'rotas', 'privacy'].indexOf(batch.p) >= 0 ? batch.p : '';
  if (!visit || !page) return [];
  var word = function(v, n){ return String(v == null ? '' : v).replace(/[^\w .:\/\-()]/g, '').slice(0, n); };
  var common = [word(batch.b, 24), word(batch.os, 16), word(batch.w, 12), word(batch.v, 12), ['member', 'reader', 'no'].indexOf(batch.u) >= 0 ? batch.u : ''];
  return batch.ev.slice(0, TELEMETRY_MAX_EVENTS).filter(function(e){
    return e && TELEMETRY_KINDS.indexOf(e.k) >= 0;
  }).map(function(e){
    var ms = Number(e.ms);
    return [now, visit, page, e.k, word(e.n, 40), isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), 600000) : '',
            TELEMETRY_OUTCOMES.indexOf(e.o || '') >= 0 ? (e.o || '') : '', Number(e.a) >= 1 && Number(e.a) <= 9 ? Number(e.a) : '',
            telemetry_scrub(e.d)].concat(common);
  });
}

// the second line of defence (the browser scrubs too): ids, codes, addresses and links out, 300 characters
function telemetry_scrub(text){
  return String(text == null ? '' : text)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/https?:\/\/[^\s"')]+/g, function(u){ return u.split(/[?#]/)[0]; })
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .slice(0, 300);
}

function telemetry_allow(n){
  var cache = CacheService.getScriptCache();
  var now = new Date();
  var keys = ['telemetry:m:' + Math.floor(now.getTime() / 60000), 'telemetry:d:' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd')];
  var limits = [TELEMETRY_PER_MINUTE, TELEMETRY_PER_DAY];
  var counts = keys.map(function(k){ return Number(cache.get(k) || 0); });
  if (counts[0] + n > limits[0] || counts[1] + n > limits[1]) return false;
  cache.put(keys[0], String(counts[0] + n), 120);
  cache.put(keys[1], String(counts[1] + n), 6 * 3600);
  return true;
}

function telemetry_sheet(){
  var ss = ensure_log_sheet();
  var sheet = ss.getSheetByName(TELEMETRY_TAB);
  if (!sheet){
    sheet = ss.insertSheet(TELEMETRY_TAB);
    sheet.appendRow(TELEMETRY_HEADER);
    sheet.setFrozenRows(1);
    guard_sheet(sheet);
  }
  return sheet;
}

function telemetry_append(rows){
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var sheet = telemetry_sheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

// daily: rows older than TELEMETRY_DAYS go (they are appended in time order)
function telemetry_prune(){
  var sheet = ensure_log_sheet().getSheetByName(TELEMETRY_TAB);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var cutoff = Date.now() - TELEMETRY_DAYS * 864e5;
  var when = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var old = 0;
  while (old < when.length && new Date(when[old][0]).getTime() < cutoff) old++;
  if (old === when.length) sheet.getRange(2, 1, old, sheet.getLastColumn()).clearContent();
  else if (old) sheet.deleteRows(2, old);
  return old;
}
