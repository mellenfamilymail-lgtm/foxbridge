<!-- © 2026 Jennifer K. Telfer -->
# addons.mozilla.org Listing

**Name:** FoxBridge

**Summary (250 chars max):**
Let Claude Code use Firefox. FoxBridge connects Firefox to a local Claude Code plugin so Claude can open tabs, read pages, click, type, fill forms, take screenshots and check console and network logs for you.

**Categories:** Other, Developer Tools (Firefox for Android: not supported)

**Description:**
FoxBridge lets Claude Code, Anthropic's coding agent, work in your own Firefox: browse, read pages, fill forms, test your web app and debug it, all from your Claude session.

How it works
- Install this add-on and the FoxBridge plugin for Claude Code (/plugin marketplace add mellenfamilymail-lgtm/foxbridge, then /plugin install foxbridge@foxbridge).
- The add-on connects only to a local program on your own computer (127.0.0.1). Nothing is sent to any outside server by the add-on.
- The toolbar icon shows "off" while Claude isn't connected.

What Claude can do
- List, open, switch and close tabs; go to pages, back and forward
- Read the page as text or as a labelled list of buttons, links and fields
- Click, type, press keys, scroll and fill forms
- Take screenshots
- Run JavaScript and read console messages and network requests

Privacy
FoxBridge collects no data. Page content goes only to the Claude Code program on your own computer, when Claude asks for it.

**Support email:** mellenfamilymail@gmail.com
**Support site / homepage:** https://github.com/mellenfamilymail-lgtm/foxbridge
**License:** All Rights Reserved
**Privacy policy:** FoxBridge collects no data. It talks only to a program on your own computer (127.0.0.1:47821).

**Notes to reviewer:**
FoxBridge is a bridge between Firefox and a local MCP server (server/index.js in the source repo) that Claude Code starts. The background script connects to ws://127.0.0.1:47821; the server only accepts moz-extension:// origins. <all_urls> is needed because the user asks Claude to read and operate arbitrary pages. The "javascript" tool evaluates code that the local user's Claude session sends; it is never fetched remotely. All code is unminified. To test: run `node server/index.js` from the repo, then send MCP tools/call messages on stdin (see test/smoke.js).
