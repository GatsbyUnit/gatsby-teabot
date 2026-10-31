// Gatsby Rotas: the unit's talk, tea and coffee rotas and the guides to them, at site/rotas/ next to the tea
// page. The tea bot (apps-script/automation/Site.js) keeps the pages and reads the rota data live from Notion;
// tsars edit both here (edit.js). No build step.
'use strict';

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const CONFIG = {
  // the tea page's back end (apps-script/page); locally, the stand-in from gatsby-rotas/tools/dev_server.py
  api: LOCAL ? 'api' : 'https://script.google.com/macros/s/AKfycbxjB4wiJ-jluRobucTdMruvxRofOwb1TXVIxgIe_vnPr06t2gg3hybxrV8Rmfp9Ufmx/exec',
  teaPage: '../',
  notionSite: 'https://gcnu.notion.site/',
  rememberDays: 182,
  timeZone: 'Europe/London',
};

const NAV = [
  { slug: 'home', label: 'Rotas' },
  { slug: 'tea-system', label: 'Tea System' },
  { slug: 'tnjc', label: 'TNJC' },
  { slug: 'mljc', label: 'MLJC' },
  { slug: 'coffee', label: 'Coffee' },
];

const TYPES = {
  'Research Talk': { cls: 'research', label: 'Research Talk', talk: true },
  'Tea Talk': { cls: 'tea-talk', label: 'Tea Talk', talk: true },
  'External Seminar': { cls: 'external', label: 'External Seminar', talk: true },
  'Leaving Tea': { cls: 'leaving', label: 'Leaving Tea', talk: true },
  'Just Tea': { cls: 'just-tea', label: 'Just Tea' },
  'MLJC': { cls: 'mljc', label: 'MLJC', talk: true },
  'TNJC': { cls: 'tnjc', label: 'TNJC', talk: true },
  'Coffee Cleaning': { cls: 'coffee', label: 'Coffee' },
};
const UNIT_WIDE = ['Research Talk', 'Tea Talk', 'External Seminar', 'Leaving Tea', 'Just Tea'];

const params = new URLSearchParams(location.search);
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function href(query = {}, hash = '') {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v && !(k === 'p' && v === 'home')) q.set(k, v);
  if (params.get('mode')) q.set('mode', params.get('mode'));
  const s = q.toString();
  return (s ? '?' + s : './') + (hash ? '#' + hash : '');
}
const pageHref = (slug, hash) => href({ p: slug }, hash);
const personHref = (id) => href({ person: id });

// ---------- signing in ----------
// The bot hands out pages and data only for the unit key (PAGE_KEY) or a member's own token. A browser gets
// them from the emailed sign-in link (?signin=), a personal tea-page link (?t=), a general link (?k=), or the
// tea page's own memory of its visitor, and keeps them for six months.

const SESSION = 'gatsby-rotas';
const CACHE = 'gatsby-rotas-cache';
const TEA_PAGE_MEMORY = 'gatsby-tea-page';
const FRESH_MS = 10 * 60e3; // pages and data are reused for this long, so moving between pages is instant

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private mode: this visit only */ } },
  raw(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  drop(...ks) { try { ks.forEach((k) => localStorage.removeItem(k)); } catch { /* nothing stored */ } },
};
let memorySession = null;

function session() {
  const s = store.get(SESSION) || memorySession;
  return s && (s.key || s.token) && Date.parse(s.until) > Date.now() ? s : null;
}

function remember({ key = '', token = '', person = '', name = '' }) {
  memorySession = { key, token, person, name, until: new Date(Date.now() + CONFIG.rememberDays * 864e5).toISOString() };
  store.set(SESSION, memorySession);
  store.drop(CACHE);
  // one site: "My tea page" then opens this person's page without a code in the address
  if (token) { try { localStorage.setItem(TEA_PAGE_MEMORY, token); } catch { /* fine */ } }
}

function forget() {
  memorySession = null;
  store.drop(SESSION, CACHE);
}

class SignedOut extends Error {}

async function api(fn, ...args) {
  const res = await fetch(CONFIG.api, { method: 'POST', body: JSON.stringify({ fn, args }), credentials: 'omit', redirect: 'follow' });
  const out = await res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
  if (!out.ok) throw new Error(out.error || 'Something went wrong.');
  return out.result;
}

let bundle = null;
async function loadBundle() {
  if (bundle) return bundle;
  const s = session();
  if (!s) throw new SignedOut();
  const cached = store.get(CACHE);
  const usable = cached && cached.who === (s.token || s.key);
  if (usable && Date.now() - cached.at < FRESH_MS) return (bundle = cached.bundle);
  let fresh;
  try {
    fresh = await api('api_site_bundle', s.key, s.token);
  } catch (err) {
    if (usable) return (bundle = cached.bundle); // offline or the bot is down: show what we had
    throw err;
  }
  if (!fresh) { forget(); throw new SignedOut(); }
  return keep(fresh);
}

// after an edit: the new bundle is shown at once and remembered
function keep(b) {
  bundle = b;
  data = null;
  const s = session();
  store.set(CACHE, { who: s && (s.token || s.key), at: Date.now(), bundle: b });
  return b;
}

// ---------- data ----------

