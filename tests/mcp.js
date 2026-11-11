// Tests for the MCP server (mcp/server.js), against a stand-in for the bot's web API. Run: node tests/mcp.js
'use strict';
const http = require('http'), path = require('path'), assert = require('assert'), { spawn } = require('child_process');

const DAY = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const people = [
  { id: 'a'.repeat(32), name: 'Lena Weber', position: 'PhD student', active: true, rotas: ['TNJC'], excluded: [], joined: '2025-10-01' },
  { id: 'b'.repeat(32), name: 'Nikolai Petrov', position: 'Postdoc', active: true, rotas: ['TNJC', 'CSNJC'], excluded: [], joined: '2024-01-01' },
  { id: 'c'.repeat(32), name: 'Lena Novak', position: 'PhD student', active: false, rotas: [], excluded: [], joined: '2019-10-01' },
];
const schedule = [
  { id: '1'.repeat(32), type: 'TNJC', title: 'Spikes', start: DAY + 'T13:30:00+00:00', end: DAY + 'T14:30:00+00:00', presenter: ['a'.repeat(32)], tea: [], guest: '', description: 'paper', csnjc: false, water_filter: false },
  { id: '2'.repeat(32), type: 'MLJC', title: '', start: DAY + 'T13:30:00+00:00', end: null, presenter: ['b'.repeat(32)], tea: [], guest: '', description: '', csnjc: false, water_filter: false },
];
const pages = { home: { id: 'h', slug: 'home', title: 'Gatsby Rotas', blocks: [{ id: 'p1', type: 'p', rt: [{ text: 'Hello ' }, { text: 'site', href: '/abc' }], children: [{ id: 'p2', type: 'ul', rt: [{ text: 'item' }] }] }] } };
const calls = [];

const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { fn, args } = JSON.parse(body);
    calls.push([fn, args]);
    let result, ok = true, error;
    if (args[0] === 'tok' || args[1] === 'tok' || fn === 'api_site_bundle' && args[1] === 'tok') {
      if (fn === 'api_site_bundle') result = { pages, data: { schedule, people, rota_rules: [], options: { rules: {} } }, me: { person: 'a'.repeat(32), slots: ['TNJC'], people: ['TNJC', 'CSNJC'], pages: true } };
      else if (fn === 'api_site_save_slot') result = { ...args[1], id: args[1].id || '9'.repeat(32), start: args[1].start + ':00+00:00' };
      else if (fn === 'api_site_save_person') result = args[1];
      else if (fn === 'api_state') result = { name: 'Lena Weber', duties: [], people: [{}], badge: {} };
      else { ok = false; error = 'Exception: Only the TNJC tsar can do that.'; }
    } else if (fn === 'api_site_bundle') result = null;
    else { ok = false; error = 'Exception: Your link is not valid any more.'; }
    res.end(JSON.stringify(ok ? { ok, result } : { ok, error }));
  });
});

function start(token) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], { env: { ...process.env, TEABOT_TOKEN: token, TEABOT_API: `http://127.0.0.1:${fake.address().port}/` } });
  let buf = '', next = 1;
  const waiting = {};
  child.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); waiting[m.id]?.(m); }
  });
  const rpc = (method, params) => new Promise((resolve) => { const id = next++; waiting[id] = resolve; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const tool = async (name, args = {}) => { const m = await rpc('tools/call', { name, arguments: args }); const t = m.result.content[0].text; return { error: !!m.result.isError, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }; };
  return { rpc, tool, stop: () => child.kill() };
}

const results = [];
async function t(name, fn) { try { await fn(); results.push('ok   ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message); } }

fake.listen(0, '127.0.0.1', async () => {
  const s = start('tok');
  await t('mcp: handshake and tool list', async () => {
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.strictEqual(init.result.serverInfo.name, 'gatsby-teabot');
    const list = await s.rpc('tools/list', {});
    const names = list.result.tools.map((x) => x.name);
    for (const n of ['whoami', 'schedule', 'people', 'save_slot', 'save_person', 'edit_page', 'ask_swap', 'plan_slots', 'finalise']) assert.ok(names.includes(n), n);
    assert.ok(list.result.tools.every((x) => x.inputSchema && x.inputSchema.type === 'object'));
  });
  await t('mcp: schedule by person name, with names instead of ids', async () => {
    const r = await s.tool('schedule', { person: 'nikolai' });
    assert.deepStrictEqual(r.json.map((x) => [x.type, x.presenter]), [['MLJC', ['Nikolai Petrov']]]);
  });
  await t('mcp: an ambiguous or unknown name is refused, an active one preferred', async () => {
    assert.deepStrictEqual((await s.tool('schedule', { person: 'Lena' })).json.map((x) => x.type), ['TNJC']);  // Lena Novak is inactive: Lena Weber it is
    const r = await s.tool('save_slot', { id: '1'.repeat(32), tea: ['Nobody Here'] });
    assert.ok(r.error && /Nobody called/.test(r.text));
  });
  await t('mcp: changing a slot keeps the fields not given', async () => {
    calls.length = 0;
    const r = await s.tool('save_slot', { id: '1'.repeat(32), title: 'New title', tea: ['Nikolai Petrov'] });
    assert.ok(!r.error, r.text);
    const sent = calls.find((c) => c[0] === 'api_site_save_slot')[1][1];
    assert.deepStrictEqual([sent.title, sent.start, sent.end, sent.presenter, sent.tea, sent.description],
      ['New title', DAY + 'T13:30', DAY + 'T14:30', ['a'.repeat(32)], ['b'.repeat(32)], 'paper']);
    assert.deepStrictEqual(r.json.tea, ['Nikolai Petrov']);
  });
  await t('mcp: changing a person keeps the fields not given', async () => {
    calls.length = 0;
    await s.tool('save_person', { id: 'Nikolai Petrov', rotas: ['TNJC'] });
    const sent = calls.find((c) => c[0] === 'api_site_save_person')[1][1];
    assert.deepStrictEqual([sent.name, sent.position, sent.active, sent.rotas], ['Nikolai Petrov', 'Postdoc', true, ['TNJC']]);
  });
  await t('mcp: pages read as lines with block ids; the bot\'s refusals come back as tool errors', async () => {
    const page = await s.tool('read_page', { slug: 'home' });
    assert.ok(page.text.includes('[p1] p: Hello [site](/abc)') && page.text.includes('  [p2] ul: item'), page.text);
    const r = await s.tool('remove_slot', { id: '1'.repeat(32) });
    assert.ok(r.error && r.text === 'Only the TNJC tsar can do that.', r.text);
    const me = await s.tool('my_tea_page');
    assert.ok(me.json.name === 'Lena Weber' && !('people' in me.json) && !('badge' in me.json));
  });
  s.stop();
  const bad = start('nope');
  await t('mcp: an unknown code is said so', async () => {
    const r = await bad.tool('whoami');
    assert.ok(r.error && /does not know this code/.test(r.text), r.text);
  });
  bad.stop();
  fake.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
});
