// FoxBridge content script - reads and operates the page for Claude.
// © 2026 Jennifer K. Telfer
(() => {
  'use strict';
  if (window.__foxbridgeLoaded) return;
  window.__foxbridgeLoaded = true;

  // ---------- console capture (page context) ----------
  const logs = [];
  const pushLog = (level, text) => { logs.push({ level, text: String(text).slice(0, 2000), time: Date.now() }); if (logs.length > 500) logs.shift(); };
  const fmt = v => { try { if (typeof v === 'string') return v; const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch { try { return String(v); } catch { return '[object]'; } } };
  try {
    const pc = window.wrappedJSObject.console;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const orig = pc[level];
      exportFunction(function (...args) {
        try { pushLog(level, args.map(fmt).join(' ')); } catch {}
        return orig.call(pc, ...args);
      }, pc, { defineAs: level });
    }
  } catch {}
  window.addEventListener('error', e => pushLog('error', `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e => pushLog('error', 'Unhandled rejection: ' + fmt(e.reason)));

  // ---------- refs ----------
  const refs = new Map();
  const elRef = new WeakMap();
  let refSeq = 0;
  function refFor(el) {
    let r = elRef.get(el);
    if (!r) { r = 'ref_' + (++refSeq); elRef.set(el, r); refs.set(r, new WeakRef(el)); }
    return r;
  }
  function byRef(r) {
    const w = refs.get(r);
    const el = w && w.deref();
    if (!el || !el.isConnected) throw new Error(`${r} is gone - call read_page or find again`);
    return el;
  }

  // ---------- element description ----------
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[role=searchbox],[role=slider],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const isInteractive = el => el.matches(INTERACTIVE) && !el.disabled;
  function visible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || s.display === 'contents';
  }
  function role(el) {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'link';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'img') return 'img';
    if (/^h[1-6]$/.test(t)) return 'heading' + t[1];
    if (t === 'input') {
      const ty = (el.type || 'text').toLowerCase();
      if (['checkbox', 'radio', 'range', 'file', 'color', 'date'].includes(ty)) return ty;
      if (['button', 'submit', 'reset', 'image'].includes(ty)) return 'button';
      return ty === 'search' ? 'searchbox' : 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return { nav: 'navigation', main: 'main', form: 'form', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', dialog: 'dialog', header: 'banner', footer: 'contentinfo', aside: 'complementary', label: 'label', p: 'paragraph', iframe: 'iframe' }[t] || 'generic';
  }
  const clean = (s, n = 80) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  function accName(el) {
    const a = el.getAttribute('aria-label');
    if (a) return clean(a);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(e => e.textContent).join(' '); if (clean(t)) return clean(t); }
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && clean(l.textContent)) return clean(l.textContent); }
    if (el.labels && el.labels[0] && clean(el.labels[0].textContent)) return clean(el.labels[0].textContent);
    const alt = el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder');
    if (alt) return clean(alt);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return clean(el.value);
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return clean(el.name || '');
    return clean(el.innerText || el.textContent);
  }
  function describe(el) {
    const parts = [role(el)];
    const n = accName(el);
    if (n) parts.push(JSON.stringify(n));
    if (el.tagName === 'A' && el.getAttribute('href')) parts.push('href=' + clean(el.getAttribute('href'), 100));
    if (['INPUT', 'TEXTAREA'].includes(el.tagName) && !['checkbox', 'radio', 'button', 'submit'].includes(el.type) && el.value) parts.push('value=' + JSON.stringify(clean(el.value, 60)));
    if (el.tagName === 'SELECT' && el.selectedOptions[0]) parts.push('selected=' + JSON.stringify(clean(el.selectedOptions[0].text, 60)));
    if (el.checked) parts.push('checked');
    if (el.disabled) parts.push('disabled');
    parts.push(`[${refFor(el)}]`);
    return parts.join(' ');
  }
  function ownText(el) {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
    return clean(s, 200);
  }

  function readPage(filter, maxChars) {
    const lines = [];
    let len = 0;
    const onlyInteractive = filter === 'interactive';
    function walk(el, depth) {
      if (len > maxChars) return;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG'].includes(el.tagName.toUpperCase())) return;
      if (!visible(el)) return;
      const inter = isInteractive(el);
      const r = role(el);
      let emitted = false;
      let line = null;
      if (inter) line = describe(el);
      else if (!onlyInteractive) {
        if (r.startsWith('heading') || (r === 'img' && accName(el)) || ['navigation', 'main', 'form', 'dialog', 'table', 'list'].includes(r)) line = describe(el);
        else { const t = ownText(el); if (t) line = 'text ' + JSON.stringify(t); }
      }
      if (line) { const l = '  '.repeat(depth) + line; lines.push(l); len += l.length + 1; emitted = true; }
      if (inter && ['A', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT'].includes(el.tagName)) return;
      const kids = el.shadowRoot ? [...el.shadowRoot.children, ...el.children] : el.children;
      for (const c of kids) walk(c, depth + (emitted ? 1 : 0));
    }
    walk(document.body || document.documentElement, 0);
    let out = `Page: ${document.title} (${location.href})\n` + lines.join('\n');
    if (out.length > maxChars) out = out.slice(0, maxChars) + `\n... truncated at ${maxChars} chars; use filter "interactive" or find.`;
    return out;
  }

  function find(q) {
    q = String(q).toLowerCase();
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (out.length >= 20) break;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const inter = isInteractive(el);
      if (!inter && !ownText(el) && !el.getAttribute('aria-label') && !el.getAttribute('alt')) continue;
      const hay = (role(el) + ' ' + accName(el) + ' ' + ownText(el) + ' ' + (el.getAttribute('href') || '')).toLowerCase();
      if (!hay.includes(q) || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      out.push(`${describe(el)} at (${Math.round(r.x + r.width / 2)}, ${Math.round(r.y + r.height / 2)})`);
    }
    return out.length ? out.join('\n') : `No elements match "${q}".`;
  }

  // ---------- input ----------
  function center(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }
  function mouse(el, type, x, y, button = 0, detail = 1) {
    const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    const down = type.endsWith('down');
    el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons: down ? (button === 2 ? 2 : 1) : 0, detail, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }
  function click(a) {
    let el, x, y;
    if (a.ref) { el = byRef(a.ref); [x, y] = center(el); const hit = document.elementFromPoint(x, y); if (hit && el.contains(hit)) el = hit; }
    else if (a.x !== undefined && a.y !== undefined) { x = Number(a.x); y = Number(a.y); el = document.elementFromPoint(x, y); if (!el) throw new Error(`Nothing at (${x}, ${y})`); }
    else throw new Error('click needs ref or x/y');
    const btn = a.button === 'right' ? 2 : 0;
    mouse(el, 'pointerover', x, y); mouse(el, 'mouseover', x, y);
    const times = a.button === 'double' ? 2 : 1;
    for (let i = 1; i <= times; i++) {
      mouse(el, 'pointerdown', x, y, btn, i); mouse(el, 'mousedown', x, y, btn, i);
      const f = el.closest('input,textarea,select,button,a,[tabindex],[contenteditable]');
      if (f && f.focus) f.focus();
      mouse(el, 'pointerup', x, y, btn, i); mouse(el, 'mouseup', x, y, btn, i);
      if (btn === 2) mouse(el, 'contextmenu', x, y, 2, i);
      else mouse(el, 'click', x, y, 0, i);
    }
    if (times === 2) mouse(el, 'dblclick', x, y, 0, 2);
    return 'Clicked ' + describe(el.closest(INTERACTIVE) || el);
  }
  const isEditable = el => el && (el.isContentEditable || (el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(el.type)));
  function insertText(el, text) {
    if (document.execCommand('insertText', false, text)) return;
    if (el.isContentEditable) { el.textContent += text; }
    else {
      const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      try { el.setSelectionRange(s + text.length, s + text.length); } catch {}
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
  function type(a) {
    if (a.ref) { const el = byRef(a.ref); center(el); el.focus(); if (el.setSelectionRange && el.value !== undefined) { try { el.setSelectionRange(el.value.length, el.value.length); } catch {} } }
    const el = document.activeElement;
    if (!isEditable(el)) throw new Error('No text field is focused. Click one first or pass its ref.');
    insertText(el, String(a.text));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return `Typed ${String(a.text).length} chars into ${describe(el)}`;
  }

  const KEYMAP = { enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', space: ' ', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
  function focusables() {
    return [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable=true]')].filter(e => !e.disabled && visible(e));
  }
  function pressOne(combo) {
    const parts = combo.split('+');
    const raw = parts.pop();
    const mods = new Set(parts.map(p => p.toLowerCase()));
    const ctrl = mods.has('ctrl') || mods.has('control'), shift = mods.has('shift'), alt = mods.has('alt'), meta = mods.has('cmd') || mods.has('meta');
    const key = KEYMAP[raw.toLowerCase()] || raw;
    const target = document.activeElement || document.body;
    const code = key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : '') : key;
    const opts = { key, code, bubbles: true, cancelable: true, composed: true, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta };
    const allowed = target.dispatchEvent(new KeyboardEvent('keydown', opts));
    if (allowed && (key.length === 1 || key === 'Enter') && !ctrl && !meta) target.dispatchEvent(new KeyboardEvent('keypress', opts));
    if (allowed) {
      const lk = key.toLowerCase();
      if ((ctrl || meta) && lk === 'a') { if (target.select) target.select(); else document.execCommand('selectAll'); }
      else if ((ctrl || meta) && ['c', 'x', 'v', 'z', 'y'].includes(lk)) document.execCommand({ c: 'copy', x: 'cut', v: 'paste', z: 'undo', y: 'redo' }[lk]);
      else if (key === 'Enter') {
        if (target.tagName === 'TEXTAREA' || target.isContentEditable) insertText(target, '\n');
        else if (target.form) { if (target.form.requestSubmit) target.form.requestSubmit(); else target.form.submit(); }
        else if (target.click && target.matches('a,button,[role=button],[role=link]')) target.click();
      }
      else if (key === ' ' && target.matches('button,[role=button],input[type=checkbox],input[type=radio]')) target.click();
      else if (key === 'Backspace' && isEditable(target)) document.execCommand('delete');
      else if (key === 'Delete' && isEditable(target)) document.execCommand('forwardDelete');
      else if (key === 'Tab') { const f = focusables(); const i = f.indexOf(target); const n = f[(i + (shift ? -1 : 1) + f.length) % f.length]; if (n) n.focus(); }
      else if (key.length === 1 && !ctrl && !meta && !alt && isEditable(target)) insertText(target, key);
      else if (!isEditable(target)) {
        const dy = { ArrowDown: 40, ArrowUp: -40, PageDown: innerHeight * 0.9, PageUp: -innerHeight * 0.9, ' ': innerHeight * 0.9 }[key];
        if (dy) scrollBy(0, dy);
        if (key === 'Home') scrollTo(0, 0);
        if (key === 'End') scrollTo(0, document.documentElement.scrollHeight);
      }
    }
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }
  function keys(a) {
    const list = String(a.keys).trim().split(/\s+/);
    for (const k of list) pressOne(k);
    return `Pressed ${list.join(' ')}`;
  }

  function scroll(a) {
    if (a.ref && !a.direction) { byRef(a.ref).scrollIntoView({ block: 'center' }); return `Scrolled ${a.ref} into view`; }
    const px = (Number(a.amount) || 3) * 100;
    const [dx, dy] = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[a.direction || 'down'];
    if (a.ref) byRef(a.ref).scrollBy(dx, dy); else scrollBy(dx, dy);
    return `Scrolled to ${Math.round(scrollX)}, ${Math.round(scrollY)}`;
  }

  function formInput(a) {
    const el = byRef(a.ref);
    center(el);
    const v = a.value;
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === String(v)) || [...el.options].find(o => clean(o.text).toLowerCase() === String(v).toLowerCase());
      if (!opt) throw new Error(`No option "${v}". Options: ${[...el.options].map(o => clean(o.text)).join(' | ')}`);
      el.value = opt.value;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      const want = v === true || v === 'true' || v === 1 || v === 'on';
      if (el.checked !== want) el.click();
      return describe(el);
    } else if (isEditable(el)) {
      el.focus();
      if (el.select) el.select(); else document.execCommand('selectAll');
      const s = String(v);
      if (s === '') document.execCommand('delete'); else insertText(el, s);
      if (!el.isContentEditable && el.value !== s) { el.value = s; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    } else throw new Error(`${a.ref} is not a form field`);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return describe(el);
  }

  async function js(a) {
    const w = window.wrappedJSObject;
    let r;
    r = w.eval(String(a.code)); // CSP errors fall back to executeScript in the background
    if (r && typeof r.then === 'function') r = await r;
    try { const s = w.JSON.stringify(r); if (s !== undefined) return JSON.parse(s); } catch {}
    try { return JSON.parse(JSON.stringify(r)); } catch {}
    return String(r);
  }

  const handlers = {
    metrics: () => ({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight, sx: Math.round(scrollX), sy: Math.round(scrollY) }),
    read_page: a => readPage(a.filter, Number(a.max_chars) || 40000),
    find: a => find(a.query),
    get_page_text: a => {
      const main = document.querySelector('main, article, [role=main]');
      let t = (main && main.innerText.trim().length > 200 ? main : document.body).innerText;
      const max = Number(a.max_chars) || 50000;
      return `${document.title}\n${location.href}\n\n` + (t.length > max ? t.slice(0, max) + '\n... truncated' : t);
    },
    click, type, key: keys, scroll, form_input: formInput, javascript: js,
    console_messages: a => {
      let l = logs;
      if (a.onlyErrors) l = l.filter(x => x.level === 'error');
      if (a.pattern) l = l.filter(x => x.text.includes(a.pattern));
      return l.slice(-(Number(a.limit) || 50));
    },
  };

  browser.runtime.onMessage.addListener(msg => {
    if (!msg || !msg.foxbridge) return;
    const h = handlers[msg.cmd];
    if (!h) return Promise.resolve({ __error: 'Unknown command ' + msg.cmd });
    return Promise.resolve().then(() => h(msg.args || {})).catch(e => ({ __error: String((e && e.message) || e) }));
  });
})();