let data = null;
function loadData() {
  if (data) return data;
  const d = bundle.data;
  const people = new Map(d.people.map((p) => [p.id, p]));
  const slots = d.schedule.filter((s) => TYPES[s.type]).map((s) => ({
    ...s,
    startDate: new Date(s.start.length === 10 ? s.start + 'T00:00:00' : s.start),
    allDay: s.start.length === 10,
    tentative: /\[[^\]]*tentative\]/i.test(s.title),
    cancelled: /^\s*cancell?ed\b/i.test(s.title),
    cleanTitle: s.title.replace(/\[[^\]]*tentative\]/ig, '').trim(),
  })).sort((a, b) => a.startDate - b.startDate);
  const pageIds = new Map(Object.values(bundle.pages).map((p) => [p.id, p.slug]));
  const blockPages = new Map();
  const walk = (blocks, slug) => (blocks || []).forEach((b) => { blockPages.set(b.id, slug); walk(b.children, slug); });
  Object.values(bundle.pages).forEach((p) => walk(p.blocks, p.slug));
  return (data = { ...d, slots, peopleById: people, pageIds, blockPages });
}

const can = {
  any: () => !!(bundle?.me && (bundle.me.pages || bundle.me.rules || bundle.me.people.length || bundle.me.slots.length)),
};

const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.timeZone, ...opts });
const F = {
  day: fmt({ weekday: 'short' }),
  date: fmt({ day: 'numeric', month: 'short' }),
  full: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
  time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
  month: fmt({ month: 'long', year: 'numeric' }),
  key: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }),
  stamp: fmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
};
const dayKey = (d) => F.key.format(d).split('/').reverse().join('-'); // YYYY-MM-DD in London
const todayKey = () => dayKey(new Date());
function mondayOf(key) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const keyDate = (key) => new Date(key + 'T12:00:00Z');

// ---------- page content ----------

// A Notion address -> where it goes here: our pages and people stay on the site, other pages open on Notion.
function resolveHref(url) {
  const u = String(url || '');
  const ids = u.replace(/-/g, '').match(/[0-9a-f]{32}/g);
  if (!ids || !/^(\/|https?:\/\/([\w-]+\.)?notion\.(so|site))/.test(u)) return u;
  const anchor = (u.split('#')[1] || '').replace(/-/g, '');
  const id = u.includes('#') ? u.split('#')[0].replace(/-/g, '').match(/[0-9a-f]{32}/g)?.pop() : ids[ids.length - 1];
  return targetHref(id, /^[0-9a-f]{32}$/.test(anchor) ? anchor : '') || CONFIG.notionSite + id + (anchor ? '#' + anchor : '');
}

function targetHref(id, anchor = '') {
  const d = loadData();
  if (d.pageIds.has(id)) return pageHref(d.pageIds.get(id), anchor);
  if (d.blockPages.has(id)) return pageHref(d.blockPages.get(id), id);
  if (d.peopleById.has(id)) return personHref(id);
  return '';
}

const COLOURS = /^(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?$/;

function rich(rt) {
  return (rt || []).map((r) => {
    let h = esc(r.text).replace(/\n/g, '<br>');
    if (r.code) h = `<code>${h}</code>`;
    if (r.s) h = `<del>${h}</del>`;
    if (r.u) h = `<u>${h}</u>`;
    if (r.i) h = `<em>${h}</em>`;
    if (r.b) h = `<strong>${h}</strong>`;
    if (r.color && COLOURS.test(r.color)) h = `<span class="nc-${r.color}" data-color="${r.color}">${h}</span>`;
    if (r.page) {
      const to = targetHref(r.page) || CONFIG.notionSite + r.page;
      return `<a href="${esc(to)}" data-page="${r.page}"${to.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${h}</a>`;
    }
    if (r.href) {
      const to = resolveHref(r.href);
      const external = /^(https?:|mailto:)/i.test(to);
      return `<a href="${esc(to)}" data-href="${esc(r.href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${h}</a>`;
    }
    return h;
  }).join('');
}

const plain = (rt) => (rt || []).map((r) => r.text).join('');

// The site's blocks (see Site.js: to_site_block) -> HTML. Every block keeps its Notion id, for links to it
// and for the editor.
function renderBlocks(blocks) {
  let html = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'ul' || b.type === 'ol') {
      let items = '';
      for (; i < blocks.length && blocks[i].type === b.type; i++) items += renderBlock(blocks[i]);
      i--;
      html += `<${b.type}>${items}</${b.type}>`;
    } else {
      html += renderBlock(b);
    }
  }
  return html;
}

const HEADING = { h1: 'h2', h2: 'h3', h3: 'h4' };

