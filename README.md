# Norsk B2 Treningsverktøy

A personal Norwegian B2 exam preparation tool. Single-file web app with a Python backend — no build step, no frameworks, no external JS dependencies.

## Features

### 📚 Ordbank — Vocabulary bank
Add, search, filter and manage your personal word bank. Each word has a type (enkeltord / uttrykk / koblingsord), a topic tag, and a Norwegian–English translation. Import/export as JSON, CSV, or plain text.

### 💬 Setninger — Sentence practice
Write a sentence for every word in your bank. Filter by topic. Get instant feedback on whether you used the word, and optional Claude AI grammar checking.

### 🎮 Flashcards
Two game modes: multiple-choice and write-the-word. Filter by topic, time added, or error-only (words you've previously got wrong). Optionally cap the session at 10, 20 or 30 words.

### ✍️ Velg oppgave — Essay prompts
48 essay prompts across 12 topics matching the reading texts: arbeid, demokrati, familie, helse, integrering, internasjonalt, miljø, natur, politikk, språk, teknologi, utdanning. Write your own custom prompt within any topic.

### 📝 Skriv — Essay editor
Write essays with word-bank integration — words you use get highlighted. Optional Claude AI feedback on grammar and style. Save essays to a per-user bank. Export as PDF or plain text.

### 📖 Lesing — Reading texts
120 B2-level Norwegian texts (10 per topic). Filter by topic or grammar focus (subordinate clauses, relative clauses, conjunctions, subjunctions). A side panel lets you look up words mid-reading and add them directly to your ordbank.

### 🧩 Setningsbygging — Word-sort game
Sentences from the reading texts are broken into shuffled word tokens. Reassemble them in the correct order. Sentences are 8–14 words long. Up to 10 sentences per game. Filter by topic.

### 📅 Plan — Personal study plan
Generate a week-by-week study schedule based on how many months you have and how many days per week you can practise. Each week gets:
- **Reading**: 2 texts per day of practice, clickable directly into the Lesing tab
- **Essays**: 1 essay (1–2 days/week), 2 essays (3–4 days/week), 3 essays (5 days/week)
- **Words**: target of 5 new words per day; a word counts as fully mastered only when it is (1) in the ordbank, (2) answered correctly in flashcards, and (3) used in a written sentence

Plans are stored per user on the server. Progress (texts read, essays written, words mastered) is reflected live.

### 📊 Statistikk — Statistics
- Summary of texts read, games played, essays written and overall correct-answer rate
- Bar chart of reading progress per topic (X/10 read, Y remaining)
- SVG donut chart of word learning progress (flashcard correct / used in sentences / used in essays / not yet practiced)
- Scrollable list of all words where mistakes exceed correct answers (net error words)
- Print/export net-error words for offline review
- One-click flashcard game using only the error-word list

## Multi-user support

Each user has their own data isolated by a user ID entered at login:
- `stats/words_<id>.json` — word bank
- `stats/sentences_<id>.json` — written sentences
- `stats/essays_<id>.json` — saved essays
- `stats/stats_<id>.json` — activity log (all tracked events)
- `stats/plan_<id>.json` — study plan

## Getting started

**Requirements:** Python 3.8+, a modern browser, and (optionally) an [Anthropic API key](https://console.anthropic.com/) for Claude grammar feedback.

```bash
# Clone the repo
git clone <repo-url>
cd <repo-dir>

# Start the server
python3 start_server.py
```

The server opens `http://localhost:8080/norsk_b2_pro.html` automatically.

On Windows, double-click `start_server.bat` instead.

**Claude API key** (optional): paste your key in the Ordbank tab settings panel. It is stored in `localStorage` and sent only to the local proxy at `/proxy/claude` — never directly from the browser to Anthropic.

## Architecture

| File | Purpose |
|------|---------|
| `norsk_b2_pro.html` | Entire application — all HTML, CSS and JS inline (~3500 lines) |
| `start_server.py` | Dev server + Claude API proxy + per-user JSON storage |
| `start_server.bat` | Windows launcher |
| `lesing-tekster.json` | 120 reading texts with topic and grammar-focus metadata |
| `ordbank-2-med-emner.json` | Sample word bank with topic tags (for import testing) |
| `stats/` | Per-user data files (created automatically) |

The server does two things:
1. Serves static files from the project directory
2. Proxies Claude API calls at `/proxy/claude` (avoids browser CORS restrictions)

The app is a single-page application with no framework. UI is built with an `el(tag, props, ...children)` helper that creates DOM nodes imperatively. State is a plain object; the full UI re-renders on changes via `renderContent()`.

## Topics

All features — reading texts, essay prompts, vocabulary tags, flashcards, sentence practice and study plan — share the same 12 topics:

| Topic | Norwegian |
|-------|-----------|
| arbeid | Work |
| demokrati | Democracy |
| familie | Family |
| helse | Health |
| integrering | Integration & culture |
| internasjonalt | International affairs |
| miljø | Environment & climate |
| natur | Nature |
| politikk | Politics |
| språk | Language |
| teknologi | Technology |
| utdanning | Education |
