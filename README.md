# FoxBridge

© 2026 Jennifer K. Mellen

FoxBridge lets Claude Code drive Firefox the way Claude in Chrome drives Chrome.

## Parts
- `extension/` - Firefox extension (Manifest V2, persistent background). Connects to `ws://127.0.0.1:47821`.
- `server/index.js` - MCP server (stdio) plus the local WebSocket bridge. No dependencies; needs Node 18+.
- `.claude-plugin/`, `.mcp.json`, `skills/` - Claude Code plugin packaging. The repo is its own plugin marketplace.

## Install (development)
1. Firefox Developer Edition with `xpinstall.signatures.required = false`.
2. Build the add-on: `npm run build` (writes `dist/foxbridge.xpi`), then open it in Firefox.
3. In Claude Code: `/plugin marketplace add D:\FirefoxClaude`, then `/plugin install foxbridge@foxbridge`.

## Tools
tabs_list, tabs_create, tabs_close, tabs_select, navigate, screenshot, read_page, find, get_page_text,
click, type, key, scroll, form_input, javascript, console_messages, network_requests, wait.

## Known limits
Input events are synthetic (`isTrusted = false`). A planned WebDriver BiDi mode will add trusted input.