function renderBlock(b) {
  const at = `id="${b.id}" data-id="${b.id}" data-type="${b.type}"${b.color && COLOURS.test(b.color) ? ` class="nc-${b.color} block-colour"` : ''}`;
  const kids = b.children?.length ? renderBlocks(b.children) : '';
  const text = rich(b.rt);
  switch (b.type) {
    case 'p': return `<p ${at}>${text}</p>${kids ? `<div class="indent">${kids}</div>` : ''}`;
    case 'h1': case 'h2': case 'h3':
      if (b.toggle) return toggle(b, at, `<span class="toggle-title t-${HEADING[b.type]}">${text}</span>`, kids);
      return `<${HEADING[b.type]} ${at}>${text}</${HEADING[b.type]}>`;
    case 'toggle': return toggle(b, at, `<span class="toggle-title">${text}</span>`, kids);
    case 'ul': case 'ol': return `<li ${at}><span class="li-text">${text}</span>${kids}</li>`;
    case 'todo': return `<div class="todo" ${at}><input type="checkbox" disabled${b.checked ? ' checked' : ''}><span class="li-text">${text}</span></div>${kids}`;
    case 'quote': return `<blockquote ${at}><p class="q-text">${text}</p>${kids}</blockquote>`;
    case 'callout': return `<aside class="callout" ${at}><span class="callout-icon" aria-hidden="true">${esc(b.icon || '💡')}</span><div><p class="q-text">${text}</p>${kids}</div></aside>`;
    case 'code': return `<pre ${at}><code>${esc(plain(b.rt))}</code></pre>`;
    case 'hr': return `<hr ${at}>`;
    case 'columns': return `<div class="columns" ${at}>${kids}</div>`;
    case 'column': return `<section class="column" ${at}>${kids}</section>`;
    case 'group': return kids;
    case 'table': {
      const rows = (b.rows || []).map((r, i) => {
        const tag = b.header && i === 0 ? 'th' : 'td';
        return `<tr data-row="${r.id}">${r.cells.map((c) => `<${tag}>${rich(c)}</${tag}>`).join('')}</tr>`;
      });
      const head = b.header && rows.length ? `<thead>${rows.shift()}</thead>` : '';
      return `<div class="table-wrap" ${at}><table>${head}<tbody>${rows.join('')}</tbody></table></div>`;
    }
    case 'image': return `<figure ${at}><img src="${esc(b.url)}" alt="${esc(plain(b.caption))}" loading="lazy">${b.caption?.length ? `<figcaption>${rich(b.caption)}</figcaption>` : ''}</figure>`;
    case 'bookmark': return `<p class="bookmark" ${at}><a href="${esc(b.url)}" target="_blank" rel="noopener">${b.caption?.length ? rich(b.caption) : esc(b.url)}</a></p>`;
    case 'page': {
      const page = Object.values(bundle.pages).find((p) => p.id === b.page);
      const to = page ? pageHref(page.slug) : CONFIG.notionSite + b.page;
      const title = page?.title || b.title || 'Page on Notion';
      return `<p class="page-link" ${at}><a href="${esc(to)}"${page ? '' : ' target="_blank" rel="noopener"'}>${page?.icon ? `<span aria-hidden="true">${esc(page.icon)}</span> ` : ''}${esc(title)}</a></p>`;
    }
    case 'view': return `<span class="anchor" id="v-${b.view}"></span><div class="view view-${b.view}" ${at} data-view="${b.view}"></div>`;
    default: return '';
  }
}

function toggle(b, at, summary, kids) {
  return `<details class="toggle" ${at}><summary>${summary}</summary><div class="toggle-body">${kids}</div></details>`;
}

// ---------- people ----------

function initials(name) {
  const words = String(name).replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return [words[0], words.length > 1 && words[words.length - 1]].filter(Boolean).map((w) => Array.from(w)[0]).join('').toUpperCase();
}

// People's photos: the bot keeps them (api_site_photos), fetched again only when their version changes; until a
// person has one there, their Notion page icon. 'none': no photo.
const PHOTOS = 'gatsby-rotas-photos';
let photos = {};

async function loadPhotos() {
  const version = bundle?.photos_version || '';
  const cached = store.get(PHOTOS);
  if (cached && cached.version === version) { photos = cached.photos || {}; return; }
  if (!version) { photos = {}; return; }
  const s = session();
  try {
    const got = await api('api_site_photos', s.key, s.token);
    if (got) { photos = got.photos || {}; store.set(PHOTOS, got); }
  } catch { photos = cached?.photos || {}; }
}

function photoOf(p) {
  const own = photos[p.id];
  if (own === 'none') return null;
  return own ? { src: own, alt: [] } : p.photo ? { src: p.photo, alt: [].concat(p.photo_alt || []) } : null;
}

// A person's photo in a round frame; without one (or when it fails to load), their initials.
function avatar(p, size = '') {
  const ph = photoOf(p);
  if (ph) return `<span class="avatar ${size}"><img src="${esc(ph.src)}" data-alt="${esc(ph.alt.join(' '))}" data-initials="${esc(initials(p.name))}" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="avatar avatar-mono ${size}" aria-hidden="true">${esc(initials(p.name))}</span>`;
}

document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.parentElement?.classList.contains('avatar')) return;
  const next = (img.dataset.alt || '').split(' ').filter(Boolean);
  if (next.length) { img.dataset.alt = next.slice(1).join(' '); img.src = next[0]; return; }
  const box = img.parentElement;
  box.classList.add('avatar-mono');
  box.textContent = img.dataset.initials || '';
}, true);

function personLinks(ids, d, faces = false) {
  return ids.map((id) => {
    const p = d.peopleById.get(id);
    if (!p) return '<span class="muted">someone</span>';
    return faces && photoOf(p) ? `<a class="face-link" href="${personHref(id)}">${avatar(p, 'avatar-xs')}${esc(p.name)}</a>`
      : `<a href="${personHref(id)}">${esc(p.name)}</a>`;
  }).join(', ');
}

// ---------- slots ----------

function badge(type) {
  const t = TYPES[type] || { cls: 'other', label: type };
  return `<span class="badge t-${t.cls}">${esc(t.label)}</span>`;
}

function slotTitle(s) {
  if (s.cleanTitle) return esc(s.cleanTitle);
  if (s.type === 'Coffee Cleaning') return 'Coffee machine cleaning';
  if (s.type === 'Just Tea') return 'Tea, no talk';
  if (s.type === 'Leaving Tea') return 'Leaving tea';
  return s.startDate < Date.now() ? '<span class="tba">No title recorded</span>' : '<span class="tba">Title to be announced</span>';
}

function slotPeople(s, d) {
  const parts = [];
  if (s.type === 'Coffee Cleaning') {
    if (s.tea.length) parts.push(`<span class="role">On duty</span> ${personLinks(s.tea, d, true)}`);
    if (s.water_filter) parts.push('<span class="chip chip-water">Water filter week</span>');
    return parts.map((p) => `<span class="who">${p}</span>`).join('');
  }
  if (s.guest) parts.push(`<span class="role">Guest</span> ${esc(s.guest)}`);
  if (s.presenter.length) parts.push(`<span class="role">${s.type === 'MLJC' || s.type === 'TNJC' ? 'Presenter' : 'Speaker'}</span> ${personLinks(s.presenter, d, true)}`);
  if (s.tea.length) parts.push(`<span class="role">Tea</span> ${personLinks(s.tea, d, true)}`);
  return parts.map((p) => `<span class="who">${p}</span>`).join('');
}

