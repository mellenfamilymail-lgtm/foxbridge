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
2. **Firefox add-on** - install it from [addons.mozilla.org/firefox/addon/foxbridge-for-claude](https://addons.mozilla.org/firefox/addon/foxbridge-for-claude/) (works in any Firefox once Mozilla's review is done). Until then:
   - Use [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/), open `about:config` and set `xpinstall.signatures.required` to `false`.
   - Download `foxbridge.xpi` from [Releases](https://github.com/mellenfamilymail-lgtm/foxbridge/releases) and drag it into Firefox.
3. Restart Claude Code and ask it to do something in Firefox.

### Claude Desktop (Chat App)
FoxBridge also works in the Claude desktop app, not just Claude Code:
1. Download `foxbridge.mcpb` from [Releases](https://github.com/mellenfamilymail-lgtm/foxbridge/releases).
2. Double-click it (or drag it into Claude Desktop under **Settings > Extensions**) and click **Install**.
3. Install the Firefox add-on as in step 2 above, then ask Claude to "list my Firefox tabs".

### Unsigned Builds
FoxBridge is not listed in Anthropic's plugin directory (local MCP servers are accepted there only from Verified organizations), and the Firefox add-on is unsigned until Mozilla's review is done. You can still use every part:
- **Claude Code plugin** - install it from this repo with the `/plugin` commands above. The directory listing is not needed.
- **Claude Desktop** - `foxbridge.mcpb` is unsigned. Claude Desktop shows an "unverified" warning; click **Install** to continue.
- **Firefox add-on** - in Firefox Developer Edition or Nightly, set `xpinstall.signatures.required` to `false` in `about:config`, then drag `foxbridge.xpi` into Firefox. In regular Firefox, open `about:debugging` > **This Firefox** > **Load Temporary Add-on** and pick `foxbridge.xpi`; it is removed when Firefox restarts.

Unsigned builds are used at your own risk. They come from this repository only; do not install copies from anywhere else.

## Check It Works
In Claude Code, ask: "List my Firefox tabs." Claude should answer with your open tabs.
The FoxBridge toolbar icon in Firefox shows an "off" badge while Claude is not connected, and no badge once it is.

## Troubleshooting
- **"Firefox is not connected"** - make sure Firefox is open with FoxBridge enabled (`about:addons`), then wait a few seconds; it reconnects every 2 seconds.
- **Badge stays "off"** - restart Claude Code. Only one Claude Code session can drive Firefox at a time; close the other one.
- **Port 47821 is in use** - set the `FOXBRIDGE_PORT` environment variable to another port before starting Claude Code.
- **Add-on "could not be verified"** - you are on regular Firefox. Use Developer Edition with `xpinstall.signatures.required` set to `false` until the signed version is on addons.mozilla.org.
- **Tools not listed in Claude Code** - run `/plugin` and check that foxbridge is enabled, and that `node --version` shows 18 or newer.
- **Nothing happens on some pages** - Firefox blocks all extensions on `about:` pages and addons.mozilla.org.

## Uninstall
Run `/plugin uninstall foxbridge@foxbridge` in Claude Code and remove FoxBridge from `about:addons` in Firefox.

## Build from source
`npm run build` writes `dist/foxbridge.xpi`. `npm run build:mcpb` writes the Claude Desktop extension `dist/foxbridge.mcpb`. `node test/smoke.js` runs a live test against an open Firefox.

## Tools
tabs_list, tabs_create, tabs_close, tabs_select, navigate, screenshot, read_page, find, get_page_text,
click, type, key, scroll, form_input, javascript, console_messages, network_requests, wait.

## Known limits
Input events are synthetic (`isTrusted = false`). A planned WebDriver BiDi mode will add trusted input.
