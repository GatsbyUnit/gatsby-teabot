#!/usr/bin/env node
// MCP server for the Gatsby tea bot: lets an AI agent read the rotas and make changes through the bot's web API,
// the same calls the tea page and the Gatsby Rotas site make, instead of driving a browser. It acts as the person
// whose personal tea-page code it is given (TEABOT_TOKEN): it may do exactly what they may do on the site, and the
// bot logs every change under their name. No dependencies (Node 18 or later); speaks MCP over stdio.
//
//   claude mcp add -s user gatsby-teabot -e TEABOT_TOKEN=<your code> -- node /path/to/gatsby-teabot/mcp/server.js
//
// The code is the t=… part of your personal tea-page link. Keep it to yourself: whoever has it can act as you. If it
// leaks, the tea tsar clears your cell in column D of the identity sheet and you get a new one.
'use strict';

const API = process.env.TEABOT_API || 'https://script.google.com/macros/s/AKfycbxjB4wiJ-jluRobucTdMruvxRofOwb1TXVIxgIe_vnPr06t2gg3hybxrV8Rmfp9Ufmx/exec';
const TOKEN = String(process.env.TEABOT_TOKEN || '').trim();
const FRESH_MS = 60e3;

// ---------- the bot's web API ----------

async function api(fn, ...args) {
  const r = await fetch(API, { method: 'POST', body: JSON.stringify({ fn, args }), redirect: 'follow' });
  const text = await r.text();
  let res;
  try { res = JSON.parse(text); } catch { throw new Error(`The tea bot did not answer properly (HTTP ${r.status}).`); }
  if (!res.ok) throw new Error(String(res.error || 'The tea bot refused.').replace(/^(Exception|Error): /, ''));
  return res.result;
}

let bundle = null, bundleAt = 0;
async function data(fresh) {
  if (!TOKEN) throw new Error('TEABOT_TOKEN is not set: give the server your personal tea-page code.');
  if (fresh || !bundle || Date.now() - bundleAt > FRESH_MS) {
    const b = await api('api_site_bundle', '', TOKEN);
    if (!b) throw new Error('The tea bot does not know this code (TEABOT_TOKEN). Get a new link from the tea page.');
    bundle = b; bundleAt = Date.now();
  }
  return bundle;
}
const changed = () => { bundle = null; };

// ---------- helpers ----------

const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();
const londonDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// a person given by id or name -> id
function personId(b, who) {
  const people = b.data.people;
  if (/^[0-9a-f-]{32,36}$/i.test(String(who)) && people.some((p) => p.id === norm(who))) return norm(who);
  const q = String(who || '').trim().toLowerCase();
  const exact = people.filter((p) => p.name.toLowerCase() === q);
  const pick = (list) => (list.filter((p) => p.active).length === 1 ? list.filter((p) => p.active) : list);
  let hits = pick(exact);
  if (!hits.length) hits = pick(people.filter((p) => p.name.toLowerCase().includes(q)));
  if (hits.length === 1) return hits[0].id;
  throw new Error(hits.length ? `"${who}" could mean ${hits.slice(0, 8).map((p) => p.name).join(', ')}: give the full name or the id.` : `Nobody called "${who}".`);
}
const names = (b, ids) => ids.map((id) => b.data.people.find((p) => p.id === id)?.name || id);

function slotOut(b, s) {
  return { id: s.id, type: s.type, title: s.title, start: s.start, end: s.end, presenter: names(b, s.presenter), tea: names(b, s.tea),
    guest: s.guest || undefined, description: s.description || undefined, csnjc: s.csnjc || undefined, water_filter: s.water_filter || undefined };
}

// the site's page blocks -> readable lines, each with its block id (for edit_page)
function pageText(blocks, depth = 0) {
  const rt = (r) => (r || []).map((x) => (x.href ? `[${x.text}](${x.href})` : x.page ? `[${x.text}](/${x.page})` : x.text)).join('');
  return (blocks || []).flatMap((b) => {
    const pad = '  '.repeat(depth);
    let line = `${pad}[${b.id}] ${b.type}`;
    if (b.rt) line += `: ${rt(b.rt)}`;
    else if (b.view) line += `: (${b.view} view)`;
    else if (b.type === 'page') line += `: ${b.title || b.page}`;
    else if (b.url) line += `: ${b.url}`;
    const rows = (b.rows || []).map((r) => `${pad}  [${r.id}] row: ${(r.cells || []).map(rt).join(' | ')}`);
    return [line, ...rows, ...pageText(b.children, depth + 1)];
  });
}