function slotWhen(s) {
  if (s.allDay) {
    const endDate = s.end && s.end !== s.start ? new Date(s.end.slice(0, 10) + 'T00:00:00') : null;
    const sameMonth = endDate && endDate.getMonth() === s.startDate.getMonth();
    const range = !endDate ? F.date.format(s.startDate)
      : sameMonth ? `${s.startDate.getDate()}–${F.date.format(endDate)}` : `${F.date.format(s.startDate)} – ${F.date.format(endDate)}`;
    return `<span class="when-day">Week</span><span class="when-date">${range}</span>`;
  }
  return `<span class="when-day">${F.day.format(s.startDate)}</span><span class="when-date">${F.date.format(s.startDate)}</span><span class="when-time">${F.time.format(s.startDate)}</span>`;
}

const hooks = {}; // filled by edit.js for tsars

function slotItem(s, d, nextId) {
  const isNext = s.id === nextId;
  const today = dayKey(s.startDate) === todayKey();
  const me = session()?.person;
  const mine = me && (s.presenter.includes(me) || s.tea.includes(me));
  return `<li class="slot t-${TYPES[s.type].cls}${isNext ? ' is-next' : ''}${today ? ' is-today' : ''}" data-slot="${s.id}">
    <time class="slot-when" datetime="${esc(s.start)}">${slotWhen(s)}</time>
    <div class="slot-main">
      <div class="slot-head">${badge(s.type)}${s.csnjc ? '<span class="badge t-csnjc">CSNJC</span>' : ''}${s.tentative ? '<span class="chip chip-tentative">Tentative</span>' : ''}${mine ? '<span class="chip chip-you">You</span>' : ''}${isNext ? '<span class="green-light" title="Next up"></span><span class="next-label">Next up</span>' : ''}${hooks.slotButton ? hooks.slotButton(s) : ''}</div>
      <div class="slot-title">${slotTitle(s)}</div>
      <div class="slot-people">${slotPeople(s, d)}</div>
      ${s.description ? `<details class="slot-desc"><summary>Details</summary><p>${linkify(s.description)}</p></details>` : ''}
    </div>
  </li>`;
}

function nextTalk(d) {
  const now = Date.now();
  return d.slots.find((s) => TYPES[s.type].talk && !s.allDay && !s.cancelled && s.startDate.getTime() + 30 * 60e3 > now);
}

function matches(s, q, d) {
  if (!q) return true;
  const names = [...s.presenter, ...s.tea].map((id) => d.peopleById.get(id)?.name || '');
  return [s.title, s.type, s.guest, s.description, ...names].join(' ').toLowerCase().includes(q);
}

// ---------- views ----------

const VIEWS = {
  'next-up': nextUpView,
  schedule: scheduleView,
  people: peopleView,
  'rota-rules': rotaRulesView,
};

function nextUpView(el, d) {
  const next = nextTalk(d);
  const now = Date.now();
  const soon = d.slots.filter((s) => s !== next && !s.cancelled && s.startDate.getTime() > now && TYPES[s.type].talk).slice(0, 4);
  const thisWeek = mondayOf(todayKey());
  const coffee = d.slots.find((s) => s.type === 'Coffee Cleaning' && mondayOf(s.start.slice(0, 10)) === thisWeek);
  if (!next) { el.innerHTML = ''; return; }
  // Without a title yet, the speaker is the headline.
  const speaker = next.guest ? esc(next.guest) : personLinks(next.presenter, d);
  const headline = next.cleanTitle || !speaker ? slotTitle(next) : speaker;
  const subline = next.cleanTitle || !speaker ? slotPeople(next, d)
    : `<span class="tba">Title to be announced</span>${next.tea.length ? `<span class="who"><span class="role">Tea</span> ${personLinks(next.tea, d, true)}</span>` : ''}`;
  const portraits = next.guest ? '' : next.presenter.map((id) => d.peopleById.get(id)).filter((p) => p && photoOf(p))
    .map((p) => `<a href="${personHref(p.id)}" aria-hidden="true" tabindex="-1">${avatar(p, 'avatar-lg')}</a>`).join('');
  el.innerHTML = `
    <div class="next-up">
      <div class="next-main">
        ${portraits ? `<div class="next-faces">${portraits}</div>` : ''}
        <p class="eyebrow"><span class="green-light"></span>Next up</p>
        <p class="next-when">${F.full.format(next.startDate)}, ${F.time.format(next.startDate)}</p>
        <p class="next-title">${headline}</p>
        <p class="next-meta">${badge(next.type)}${next.csnjc ? '<span class="badge t-csnjc">CSNJC</span>' : ''}${next.tentative ? '<span class="chip chip-tentative">Tentative</span>' : ''}</p>
        <p class="slot-people">${subline}</p>
      </div>
      <div class="next-side">
        <p class="eyebrow">After that</p>
        <ol class="mini-list">${soon.map((s) => `<li><span class="mini-when">${F.day.format(s.startDate)} ${F.date.format(s.startDate)}</span>${badge(s.type)}<span class="mini-who">${s.guest ? esc(s.guest) : personLinks(s.presenter, d, true) || slotTitle(s)}</span></li>`).join('')}</ol>
        ${coffee ? `<p class="coffee-line"><span class="role">Coffee this week</span> ${personLinks(coffee.tea, d, true) || '—'}</p>` : ''}
      </div>
    </div>`;
}

