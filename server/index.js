#!/usr/bin/env node
// FoxBridge MCP server - lets Claude Code drive Firefox through the FoxBridge extension.
// © 2026 Jennifer K. Telfer
'use strict';
const http = require('http');
const crypto = require('crypto');

const VERSION = '0.1.0';
const PORT = Number(process.env.FOXBRIDGE_PORT || 47821);
const log = (...a) => process.stderr.write('[foxbridge] ' + a.join(' ') + '\n');

// ---------------- Tool catalog ----------------
const tabId = { type: 'number', description: 'Tab to act on. Omit for the active tab.' };
const ref = { type: 'string', description: 'Element ref (ref_N) from read_page or find.' };
const TOOLS = [
  { name: 'tabs_list', description: 'List every open Firefox tab (tabId, title, url, active).', inputSchema: { type: 'object', properties: {} } },
  { name: 'tabs_create', description: 'Open a new tab, optionally at a URL. Returns its tabId.', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
  { name: 'tabs_close', description: 'Close a tab.', inputSchema: { type: 'object', properties: { tabId }, required: ['tabId'] } },
  { name: 'tabs_select', description: 'Bring a tab to the front.', inputSchema: { type: 'object', properties: { tabId }, required: ['tabId'] } },
  { name: 'navigate', description: 'Go to a URL in a tab and wait for it to load. Use "back" or "forward" for history.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, tabId }, required: ['url'] } },
  { name: 'screenshot', description: 'Screenshot the visible part of a tab. Image pixels equal CSS pixels, so x/y from it work with click.', inputSchema: { type: 'object', properties: { tabId } } },
  { name: 'read_page', description: 'Read the page as an indented accessibility-style tree. Interactive elements get [ref_N] tags for click/type/form_input.', inputSchema: { type: 'object', properties: { tabId, filter: { type: 'string', enum: ['all', 'interactive'] }, max_chars: { type: 'number' } } } },
  { name: 'find', description: 'Find elements whose role, name or text contains the query (case-insensitive). Returns up to 20 refs.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, tabId }, required: ['query'] } },
  { name: 'get_page_text', description: 'Get the visible text of the page (main/article first, else body).', inputSchema: { type: 'object', properties: { tabId, max_chars: { type: 'number' } } } },
  { name: 'click', description: 'Click an element by ref, or at x/y (CSS pixels from screenshot).', inputSchema: { type: 'object', properties: { ref, x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'double'] }, tabId } } },
  { name: 'type', description: 'Type text into the focused element, or into ref after focusing it.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, ref, tabId }, required: ['text'] } },
  { name: 'key', description: 'Press keys, space-separated, e.g. "Enter", "ctrl+a Backspace", "shift+Tab".', inputSchema: { type: 'object', properties: { keys: { type: 'string' }, tabId }, required: ['keys'] } },
  { name: 'scroll', description: 'Scroll the page (or a ref element) up/down/left/right by amount ticks (100px each). With only ref, scrolls it into view.', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' }, ref, tabId } } },
  { name: 'form_input', description: 'Set a form field value by ref: text inputs, textareas, selects (option value or text), checkboxes/radios (true/false).', inputSchema: { type: 'object', properties: { ref, value: {}, tabId }, required: ['ref', 'value'] } },
  { name: 'javascript', description: 'Run JavaScript in the page and return the last expression value (JSON). For async code use (async () => { ... })().', inputSchema: { type: 'object', properties: { code: { type: 'string' }, tabId }, required: ['code'] } },
  { name: 'console_messages', description: 'Read console output captured from the page.', inputSchema: { type: 'object', properties: { tabId, onlyErrors: { type: 'boolean' }, limit: { type: 'number' }, pattern: { type: 'string' } } } },
  { name: 'network_requests', description: 'List network requests made by the tab since its last page load.', inputSchema: { type: 'object', properties: { tabId, limit: { type: 'number' }, urlPattern: { type: 'string' } } } },
  { name: 'wait', description: 'Wait a number of seconds (max 10).', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
];

// ---------------- Minimal WebSocket server (no dependencies) ----------------
let ext = null;
let bridgeError = null;
const pending = new Map();
let nextId = 1;

function wsSend(sock, str) {
  const p = Buffer.from(str, 'utf8');
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  sock.write(Buffer.concat([h, p]));
}

function attach(sock) {
  let buf = Buffer.alloc(0);
  let frags = [];
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mk = masked ? 4 : 0;
      if (buf.length < off + mk + len) return;
      let data = Buffer.from(buf.subarray(off + mk, off + mk + len));
      if (masked) { const m = buf.subarray(off, off + 4); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
      buf = buf.subarray(off + mk + len);
      if (op === 0x8) { sock.end(); return; }
      if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 0xa) continue;
      frags.push(data);
      if (fin) { const text = Buffer.concat(frags).toString('utf8'); frags = []; onExtMessage(text); }
    }
  });
  const drop = () => {
    if (ext === sock) { ext = null; log('Firefox disconnected'); }
  };
  sock.on('close', drop);
  sock.on('error', drop);
}

function onExtMessage(text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.type === 'hello') { log('Firefox connected, extension', msg.version || '?'); return; }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
}

