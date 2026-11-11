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
    if (args[0] === 'tok2' || args[1] === 'tok2') {  // someone who organises nothing
      if (fn === 'api_site_bundle') result = { pages, data: { schedule, people, rota_rules: [], options: { rules: {} } }, me: { person: 'b'.repeat(32), slots: [], people: [], pages: false, rules: false } };
      else if (fn === 'api_state') result = { name: 'Nikolai Petrov', duties: [{ row_id: '2'.repeat(32), duty: 'presenter', usual: ['a'.repeat(32)] }], people: [{ id: 'a'.repeat(32), name: 'Lena Weber' }], badge: null };
      else if (fn === 'api_site_save_photo') result = 'v2';
      else if (fn === 'api_change_email' || fn === 'api_leave' || fn === 'api_swap') result = 'done ' + fn;
      else { ok = false; error = 'Exception: Only the tsars can change this.'; }
    } else if (args[0] === 'tok' || args[1] === 'tok') {
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
  const m = start('tok2');
  await t('mcp: someone without tsar rights: what they can do, their duties with who usually does them, a swap by name', async () => {
    const who = await m.tool('whoami');
    assert.strictEqual(who.json.name, 'Nikolai Petrov');
    assert.deepStrictEqual(who.json.can.length, 3, who.text);  // read, own duties, own photo and email: nothing more
    const page = await m.tool('my_tea_page');
    assert.deepStrictEqual(page.json.duties[0].usual, ['Lena Weber']);
    calls.length = 0;
    await m.tool('ask_swap', { slot_id: '2'.repeat(32), duty: 'presenter', to: 'Lena Weber' });
    assert.deepStrictEqual(calls.find((c) => c[0] === 'api_swap')[1], ['tok2', '2'.repeat(32), 'presenter', 'a'.repeat(32)]);
    const slot = await m.tool('save_slot', { id: '2'.repeat(32), title: 'x' });
    assert.ok(slot.error && /tsars/.test(slot.text));
  });
  await t('mcp: own photo from a file (small square and up to 1600px), own email, leaving only when told so', async () => {
    // a 4 x 3 picture as a BMP (no checksums to get right), red to blue
    const w = 4, h = 3, row = w * 3, img = Buffer.alloc(54 + row * h);
    img.write('BM'); img.writeUInt32LE(img.length, 2); img.writeUInt32LE(54, 10); img.writeUInt32LE(40, 14);
    img.writeInt32LE(w, 18); img.writeInt32LE(h, 22); img.writeUInt16LE(1, 26); img.writeUInt16LE(24, 28); img.writeUInt32LE(row * h, 34);
    for (let i = 0; i < w * h; i++) img.set([i * 20, 0, 255 - i * 20], 54 + i * 3);
    const png = path.join(require('os').tmpdir(), 'teabot-test-photo.bmp');
    require('fs').writeFileSync(png, img);
    calls.length = 0;
    const r = await m.tool('set_photo', { file: png });
    if (/needs ImageMagick or macOS/.test(r.text)) console.log('     (photo resizing skipped: no sips or ImageMagick here)');
    else {
      assert.ok(!r.error, r.text);
      const sent = calls.find((c) => c[0] === 'api_site_save_photo')[1];
      assert.strictEqual(sent[1], 'b'.repeat(32));
      assert.ok(/^data:image\/jpeg;base64,\/9j\//.test(sent[2]) && /^data:image\/jpeg;base64,\/9j\//.test(sent[3]));
    }
    calls.length = 0;
    await m.tool('set_photo', {});
    assert.deepStrictEqual(calls.find((c) => c[0] === 'api_site_save_photo')[1].slice(1), ['b'.repeat(32), '', null]);
    assert.ok(/api_change_email/.test((await m.tool('change_my_email', { email: 'n@x' })).text));
    const no = await m.tool('leave_tea_system', { i_have_left_the_unit: false });
    assert.ok(no.error);
    assert.ok(/api_leave/.test((await m.tool('leave_tea_system', { i_have_left_the_unit: true })).text));
  });
  m.stop();
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