const SCHEDULE_TABS = [
  { id: 'upcoming', label: 'Upcoming', filter: () => true },
  { id: 'calendar', label: 'Calendar', calendar: true },
  { id: 'talks', label: 'Research & Tea Talks', filter: (s) => UNIT_WIDE.includes(s.type) },
  { id: 'mljc', label: 'MLJC', filter: (s) => s.type === 'MLJC' },
  { id: 'tnjc', label: 'TNJC & CSNJC', filter: (s) => s.type === 'TNJC' },
  { id: 'coffee', label: 'Coffee', filter: (s) => s.type === 'Coffee Cleaning' },
];

function tabsHtml(tabs, active, name) {
  return `<div class="tabs" role="tablist" aria-label="${name}">${tabs.map((t) =>
    `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === active}">${esc(t.label)}</button>`).join('')}</div>`;
}

function scheduleView(el) {
  const state = { tab: 'upcoming', q: '', past: false, month: todayKey().slice(0, 7) };
  el.innerHTML = `
    <div class="view-bar">${tabsHtml(SCHEDULE_TABS, state.tab, 'Schedule views')}
      <div class="view-tools">${hooks.scheduleBar ? hooks.scheduleBar() : ''}
        <label class="search"><span class="sr">Find</span><input type="search" placeholder="Find a name or title" autocomplete="off"></label></div>
    </div>
    <div class="view-body" aria-live="polite"></div>`;
  const body = $('.view-body', el);
  const draw = () => {
    const d = loadData();
    el.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
    const tab = SCHEDULE_TABS.find((t) => t.id === state.tab);
    body.innerHTML = tab.calendar ? calendarHtml(d, state) : listHtml(d, state, tab.filter);
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.dataset.tab; state.past = false; draw(); return; }
    if (e.target.closest('[data-past]')) { state.past = !state.past; draw(); return; }
    const nav = e.target.closest('[data-month]');
    if (nav) {
      const v = nav.dataset.month;
      if (v === 'today') state.month = todayKey().slice(0, 7);
      else {
        const [y, m] = state.month.split('-').map(Number);
        state.month = new Date(Date.UTC(y, m - 1 + Number(v), 1)).toISOString().slice(0, 7);
      }
      draw();
    }
  });
  $('input', el).addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); });
  el.redraw = draw;
  draw();
}

function listHtml(d, state, filter) {
  const today = todayKey();
  const rows = d.slots.filter((s) => filter(s) && matches(s, state.q, d));
  const future = rows.filter((s) => (s.end && s.allDay ? s.end.slice(0, 10) : s.start.slice(0, 10)) >= today);
  const past = rows.filter((s) => !future.includes(s)).reverse();
  const next = nextTalk(d)?.id;
  const groups = new Map();
  for (const s of future) {
    const wk = mondayOf(s.start.slice(0, 10));
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk).push(s);
  }
  const thisWeek = mondayOf(today);
  let html = '';
  for (const [wk, slots] of groups) {
    const label = wk === thisWeek ? 'This week' : `Week of ${F.full.format(keyDate(wk)).replace(/^\w+ /, '')}`;
    html += `<section class="week"><h3 class="week-label">${label}</h3><ol class="slots">${slots.map((s) => slotItem(s, d, next)).join('')}</ol></section>`;
  }
  if (!future.length) html += `<p class="empty">${state.q ? 'Nothing upcoming matches.' : 'Nothing scheduled yet. Slots appear here once the organisers run the scheduler.'}</p>`;
  if (past.length) {
    html += `<button type="button" class="link-button" data-past aria-expanded="${state.past}">${state.past ? 'Hide' : 'Show'} past slots (${past.length})</button>`;
    if (state.past) html += `<ol class="slots slots-past">${past.map((s) => slotItem(s, d)).join('')}</ol>`;
  }
  return html;
}