function callExt(name, args, timeoutMs = 60000) {
  if (bridgeError) return Promise.reject(new Error(bridgeError));
  if (!ext) return Promise.reject(new Error('Firefox is not connected. Open Firefox with the FoxBridge extension installed (its toolbar badge shows "off" while disconnected).'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${name} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    wsSend(ext, JSON.stringify({ id, name, args }));
  });
}

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`FoxBridge ${VERSION} - ${ext ? 'Firefox connected' : 'waiting for Firefox'}\n`);
});
httpServer.on('upgrade', (req, sock) => {
  const origin = req.headers.origin || '';
  const key = req.headers['sec-websocket-key'];
  if (!origin.startsWith('moz-extension://') || !key) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  if (ext) try { ext.end(); } catch {}
  ext = sock;
  attach(sock);
});
httpServer.on('error', e => {
  bridgeError = e.code === 'EADDRINUSE'
    ? `Port ${PORT} is already used by another FoxBridge session. Close the other Claude session, or set FOXBRIDGE_PORT for both this server and the extension.`
    : `FoxBridge server error: ${e.message}`;
  log(bridgeError);
});
httpServer.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT}`));

// ---------------- MCP over stdio (newline-delimited JSON-RPC) ----------------
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function replyErr(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

function toContent(result) {
  if (result && result.image) {
    const out = [{ type: 'image', data: result.image, mimeType: result.mime || 'image/png' }];
    if (result.note) out.push({ type: 'text', text: result.note });
    return out;
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return [{ type: 'text', text: text === undefined ? 'OK' : text }];
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'foxbridge', version: VERSION },
      instructions: 'FoxBridge controls the user\'s Firefox. Start with tabs_list or navigate; use read_page/find to get [ref_N] tags, then click/type/form_input by ref. Prefer read_page and get_page_text over screenshots for reading.',
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      if (!TOOLS.some(t => t.name === name)) throw new Error(`Unknown tool ${name}`);
      if (name === 'wait') {
        const s = Math.max(0, Math.min(10, Number(args.seconds) || 0));
        await new Promise(r => setTimeout(r, s * 1000));
        return reply(id, { content: [{ type: 'text', text: `Waited ${s}s` }] });
      }
      const result = await callExt(name, args);
      return reply(id, { content: toContent(result) });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true });
    }
  }
  if (id !== undefined) replyErr(id, -32601, `Method not found: ${method}`);
}

let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  inBuf += d;
  let i;
  while ((i = inBuf.indexOf('\n')) >= 0) {
    const line = inBuf.slice(0, i).trim();
    inBuf = inBuf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch(e => log('handler error', e.message));
  }
});
process.stdin.on('end', () => process.exit(0));
