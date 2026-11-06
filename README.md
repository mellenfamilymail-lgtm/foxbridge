# FoxBridge

© 2026 Jennifer K. Mellen

FoxBridge lets Claude Code drive Firefox the way Claude in Chrome drives Chrome.

## Parts
- `extension/` - Firefox extension (Manifest V2, persistent background). Connects to `ws://127.0.0.1:47821`.
- `server/index.js` - MCP server (stdio) plus the local WebSocket bridge. No dependencies; needs Node 18+.
- `.claude-plugin/`, `.mcp.json`, `skills/` - Claude Code plugin packaging. The repo is its own plugin marketplace.

## Install
Needs [Node.js](https://nodejs.org) 18 or newer and Claude Code.

1. **Claude Code plugin** - in Claude Code run:
   ```
   /plugin marketplace add mellenfamilymail-lgtm/foxbridge
   /plugin install foxbridge@foxbridge
   ```
2. **Firefox add-on** - until the Mozilla-signed version is listed on addons.mozilla.org:
   - Use [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/), open `about:config` and set `xpinstall.signatures.required` to `false`.
   - Download `foxbridge.xpi` from [Releases](https://github.com/mellenfamilymail-lgtm/foxbridge/releases) and drag it into Firefox.
3. Restart Claude Code and ask it to do something in Firefox.

## Build from source
`npm run build` writes `dist/foxbridge.xpi`. `node test/smoke.js` runs a live test against an open Firefox.

## Tools
tabs_list, tabs_create, tabs_close, tabs_select, navigate, screenshot, read_page, find, get_page_text,
click, type, key, scroll, form_input, javascript, console_messages, network_requests, wait.

## Known limits
Input events are synthetic (`isTrusted = false`). A planned WebDriver BiDi mode will add trusted input.
