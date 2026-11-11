// FoxBridge background - connects Firefox to the local FoxBridge MCP server.
// © 2026 Jennifer K. Telfer
'use strict';
const PORT = 47821;
const netLog = new Map(); // tabId -> [{...}]
let ws = null;

function setBadge(on) {
  browser.browserAction.setBadgeText({ text: on ? '' : 'off' });
  browser.browserAction.setBadgeBackgroundColor({ color: '#b00020' });
  browser.browserAction.setTitle({ title: on ? 'FoxBridge: connected to Claude' : 'FoxBridge: waiting for Claude' });
}

function connect() {
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}`); }
  catch (e) { setTimeout(connect, 2000); return; }
  ws.onopen = () => { setBadge(true); ws.send(JSON.stringify({ type: 'hello', version: browser.runtime.getManifest().version })); };
  ws.onclose = () => { setBadge(false); setTimeout(connect, 2000); };
  ws.onerror = () => {};
  ws.onmessage = async ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    try {
      const result = await run(msg.name, msg.args || {});
      ws.send(JSON.stringify({ id: msg.id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, error: String((e && e.message) || e) }));
    }
  };
}

// ---------- network log ----------
function logNet(d, error) {
  if (d.tabId < 0) return;
  if (d.type === 'main_frame' && !error && d.statusCode === undefined) return;
  let list = netLog.get(d.tabId);
  if (!list) netLog.set(d.tabId, list = []);
  list.push({ method: d.method, url: d.url, type: d.type, status: d.statusCode, error, time: Math.round(d.timeStamp) });
  if (list.length > 500) list.shift();
}
browser.webRequest.onBeforeRequest.addListener(d => { if (d.type === 'main_frame' && d.tabId >= 0) netLog.set(d.tabId, []); }, { urls: ['<all_urls>'] });
browser.webRequest.onCompleted.addListener(d => logNet(d), { urls: ['<all_urls>'] });
browser.webRequest.onErrorOccurred.addListener(d => logNet(d, d.error), { urls: ['<all_urls>'] });
browser.tabs.onRemoved.addListener(id => netLog.delete(id));

// ---------- helpers ----------
async function getTab(tabId) {
  if (tabId !== undefined && tabId !== null) return browser.tabs.get(Number(tabId));
  const [t] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (t) return t;
  const [any] = await browser.tabs.query({ active: true });
  if (any) return any;
  return browser.tabs.create({});
}

function waitForLoad(tabId, ms = 20000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); clearInterval(poll); browser.tabs.onUpdated.removeListener(onUp); resolve(); };
    const onUp = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const timer = setTimeout(finish, ms);
    const poll = setInterval(async () => {
      try { const t = await browser.tabs.get(tabId); if (t.status === 'complete') finish(); } catch { finish(); }
    }, 750);
    browser.tabs.onUpdated.addListener(onUp);
  });
}

async function toContent(tab, cmd, args) {
  const msg = { foxbridge: true, cmd, args };
  try { return await browser.tabs.sendMessage(tab.id, msg); }
  catch (e) {
    try { await browser.tabs.executeScript(tab.id, { file: '/content.js', runAt: 'document_idle' }); }
    catch (e2) { throw new Error(`Can't reach this page (${tab.url}). Firefox blocks extensions on about:, addons.mozilla.org and some internal pages.`); }
    return browser.tabs.sendMessage(tab.id, msg);
  }
}

function normalizeUrl(u) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u)) return 'http://' + u;
  return 'https://' + u;
}

const tabInfo = t => ({ tabId: t.id, windowId: t.windowId, active: t.active, title: t.title, url: t.url, status: t.status });

// ---------- commands ----------
async function run(name, a) {
  switch (name) {
    case 'tabs_list':
      return (await browser.tabs.query({})).map(tabInfo);
    case 'tabs_create': {
      const t = await browser.tabs.create({ url: a.url ? normalizeUrl(a.url) : undefined });
      if (a.url) await waitForLoad(t.id);
      return tabInfo(await browser.tabs.get(t.id));
    }
    case 'tabs_close':
      await browser.tabs.remove(Number(a.tabId));
      return `Closed tab ${a.tabId}`;
    case 'tabs_select': {
      const t = await browser.tabs.update(Number(a.tabId), { active: true });
      await browser.windows.update(t.windowId, { focused: true });
      return tabInfo(t);
    }
    case 'navigate': {
      const tab = await getTab(a.tabId);
      if (a.url === 'back') await browser.tabs.goBack(tab.id);
      else if (a.url === 'forward') await browser.tabs.goForward(tab.id);
      else await browser.tabs.update(tab.id, { url: normalizeUrl(a.url) });
      await new Promise(r => setTimeout(r, 300));
      await waitForLoad(tab.id);
      return tabInfo(await browser.tabs.get(tab.id));
    }
    case 'screenshot': {
      let tab = await getTab(a.tabId);
      if (!tab.active) { tab = await browser.tabs.update(tab.id, { active: true }); await new Promise(r => setTimeout(r, 300)); }
      let m = { dpr: 1 };
      try { m = await toContent(tab, 'metrics', {}); } catch {}
      const url = await browser.tabs.captureTab(tab.id, { format: 'png', scale: 1 / (m.dpr || 1) });
      return { image: url.split(',')[1], mime: 'image/png', note: m.w ? `Viewport ${m.w}x${m.h} CSS px, scrolled to ${m.sx},${m.sy}. Image pixels = click coordinates.` : '' };
    }
    case 'network_requests': {
      const tab = await getTab(a.tabId);
      let list = netLog.get(tab.id) || [];
      if (a.urlPattern) list = list.filter(r => r.url.includes(a.urlPattern));
      return list.slice(-(a.limit || 50));
    }
    case 'read_page': case 'find': case 'get_page_text': case 'click': case 'type':
    case 'key': case 'scroll': case 'form_input': case 'javascript': case 'console_messages': {
      const tab = await getTab(a.tabId);
      const r = await toContent(tab, name, a);
      if (r && r.__error && name === 'javascript' && /CSP|eval/i.test(r.__error)) {
        // Page CSP blocks eval: run the code as an injected script (sees the DOM, not page globals).
        const [v] = await browser.tabs.executeScript(tab.id, { code: String(a.code) });
        return v === undefined ? 'undefined (ran in isolated scope because the page blocks eval)' : v;
      }
      if (r && r.__error) throw new Error(r.__error);
      if (name === 'click' || name === 'key') await new Promise(res => setTimeout(res, 250));
      return r;
    }
    default:
      throw new Error(`Unknown command ${name}`);
  }
}

setBadge(false);
connect();