function calendarHtml(d, state) {
  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const byDay = new Map();
  for (const s of d.slots) {
    if (!matches(s, state.q, d) || s.allDay) continue; // weekly coffee duty is in the Coffee tab
    const k = s.start.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const today = todayKey();
  const next = nextTalk(d)?.id;
  let cells = '';
  const day = new Date(start);
  do {
    for (let i = 0; i < 7; i++) {
      const k = day.toISOString().slice(0, 10);
      const slots = byDay.get(k) || [];
      const out = day.getUTCMonth() !== m - 1;
      cells += `<div class="cal-day${out ? ' is-out' : ''}${k === today ? ' is-today' : ''}${i > 4 ? ' is-weekend' : ''}${slots.length ? '' : ' is-empty'}">
        <span class="cal-num">${day.getUTCDate()}<span class="cal-wd"> ${F.day.format(keyDate(k))}</span></span>
        ${slots.map((s) => `<div class="cal-slot t-${TYPES[s.type].cls}${s.id === next ? ' is-next' : ''}" title="${esc(`${TYPES[s.type].label} · ${s.cleanTitle || 'title to be announced'}`)}">
          <span class="cal-time">${F.time.format(s.startDate)}</span> ${badge(s.type)}
          <span class="cal-title">${slotTitle(s)}</span>
          <span class="cal-who">${s.guest ? esc(s.guest) : personLinks(s.presenter, d)}${s.tea.length ? ` <span class="cal-tea">· tea ${personLinks(s.tea, d)}</span>` : ''}</span>
        </div>`).join('')}
      </div>`;
      day.setUTCDate(day.getUTCDate() + 1);
    }
  } while (day.getUTCMonth() === m - 1);
  return `<div class="cal-bar"><button type="button" data-month="-1" aria-label="Previous month">‹</button>
      <h3 class="cal-month">${F.month.format(new Date(Date.UTC(y, m - 1, 15)))}</h3>
      <button type="button" data-month="1" aria-label="Next month">›</button>
      <button type="button" class="link-button" data-month="today">Today</button></div>
    <div class="cal-head" aria-hidden="true">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w, i) => `<span${i > 4 ? ' class="is-weekend"' : ''}>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>`;
}

const PEOPLE_TABS = [
  { id: 'all', label: 'Everyone', filter: () => true },
  { id: 'MLJC', label: 'MLJC', filter: (p) => p.rotas.includes('MLJC') },
  { id: 'TNJC', label: 'TNJC', filter: (p) => p.rotas.includes('TNJC') },
  { id: 'CSNJC', label: 'CSNJC', filter: (p) => p.rotas.includes('CSNJC') },
  { id: 'Coffee', label: 'Coffee', filter: (p) => p.rotas.includes('Coffee') },
];
const EXCLUDED = { research: 'no research talks', tea_talk: 'no tea talks', tea: 'no tea' };
// "Included only for JCs / coffee" already says it; everyone else gets one chip per exemption.
function exemptChips(p) {
  if (p.excluded.length === 3) return /^Included only/.test(p.position || '') ? '' : '<span class="chip">no unit-wide duties</span>';
  return p.excluded.map((x) => `<span class="chip">${EXCLUDED[x]}</span>`).join('');
}

function personCard(p) {
  return `<li class="person-card${p.active ? '' : ' is-inactive'}" data-person-card="${p.id}">
    ${avatar(p)}
    <span class="person-text">
      <a class="person-name" href="${personHref(p.id)}">${esc(p.name)}</a>
      <span class="person-pos">${esc(p.position || '')}${p.active ? '' : ' · not on the rotas'}</span>
      <span class="person-rotas">${p.rotas.map((r) => `<span class="badge t-${r.toLowerCase()}">${r}</span>`).join('')}${exemptChips(p)}</span>
    </span>
    ${hooks.personButton ? hooks.personButton(p) : ''}
  </li>`;
}

function peopleView(el) {
  const state = { tab: 'all', q: '' };
  el.innerHTML = `
    <div class="view-bar">${tabsHtml(PEOPLE_TABS, state.tab, 'People views')}
      <div class="view-tools">${hooks.peopleBar ? hooks.peopleBar() : ''}
        <label class="search"><span class="sr">Find</span><input type="search" placeholder="Find someone" autocomplete="off"></label></div>
    </div>
    <div class="view-body"></div>`;
  const body = $('.view-body', el);
  const draw = () => {
    const d = loadData();
    // Inactive people only turn up when searched for, so tsars can bring someone back.
    const list = d.people.filter((p) => (p.active || (state.q && can.any())) && PEOPLE_TABS.find((t) => t.id === state.tab).filter(p)
      && (!state.q || p.name.toLowerCase().includes(state.q)))
      .sort((a, b) => (b.active - a.active) || (a.joined || '').localeCompare(b.joined || '') || a.name.localeCompare(b.name));
    el.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
    body.innerHTML = `<p class="count">${list.length} ${list.length === 1 ? 'person' : 'people'}</p>
      <ul class="people">${list.map(personCard).join('')}</ul>`;
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.dataset.tab; draw(); }
  });
  $('input', el).addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); });
  el.redraw = draw;
  draw();
}

function rotaRulesView(el) {
  const draw = () => {
    const d = loadData();
    const cell = (r, k) => {
      if (hooks.ruleCell) return hooks.ruleCell(r, k);
      const v = r[k] || '';
      const cls = /exempt/.test(v) ? 'rule-exempt' : /request|depends/.test(v) ? 'rule-ask' : 'rule-days';
      return `<span class="rule ${cls}">${esc(v)}</span>`;
    };
    el.innerHTML = `<div class="table-wrap"><table class="rules">
      <thead><tr><th>Position</th><th>Research talk</th><th>Tea talk</th><th>Tea</th></tr></thead>
      <tbody>${d.rota_rules.map((r) => `<tr data-rule="${r.id}"><th scope="row">${esc(r.position)}</th><td>${cell(r, 'research')}</td><td>${cell(r, 'tea_talk')}</td><td>${cell(r, 'tea')}</td></tr>`).join('')}</tbody>
    </table></div>`;
  };
  el.redraw = draw;
  draw();
}

// plain text from a Notion text property: line breaks kept, addresses made into links
const linkify = (text) => esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');

function redrawViews() {
  data = null;
  document.querySelectorAll('[data-view]').forEach((v) => v.redraw?.());
}

// ---------- pages ----------

// top right: who this browser is signed in as (a link to their page)
function renderAccount() {
  const el = $('#account');
  const s = session();
  const p = s?.person && bundle && loadData().peopleById.get(s.person);
  el.hidden = !p;
  if (!p) return;
  el.href = personHref(p.id);
  el.title = `Signed in as ${p.name}`;
  el.innerHTML = `${avatar(p, 'avatar-xs')}<span class="account-name">${esc(p.name)}</span>`;
}

function renderNav(active) {
  $('#nav').innerHTML = NAV.map((n) =>
    `<li><a href="${pageHref(n.slug)}"${n.slug === active ? ' aria-current="page"' : ''}>${n.label}</a></li>`).join('')
    + `<li><a href="${CONFIG.teaPage}">My tea page</a></li>`;
  $('[data-home]').setAttribute('href', pageHref('home'));
}

async function renderPage(slug) {
  const main = $('#main');
  await loadBundle();
  const page = bundle.pages[slug] || (slug === 'home' && { id: '', slug, title: 'Gatsby Rotas', error: 'The pages are being moved here from Notion.' });
  if (!page) return notFound();
  document.title = slug === 'home' ? 'Gatsby Rotas' : `${page.title || slug} · Gatsby Rotas`;
  main.className = `page page-${slug}`;
  // a page the bot cannot read: say so, and on the home page still show the rota views
  let blocks = page.error ? [] : page.blocks;
  if (page.error) {
    if (slug !== 'home') {
      main.innerHTML = `<article class="prose"><p class="empty">${esc(page.error)}</p></article>`;
      footerMeta();
      return;
    }
    blocks = [{ id: 'page-error', type: 'p', rt: [{ text: page.error, color: 'gray' }] }];
  }
  if (slug === 'home') {
    // "Next up" is the site's own; it goes above the first heading.
    const at = Math.max(0, blocks.findIndex((b) => /^h[123]$/.test(b.type)));
    blocks = [...blocks.slice(0, at), { id: 'next-up', type: 'view', view: 'next-up' }, ...blocks.slice(at)];
    // should Notion ever leave out its linked database views, the site's own still appear
    const has = (v) => JSON.stringify(blocks).includes(`"view":"${v}"`);
    for (const [v, title] of [['rota-rules', 'You are added to the rota when'], ['schedule', 'Schedule'], ['people', 'People']]) {
      if (!has(v)) blocks.push({ id: v, type: 'h1', rt: [{ text: title }] }, { id: `${v}-view`, type: 'view', view: v });
    }
  }
  const head = slug === 'home' ? '' : `<header class="page-head"><p class="crumbs"><a href="${pageHref('home')}">Gatsby Rotas</a></p>
    <h1 data-page-title>${page.icon ? `<span class="page-icon" aria-hidden="true">${esc(page.icon)}</span>` : ''}<span class="page-title">${esc(page.title || '')}</span></h1></header>`;
  main.innerHTML = `${head}<div class="page-tools">${hooks.pageTools ? hooks.pageTools(page) : ''}</div><article class="prose" data-page="${slug}">${renderBlocks(blocks)}</article>`;
  mountViews(main);
  footerMeta();
  openHash();
}

function mountViews(root) {
  const d = loadData();
  for (const v of root.querySelectorAll('[data-view]')) (VIEWS[v.dataset.view] || (() => {}))(v, d);
}

async function renderPerson(id) {
  const main = $('#main');
  main.className = 'page page-person';
  await loadBundle();
  const d = loadData();
  const p = d.peopleById.get(id);
  if (!p) return notFound();
  document.title = `${p.name} · Gatsby Rotas`;
  const mine = d.slots.filter((s) => s.presenter.includes(id) || s.tea.includes(id));
  const today = todayKey();
  const upcoming = mine.filter((s) => s.start.slice(0, 10) >= today);
  const past = mine.filter((s) => s.start.slice(0, 10) < today).reverse().slice(0, 12);
  const facts = [
    p.position && `<div><dt>Position</dt><dd>${esc(p.position)}</dd></div>`,
    p.joined && `<div><dt>Joined</dt><dd>${esc(fmt({ month: 'long', year: 'numeric' }).format(new Date(p.joined + 'T12:00:00Z')))}</dd></div>`,
    `<div><dt>Rotas</dt><dd>${p.rotas.length ? p.rotas.map((r) => `<span class="badge t-${r.toLowerCase()}">${r}</span>`).join('') : '<span class="muted">Unit-wide talks and tea only</span>'}</dd></div>`,
    p.excluded.length && `<div><dt>Exempt from</dt><dd>${p.excluded.map((x) => `<span class="chip">${EXCLUDED[x].replace(/^no /, '')}</span>`).join('')}</dd></div>`,
    !p.active && '<div><dt>Status</dt><dd>No longer on the rotas</dd></div>',
  ].filter(Boolean).join('');
  const s = session();
  const teaLink = CONFIG.teaPage;
  main.innerHTML = `<header class="page-head person-head">${avatar(p, 'avatar-xl')}
      <div><p class="crumbs"><a href="${pageHref('home')}">Gatsby Rotas</a> › <a href="${pageHref('home', 'v-people')}">People</a></p>
      <h1>${esc(p.name)}</h1></div>${hooks.personButton ? `<div class="person-tools">${hooks.personButton(p, true)}</div>` : ''}</header>
    <article class="prose person-page">
      <dl class="facts">${facts}</dl>
      <h2>Upcoming</h2>
      ${upcoming.length ? `<ol class="slots">${upcoming.map((x) => slotItem(x, d, nextTalk(d)?.id)).join('')}</ol>` : '<p class="empty">Nothing scheduled.</p>'}
      <p class="hint">Away, or need to swap? Use <a href="${esc(teaLink)}">${s?.person === id ? 'your' : 'the'} tea page</a>.</p>
      ${past.length ? `<h2>Recently</h2><ol class="slots slots-past">${past.map((x) => slotItem(x, d)).join('')}</ol>` : ''}
    </article>`;
  footerMeta();
}

function notFound() {
  const main = $('#main');
  main.className = 'page page-missing';
  main.innerHTML = `<article class="prose"><h1>Not found</h1><p>This page does not exist. Back to <a href="${pageHref('home')}">the rotas</a>.</p></article>`;
  document.title = 'Not found · Gatsby Rotas';
}

function footerMeta() {
  const el = $('#footer-meta');
  const s = session();
  const generated = bundle?.data?.generated;
  const teaLink = CONFIG.teaPage;
  const who = !s ? '' : s.person && s.name ? `Signed in as <a href="${personHref(s.person)}">${esc(s.name)}</a>` : 'Signed in on this browser';
  el.innerHTML = [
    generated && `Updated ${F.stamp.format(new Date(generated))}`,
    `<a href="${esc(teaLink)}">Tea page</a>`,
    who, s && '<button type="button" class="link-button" data-sign-out>Sign out</button>',
  ].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-sign-out]')) return;
  forget();
  location.href = href();
});

function signInPage({ notice = '' } = {}) {
  document.body.classList.add('signed-out');
  document.title = 'Sign in · Gatsby Rotas';
  $('#nav').innerHTML = '';
  footerMeta();
  const main = $('#main');
  main.className = 'page page-signin';
  main.innerHTML = `<section class="signin">
      <h1>Sign in</h1>
      <p class="lead">The talk, tea and coffee rotas are for members of the Gatsby Unit. Pick your name and we will
        email you a link.</p>
      <div class="signin-body">
        ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
        <form novalidate>
          <label for="person">Your name</label>
          <select id="person" name="person" required disabled><option value="">Loading names…</option></select>
          <button class="button" type="submit" disabled>Email me a sign-in link</button>
          <p class="error" role="alert" hidden></p>
        </form>
      </div>
      <p class="fine">The link goes to the address the tea bot writes to and works for an hour. Once you have opened
        it, this browser remembers you for six months.</p>
    </section>`;
  const form = $('form', main);
  const select = form.person;
  const button = $('button', form);
  const error = $('.error', main);
  const fail = (message) => { error.textContent = message; error.hidden = false; };
  api('api_site_people').then((people) => {
    select.innerHTML = '<option value="">Pick your name…</option>' +
      people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    select.disabled = button.disabled = false;
    if (matchMedia('(hover: hover)').matches) select.focus();
  }).catch((err) => fail(`The list of names could not be loaded (${err.message}). Please try again in a minute.`));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!select.value) { fail('Please pick your name.'); return select.focus(); }
    const name = select.selectedOptions[0].textContent;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const message = await api('api_site_request_link', select.value);
      $('.signin-body', main).innerHTML = `<p class="notice" role="status"><strong>${esc(name)}</strong>: ${esc(message)}</p>
        <button type="button" class="link-button" data-again>Not you? Pick another name</button>`;
      $('[data-again]', main).addEventListener('click', () => signInPage());
    } catch (err) {
      fail(err.message);
      button.disabled = false;
      button.textContent = 'Email me a sign-in link';
    }
  });
}

function openHash() {
  const id = decodeURIComponent(location.hash.slice(1)).replace(/-/g, '');
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  for (let d = el; d; d = d.parentElement?.closest('details')) if (d.tagName === 'DETAILS') d.open = true;
  el.scrollIntoView({ block: 'start' });
}

window.addEventListener('hashchange', openHash);

// Signs in from whatever this visit brought: returns a notice for the sign-in page, or ''.
async function signInFromLink() {
  const code = params.get('signin');
  const token = params.get('t');
  const key = params.get('k');
  if (code || token || key) {
    // keep codes, tokens and keys out of the address bar, history and bookmarks
    const rest = new URLSearchParams(params);
    ['signin', 't', 'k'].forEach((k) => rest.delete(k));
    history.replaceState(null, '', (rest.toString() ? '?' + rest : location.pathname) + location.hash);
  }
  const remembered = store.raw(TEA_PAGE_MEMORY);
  const via = code ? ['api_site_sign_in', code] : token ? ['api_site_sign_in_token', token]
    : !session() && /^[0-9a-f]{40}$/.test(remembered) ? ['api_site_sign_in_token', remembered] : null;
  if (key && !via) {
    if (session()?.key !== key) remember({ ...(session() || {}), key });
    return '';
  }
  if (!via) return '';
  $('#main').innerHTML = '<p class="loading">Signing you in…</p>';
  try {
    const who = await api(...via);
    if (who) { remember(who); return ''; }
    if (via[1] === remembered) return '';
    return code ? 'That sign-in link has expired. Links work for an hour; ask for a new one below.' : 'That link is not valid any more. Ask for a new one below.';
  } catch (err) {
    return err.message;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('The editor could not be loaded.'));
    document.head.append(s);
  });
}

async function route() {
  const person = params.get('person');
  const slug = params.get('p') || 'home';
  if (person) await renderPerson(person.replace(/-/g, ''));
  else if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  else await renderPage(slug);
}

// the tea page's browser-tab icon (FAVICON_URL), remembered so it shows at once next time
function showIcon(url) {
  if (!url) return;
  $('#favicon').href = url;
  const img = $('#brand-icon');
  img.src = url;
  img.hidden = false;
}
showIcon(store.raw('gatsby-rotas-icon'));
api('api_page_icon').then((url) => {
  if (url && url !== store.raw('gatsby-rotas-icon')) { try { localStorage.setItem('gatsby-rotas-icon', url); } catch { /* fine */ } showIcon(url); }
}).catch(() => {});

(async function main() {
  const notice = await signInFromLink();
  if (notice || !session()) return signInPage({ notice });
  document.body.classList.remove('signed-out');
  const person = params.get('person');
  renderNav(person ? '' : params.get('p') || 'home');
  footerMeta();
  try {
    await loadBundle();
    await loadPhotos();
    renderAccount();
    // edit.js: tsars edit the site; everyone signed in by name can change their own photo
    if (bundle.me) await loadScript(`edit.js?v=${document.querySelector('script[src^="app.js"]')?.src.split('v=')[1] || ''}`);
    await route();
  } catch (err) {
    if (err instanceof SignedOut) return signInPage({ notice: 'Please sign in again.' });
    console.error(err);
    $('#main').innerHTML = `<p class="empty">The rotas could not be loaded right now (${esc(err.message)}). Please try again in a minute.</p>`;
  }
})();

// for edit.js
window.Rotas = {
  CONFIG, TYPES, api, session, hooks, esc, rich, plain, renderBlocks, loadData, keep, redrawViews, route,
  setPhoto: (id, uri, version) => { photos = { ...photos, [id]: uri || 'none' }; if (bundle) bundle.photos_version = version; store.set(PHOTOS, { version, photos }); renderAccount(); },
  bundle: () => bundle, mountViews, footerMeta, avatar, personHref, pageHref, initials,
};
