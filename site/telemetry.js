// Anonymous diagnostics for the Rotas site and the tea page (see privacy.html): how long each call to the tea bot
// takes and whether it worked, which page is open (its name only), and script errors. No names, person ids,
// codes, email addresses or page addresses are sent. The visit id is random per page load and kept nowhere, so
// visits can't be linked. Nothing is sent from browsers with Do Not Track or Global Privacy Control on, after
// opting out on the privacy page, or when the page runs locally. The bot keeps the rows for 30 days
// (apps-script/automation/Telemetry.js).
(function(){
  'use strict';
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxjB4wiJ-jluRobucTdMruvxRofOwb1TXVIxgIe_vnPr06t2gg3hybxrV8Rmfp9Ufmx/exec';
  var OPT_OUT = 'gatsby-telemetry';
  var MAX_EVENTS = 120;   // per page load
  var me = document.currentScript;
  var page = (me && me.getAttribute('data-page')) || '';
  var version = (me && me.getAttribute('data-version')) || '';

  function optedOut(){ try { return localStorage.getItem(OPT_OUT) === 'off'; } catch (e) { return false; } }
  function blockedBy(){
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return 'local';
    if (navigator.globalPrivacyControl === true) return 'gpc';
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return 'dnt';
    if (optedOut()) return 'opted-out';
    return '';
  }

  function browser(){
    var ua = navigator.userAgent, m;
    if ((m = ua.match(/Edg\/(\d+)/))) return 'Edge ' + m[1];
    if ((m = ua.match(/OPR\/(\d+)/))) return 'Opera ' + m[1];
    if ((m = ua.match(/Firefox\/(\d+)/))) return 'Firefox ' + m[1];
    if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) return 'Chrome ' + m[1];
    if ((m = ua.match(/Version\/(\d+)[.\d]* .*Safari/))) return 'Safari ' + m[1];
    return 'other';
  }
  function system(){
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return 'other';
  }
  function screenClass(){ var w = window.innerWidth || 0; return w < 600 ? 'phone' : w < 1000 ? 'tablet' : 'desktop'; }

  // ids, codes, addresses and query strings never leave the browser
  function scrub(text){
    return String(text == null ? '' : text)
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
      .replace(/https?:\/\/[^\s"')]+/g, function(u){ return u.split(/[?#]/)[0]; })
      .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
      .slice(0, 300);
  }

  var visit = Math.random().toString(36).slice(2, 10);
  var queue = [], sent = 0, signedIn = '', timer = null;

  function push(e){
    if (blockedBy() || sent + queue.length >= MAX_EVENTS) return;
    queue.push(e);
    if (e.k === 'error' || (e.o && e.o !== 'ok')) later(4000);
    else if (queue.length >= 30) flush();
  }
  function later(ms){ if (!timer) timer = setTimeout(function(){ timer = null; flush(); }, ms); }
  function flush(){
    if (!queue.length || blockedBy()) { queue = []; return; }
    var body = JSON.stringify({fn: 'api_telemetry', args: [{s: visit, p: page, b: browser(), os: system(), w: screenClass(), v: version, u: signedIn, ev: queue}]});
    sent += queue.length;
    queue = [];
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
    } catch (e) { /* fall through */ }
    try { fetch(ENDPOINT, {method: 'POST', body: body, mode: 'no-cors', credentials: 'omit', keepalive: true}); } catch (e) { /* lost: fine */ }
  }

  document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('error', function(ev){
    var file = String(ev.filename || '').split(/[?#]/)[0].split('/').pop();
    push({k: 'error', n: 'script', d: scrub((ev.message || 'error') + (file ? ' @ ' + file + ':' + ev.lineno + ':' + ev.colno : ''))});
  });
  window.addEventListener('unhandledrejection', function(ev){
    var r = ev.reason;
    push({k: 'error', n: 'promise', d: scrub(r && r.message ? r.message : r)});
  });

  window.GatsbyTelemetry = {
    // one call to the tea bot, per attempt. outcome: ok | error (the bot said no) | timeout | network | gave up
    call: function(fn, ms, outcome, attempt, detail){
      if (fn === 'api_telemetry') return;
      push({k: 'call', n: String(fn).slice(0, 40), ms: Math.round(ms), o: outcome, a: attempt || 1, d: outcome === 'ok' ? '' : scrub(detail)});
    },
    // which page or view is open: a fixed name ("home", "tnjc", "slot", "personal"…), never an id
    view: function(name){ push({k: 'view', n: String(name || '').replace(/[^\w-]/g, '').slice(0, 40)}); },
    // member | reader | no
    signedIn: function(kind){ signedIn = kind; },
    error: function(name, detail){ push({k: 'error', n: String(name || '').slice(0, 40), d: scrub(detail)}); },
    blockedBy: blockedBy,
    optOut: function(off){ try { if (off) localStorage.setItem(OPT_OUT, 'off'); else localStorage.removeItem(OPT_OUT); } catch (e) { /* storage blocked */ } if (off) queue = []; }
  };
})();
