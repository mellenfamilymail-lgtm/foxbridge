// © 2026 Jennifer K. Mellen - FoxBridge smoke test
const { spawn } = require('child_process');
const p = spawn('node', ['D:/FirefoxClaude/server/index.js']);
p.stderr.on('data', d => process.stdout.write('ERR ' + d));
let buf = '', id = 0; const waits = {};
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waits[m.id] && waits[m.id](m); } });
const call = (method, params) => new Promise(r => { const n = ++id; waits[n] = r; p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const tool = async (name, args = {}) => { const r = await call('tools/call', { name, arguments: args }); const c = r.result.content.map(x => x.type === 'image' ? `[image ${x.data.length} b64]` : x.text).join('\n'); console.log(`--- ${name}${r.result.isError ? ' ERROR' : ''}\n${c.slice(0, 900)}`); return r; };
(async () => {
  await call('initialize', {});
  await new Promise(r => setTimeout(r, 4000)); // let extension reconnect
  await tool('tabs_list');
  await tool('navigate', { url: 'https://duckduckgo.com/html/' });
  await tool('find', { query: 'search' });
  await tool('read_page', { filter: 'interactive' });
  await tool('javascript', { code: 'document.title + " | " + navigator.userAgent' });
  await tool('type', { ref: 'ref_3', text: 'firefox webextensions' });
  await tool('key', { keys: 'Enter' });
  await tool('wait', { seconds: 3 });
  await tool('get_page_text', { max_chars: 300 });
  await tool('navigate', { url: 'example.com' });
  await tool('javascript', { code: 'console.error("hello from test"); document.title' });
  await tool('console_messages');
  await tool('find', { query: 'learn more' });
  await tool('click', { ref: 'ref_1' });
  await tool('wait', { seconds: 2 });
  await tool('tabs_list');
  p.kill(); process.exit(0);
})();
