# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Keep this file up to date at all times.** Whenever the codebase changes in a meaningful way — new features, architectural decisions, changed commands, new dependencies — update this file to reflect the current state.

## Running the App

```bash
python3 start_server.py
```

Starts a local HTTP server on port 8080 and opens `http://localhost:8080/norsk_b2_pro.html` in the browser. There is no build step — the app is a single HTML file.

## Architecture

This is a single-file SPA (`norsk_b2_pro.html`) for Norwegian B2 language learning. All HTML, CSS, and JS are inline in that one file (~92KB). There is no framework, no bundler, and no external JS dependencies.

**The Python server (`start_server.py`) has two jobs:**
1. Serve static files from the local directory
2. Proxy Claude API requests at `/proxy/claude` to avoid browser CORS restrictions — it reads the API key from the request payload and forwards to `https://api.anthropic.com/v1/messages`

**State** is a single `state` object kept in memory and persisted to `localStorage`:
- `b2_words_v2` — the user's vocabulary bank (array of word objects)
- `b2_claude_key` — the user's Claude API key

**UI rendering** uses a custom `el(tag, props, ...children)` helper that creates DOM nodes imperatively. The entire UI is re-rendered by calling `render()` on state changes.

**Tabs / features:**
- `ordbank` — vocabulary bank (add, search, filter, import/export JSON)
- `setninger` — sentence practice using words from the bank
- `flashcards` — multiple-choice and write-the-word quiz modes
- `oppgaver` — 24 essay prompts across 6 themes
- `skriv` — essay editor with optional Claude grammar feedback

**External APIs used:**
- MyMemory (`api.mymemory.translated.net`) — free translation/dictionary lookups
- Claude API — grammar checking and essay feedback (user supplies their own key)
- Bokmålsordboka (`ordbokene.no`) — Norwegian dictionary deep links

**Word object shape:**
```json
{ "word": "...", "translation": "...", "type": "enkeltord|uttrykk|koblingsord", "topic": "...", "added": 1234567890 }
```

## Key Files

| File | Purpose |
|------|---------|
| `norsk_b2_pro.html` | The entire application |
| `start_server.py` | Dev server + Claude API proxy |
| `ordbank-2-med-emner.json` | Sample word bank with topic tags (for import testing) |
| `norsk_b2_trening.html` | Older version, kept as backup |