const str = { type: 'string' }, bool = { type: 'boolean' }, strs = { type: 'array', items: { type: 'string' } };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

// ---------- tools ----------

const TOOLS = [
  { name: 'whoami', description: 'Who the server acts as, and what they may edit (slots of which rotas, people, pages, rota rules).',
    inputSchema: obj({}), run: async () => { const b = await data(true); const me = b.data.people.find((p) => p.id === b.me?.person);
      return { name: me?.name, id: b.me?.person, rights: b.me }; } },
  { name: 'my_tea_page', description: "Your own tea page: your upcoming duties (with each slot's id), swap requests to you and from you, away dates, and the organiser tools you have (rotas you can plan, with the next dates to plan).",
    inputSchema: obj({}), run: async () => { const s = await api('api_state', TOKEN); delete s.people; delete s.badge; return s; } },
  { name: 'schedule', description: 'Slots of the rotas (research and tea talks, MLJC, TNJC, coffee, just/leaving tea, external seminars), with presenters and tea people by name. Defaults: from today, 90 days ahead.',
    inputSchema: obj({ from: { ...str, description: 'YYYY-MM-DD' }, to: { ...str, description: 'YYYY-MM-DD' }, type: { ...str, description: 'e.g. TNJC, MLJC, Research Talk, Tea Talk, Coffee Cleaning' },
      person: { ...str, description: 'name or id: only their slots' }, query: { ...str, description: 'text to find in titles, descriptions or guest names' } }),
    run: async (a) => { const b = await data(); const from = a.from || londonDay(), to = a.to || addDays(from, 90);
      const who = a.person ? personId(b, a.person) : null, q = String(a.query || '').toLowerCase();
      return b.data.schedule.filter((s) => s.start.slice(0, 10) >= from && s.start.slice(0, 10) <= to && (!a.type || s.type.toLowerCase() === a.type.toLowerCase())
        && (!who || s.presenter.includes(who) || s.tea.includes(who)) && (!q || [s.title, s.description, s.guest].join(' ').toLowerCase().includes(q))).map((s) => slotOut(b, s)); } },
  { name: 'people', description: 'People on the rotas: position, which rotas they are on (TNJC, CSNJC, MLJC, Coffee), what they are exempt from, when they joined. Active only unless include_inactive.',
    inputSchema: obj({ include_inactive: bool, rota: { ...str, description: 'TNJC, CSNJC, MLJC or Coffee' }, query: { ...str, description: 'part of a name' } }),
    run: async (a) => { const b = await data(); const q = String(a.query || '').toLowerCase();
      return b.data.people.filter((p) => (a.include_inactive || p.active) && (!a.rota || p.rotas.includes(a.rota)) && (!q || p.name.toLowerCase().includes(q))); } },
  { name: 'rota_rules', description: 'When newcomers join each duty, by position (the "You are added to the rota when" table), with the choices allowed.',
    inputSchema: obj({}), run: async () => { const b = await data(); return { rules: b.data.rota_rules, choices: b.data.options.rules }; } },
  { name: 'rotas_overview', description: 'Organisers: everyone active on the rotas you organise, the rotas they can be scheduled for, their upcoming slots and whether an email is registered.',
    inputSchema: obj({}), run: async () => api('api_rotas', TOKEN) },
  { name: 'list_pages', description: 'The pages of the Gatsby Rotas site (guides and toolbox), by slug.',
    inputSchema: obj({}), run: async () => { const b = await data(); return Object.values(b.pages).map((p) => ({ slug: p.slug, title: p.title, saved: p.saved, by: p.by })); } },
  { name: 'read_page', description: 'One page of the site as text, one line per block with its id (to use with edit_page).',
    inputSchema: obj({ slug: str }, ['slug']), run: async (a) => { const b = await data(); const p = b.pages[a.slug];
      if (!p) throw new Error(`No page "${a.slug}". Pages: ${Object.keys(b.pages).join(', ')}`); return `# ${p.title}\n\n` + pageText(p.blocks).join('\n'); } },

  { name: 'save_slot', description: 'Add a slot (no id) or change one (id: only the fields given change). Dates in London time: start "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD" for a week-long coffee duty, with end the last day). People by name or id. Organisers change their own rota, the tea tsar all. The calendar follows within the hour. To block a date, add a slot titled "Cancelled: <reason>" with nobody on it.',
    inputSchema: obj({ id: str, type: str, title: str, start: str, end: str, presenter: strs, tea: strs, guest: { ...str, description: 'guest speaker (presenter then stays empty)' },
      description: str, csnjc: bool, water_filter: bool }),
    run: async (a) => { const b = await data(true); let slot = {};
      if (a.id) { const s = b.data.schedule.find((x) => x.id === norm(a.id)); if (!s) throw new Error('No such slot (or it is more than 400 days old).');
        slot = { ...s, start: s.start.length > 10 ? s.start.slice(0, 16) : s.start, end: s.end ? (s.end.length > 10 ? s.end.slice(0, 16) : s.end) : null }; }
      for (const k of ['type', 'title', 'start', 'end', 'guest', 'description', 'csnjc', 'water_filter']) if (a[k] !== undefined) slot[k] = a[k];
      for (const k of ['presenter', 'tea']) if (a[k] !== undefined) slot[k] = a[k].map((w) => personId(b, w));
      slot.presenter ||= []; slot.tea ||= [];
      const saved = await api('api_site_save_slot', TOKEN, slot); changed(); return slotOut(b, saved); } },
  { name: 'remove_slot', description: 'Remove a slot that is not needed (bank holiday, closure) together with its calendar event. To tell the people on duty, cancel the talk instead (title "Cancelled: …", or cancel_talk).',
    inputSchema: obj({ id: str }, ['id']), run: async (a) => { const r = await api('api_site_delete_slot', TOKEN, norm(a.id)); changed(); return r; } },
  { name: 'save_person', description: 'Add a person (tea tsar, no id) or change one (id or name: only the fields given change). Organisers can only tick or untick their own rota; the tea tsar everything. active=false takes someone off the rotas.',
    inputSchema: obj({ id: { ...str, description: 'id or name' }, name: str, position: str, active: bool, rotas: { ...strs, description: 'all rotas they are on: TNJC, CSNJC, MLJC, Coffee' },
      excluded: { ...strs, description: 'exempt from: research, tea_talk, tea' }, joined: { ...str, description: 'YYYY-MM-DD' } }),
    run: async (a) => { const b = await data(true); let p = { rotas: [], excluded: [], active: true };
      if (a.id) { const id = personId(b, a.id); p = { ...b.data.people.find((x) => x.id === id) }; }
      for (const k of ['name', 'position', 'active', 'rotas', 'excluded', 'joined']) if (a[k] !== undefined) p[k] = a[k];
      const saved = await api('api_site_save_person', TOKEN, p); changed(); return saved; } },
  { name: 'save_rota_rule', description: 'Tea tsar: change when newcomers of a position join a duty. Values from rota_rules choices.',
    inputSchema: obj({ id: str, research: str, tea_talk: str, tea: str }, ['id']),
    run: async (a) => { const rule = { id: norm(a.id) }; for (const k of ['research', 'tea_talk', 'tea']) if (a[k] !== undefined) rule[k] = a[k];
      const r = await api('api_site_save_rule', TOKEN, rule); changed(); return r; } },
  { name: 'edit_page', description: 'Change a page of the site (tsars), with ops applied in order: {op:"update", id, rt} new text for a block; {op:"insert", tmp, parent, after, type, rt} a new block (type p, h1, h2, h3, ul, ol, todo, toggle, quote) under parent (the page slug or a block id) after block `after` (or first); {op:"delete", id}; {op:"cells", id, cells:[rt,…]} a table row; {op:"title", title}. rt is rich text: [{text, b?, i?, s?, u?, code?, color?, href?}]. Read the page first for the block ids.',
    inputSchema: obj({ slug: str, ops: { type: 'array', items: { type: 'object' } } }, ['slug', 'ops']),
    run: async (a) => { const p = await api('api_site_edit_page', TOKEN, a.slug, a.ops); changed(); return `# ${p.title}\n\n` + pageText(p.blocks).join('\n'); } },

  { name: 'set_talk_title', description: 'Your own upcoming talk: set its title and description (the calendar and the reminder emails show them). slot_id from my_tea_page.',
    inputSchema: obj({ slot_id: str, title: str, description: str }, ['slot_id', 'title']),
    run: async (a) => { const r = await api('api_title', TOKEN, norm(a.slot_id), a.title, a.description || ''); changed(); return r; } },
  { name: 'ask_swap', description: 'Ask someone to take over one of your duties (they accept or decline by email or on their tea page; less than a day before the slot it goes through at once).',
    inputSchema: obj({ slot_id: str, duty: { type: 'string', enum: ['presenter', 'tea'] }, to: { ...str, description: 'name or id' } }, ['slot_id', 'duty', 'to']),
    run: async (a) => { const b = await data(); const r = await api('api_swap', TOKEN, norm(a.slot_id), a.duty, personId(b, a.to)); changed(); return r; } },
  { name: 'answer_swap', description: 'Accept or decline a swap request made to you (code from my_tea_page, "incoming").',
    inputSchema: obj({ code: str, accept: bool }, ['code', 'accept']), run: async (a) => { const r = await api('api_answer_swap_mine', TOKEN, a.code, a.accept); changed(); return r; } },
  { name: 'withdraw_swap', description: 'Withdraw a swap request you made (code from my_tea_page, a duty\'s "pending").',
    inputSchema: obj({ code: str }, ['code']), run: async (a) => { const r = await api('api_withdraw_swap', TOKEN, a.code); changed(); return r; } },
  { name: 'cancel_talk', description: 'Last resort when nobody can take over your talk: cancels it (you keep your turn; the organiser is told). Only for your own upcoming talk.',
    inputSchema: obj({ slot_id: str, reason: { ...str, description: 'who you asked, and why it cannot happen' } }, ['slot_id', 'reason']),
    run: async (a) => { const r = await api('api_cancel', TOKEN, norm(a.slot_id), a.reason); changed(); return r; } },
  { name: 'add_away', description: 'Add dates you are away (you will not be scheduled then).',
    inputSchema: obj({ from: { ...str, description: 'YYYY-MM-DD' }, to: { ...str, description: 'YYYY-MM-DD' }, reason: str }, ['from', 'to']),
    run: async (a) => api('api_add_away', TOKEN, a.from, a.to, a.reason || '') },
  { name: 'remove_away', description: 'Remove away dates (row number from my_tea_page, "away").',
    inputSchema: obj({ row: { type: 'number' } }, ['row']), run: async (a) => api('api_remove_away', TOKEN, a.row) },

  { name: 'plan_slots', description: 'Organisers: create the slots for these dates (bank holidays skipped, existing slots kept) and fill them fairly. They stay tentative until finalise. rota: TNJC, MLJC, Coffee Cleaning or talks (talks take research_from/research_to and tea_from/tea_to instead of from/to).',
    inputSchema: obj({ rota: str, from: str, to: str, research_from: str, research_to: str, tea_from: str, tea_to: str }, ['rota']),
    run: async (a) => { const { rota, ...ranges } = a; const r = await api('api_plan_slots', TOKEN, rota, ranges); changed(); return r; } },
  { name: 'fill_slots', description: 'Organisers: fill the empty tentative slots of a rota again, fairly.',
    inputSchema: obj({ rota: str }, ['rota']), run: async (a) => { const r = await api('api_fill_slots', TOKEN, a.rota); changed(); return r; } },
  { name: 'finalise', description: 'Organisers: put the tentative slots of a rota on the calendar; email_group also sends the usual "schedule updated" email to the group.',
    inputSchema: obj({ rota: str, email_group: bool }, ['rota']), run: async (a) => { const r = await api('api_finalise', TOKEN, a.rota, !!a.email_group); changed(); return r; } },
];

// ---------- MCP over stdio (JSON-RPC 2.0, one message per line) ----------

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled) need no answer
  try {
    if (method === 'initialize') {
      return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
        serverInfo: { name: 'gatsby-teabot', version: '1.0.0' },
        instructions: 'The Gatsby Unit tea and talk rotas (the Gatsby Rotas site and the tea bot). Acts as one person; changes are logged under their name and the calendar follows within the hour.' } });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
      try {
        const out = await tool.run(params.arguments || {});
        return send({ id, result: { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] } });
      } catch (err) {
        return send({ id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
  } catch (err) {
    send({ id, error: { code: -32603, message: err.message } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    handle(msg);
  }
});
