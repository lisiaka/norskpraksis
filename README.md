# Norsk B2 Treningsverktøy — Frontend

Single-file SPA for Norwegian B2 exam preparation. All HTML, CSS and JS live inline in `norsk_b2_pro.html` (~4,500 lines) — no framework, no bundler, no external JS dependencies.

**Live:** https://norsk-b2-pro.pages.dev/norsk_b2_pro

Companion backend (FastAPI + PostgreSQL on Railway): `../backend/`

## Users and roles

Each account has a `role` chosen at registration — **`student`** or **`teacher`** — and can be switched later from the profile settings.

- **Students** see the full learning UI (Ordbank, Lesing, Setninger, Flashcards, Setningsbygging, Velg oppgave, Skriv, Plan, Statistikk, Innstillinger).
- **Teachers** land on a single tab — **👩‍🏫 Klassen min** — that is the teacher dashboard. They do not see the student tabs.

A student can be assigned to at most one teacher (enforced by a unique constraint on the backend). Students self-assign by picking a teacher from a list of registered teachers; teachers can also add a student by e-mail.

## Student features

### 📚 Ordbank — Vocabulary bank
Add, search, filter and manage a personal word bank. Each word has a type (enkeltord / uttrykk / koblingsord), a topic tag, and a Norwegian–English translation (automatic via MyMemory). Import/export as JSON, CSV, or plain text.

Topic tags are enforced to the same 12 canonical values used everywhere in the app (dropdown, not free text). Imported files with unrecognised topic strings have the topic cleared. The filter bar includes an **"Ikke øvd ennå"** chip that hides any word the student has already used in a sentence or answered correctly in flashcards — useful for focusing practice on gaps.

### 💬 Setninger — Sentence practice
Write a sentence for every word in the bank. Filter by topic. Instant feedback on whether the word was used, plus optional Claude AI grammar checking in Norwegian (LanguageTool fallback when the AI is unavailable). The AI feedback is **persisted** alongside the sentence so the teacher can see it.

"Lagre og neste" skips to the next word without a sentence (rather than incrementing the index sequentially). "Tilfeldig ord" also only picks from unwritten words.

### 🎮 Flashcards
Two game modes — multiple-choice and write-the-word. Filter by topic, time added, or error-only. Optionally cap the session at 10, 20 or 30 words. Per-session score bar with running ✓/✗ counts.

### 🧩 Setningsbygging — Word-sort game
Sentences from the reading texts are broken into shuffled word tokens. Reassemble them in the correct order. Sentences are 8–14 words long. Up to 10 sentences per round. Filter by topic.

### ✍️ Velg oppgave — Essay prompts
48 essay prompts across 12 topics. Pick from the list or write a custom prompt within any topic.

### 📝 Skriv — Essay editor
Write essays with word-bank integration — words from the bank get highlighted. Optional Claude AI feedback on grammar and style in **Norwegian**; the feedback (level + structured notes) is stored on the essay so the teacher can read it later. Save essays to a per-user bank. Export as PDF or plain text. If the student's teacher has reviewed the essay, the teacher's comment and Like badge appear on the essay card.

### 📖 Lesing — Reading texts
120 B2-level Norwegian texts (10 per topic). Filter by topic or by grammar focus (subordinate clauses, relative clauses, conjunctions, subjunctions). A side panel lets you look up words mid-reading and add them to the ordbank.

Each text has 3 comprehension questions (2 multiple-choice + 1 open-ended). After reading, a **Gjenfortell** section lets the student write a summary in their own words and get instant Claude AI feedback (level, comprehension, vocabulary, grammar). Summaries are saved to the backend and visible to the teacher. Text cards in the list show a **📝 Sammendrag** badge for texts the student has summarised.

### 📋 Mine oppgaver — Assigned tasks
Tasks assigned by the teacher appear here as cards, grouped by assignment. Each item shows its type and content, and has an action button that navigates directly to the right interface:

- **📖 Lesetekst** → "Les teksten →" opens the text in the Lesing reader with comprehension questions and Gjenfortell.
- **✍️ Skriveoppgave** → "Skriv stilen →" opens the Skriv editor with the assigned prompt pre-loaded.
- **📚 Ordliste** → "Legg til i ordbank →" imports all words into the student's ordbank and marks the item as done automatically.

Reading and essay items have a separate "✓ Marker som gjort" button for explicit completion.

### 📅 Plan — Personal study plan
Generates a week-by-week schedule based on months until the exam and practice days per week. Each week gets reading targets, essay targets, and word-mastery targets (a word counts as fully mastered only when it is (1) in the ordbank, (2) answered correctly in flashcards, and (3) used in a written sentence). Plans are stored server-side and progress is reflected live.

### 📊 Statistikk — Statistics
KPI summary of texts read, games played, essays written and overall correct-answer rate. Bar chart of reading progress per topic, donut chart of word learning progress (flashcard-correct / used in sentences / used in essays / not yet practiced), a list of net-error words, print/export of that list, and a one-click flashcard game using only the error words.

### ⚙️ Innstillinger
Profile settings — change name, switch role (student ↔ teacher), delete account (GDPR-compliant — schedules deletion via `/api/me`).

## Teacher view

Teachers see a sidebar with three navigation items: **👩‍🏫 Klassen min**, **📖 Tekstbank**, and **✍️ Oppgavebank**. The teacher's own Ordbank is accessible via the standard tab bar.

### 👩‍🏫 Klassen min — Class dashboard

- **Klasselisten** — all assigned students. Add a student by e-mail or remove from the class.
- **Gi oppgave** — assign tasks to one or all students in a single operation (word list, reading texts, essay prompt).
- **Elevprofil** — click any student to open their detail view:
  - Progress KPIs: study plans created, distinct texts read, words in bank, distinct words practiced, flashcard sessions, essays submitted, sentences written.
  - **Mine oppgaver** — teacher view of all assigned tasks for this student, with done/not-done status per item.
  - **Tekster** — every text the student has opened, with last-read timestamp and times-read count.
  - **Ordbank** — words grouped by topic, with a "practiced" flag.
  - **Plan** — the student's current study plan with live read/written progress.
  - **Setninger** — every sentence the student has written, linked to the source word.
  - **Essays** — full essays with the AI feedback rendered as a formatted card (level badge, grammar errors, strengths/improvements), plus a per-essay **comment + Like** widget. Teacher reviews surface back on the student's essay card.
  - **Gjenfortellinger** — all reading summaries the student has written, with Claude AI feedback.

### 📖 Tekstbank — Text bank

Three tabs:
- **Systemtekster** — all 120 app texts, filterable by topic. Click any card to expand and read the full text. Check the box to add it to the assignment panel.
- **Mine tekster** — custom texts saved by the teacher. Filterable by topic, expandable, deletable. Check to assign.
- **+ Ny tekst** — form to write and save a new text to the teacher's personal bank.

A sticky right-side panel lets the teacher select one or more items, pick students (individually or all), add an optional label, and click **Gi oppgave** to create the assignment instantly without navigating back to the class view.

### ✍️ Oppgavebank — Essay prompt bank

Same three-tab structure:
- **Systemoppgaver** — all 48 built-in essay prompts, grouped by topic with expandable text preview. Check to assign.
- **Mine oppgaver** — custom prompts saved by the teacher. Expandable, deletable. Check to assign.
- **+ Ny oppgave** — form to write and save a new prompt to the teacher's bank.

Same right-side assignment panel as Tekstbank.

## Authentication

E-mail + password registration. Login returns a **JWT** (default 30-day expiry) signed by the backend with `JWT_SECRET_KEY`. The token contains the user's role; the frontend stores it in `localStorage` and sends it as `Authorization: Bearer <token>` on every API call. Password hashing is bcrypt (server-side). The role is included in the JWT so the SPA can render the correct tabs without an extra round-trip.

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Single `norsk_b2_pro.html` — vanilla JS + a tiny `el(tag, props, ...children)` helper |
| Hosting | Cloudflare Pages (`wrangler pages deploy`) |
| Backend | FastAPI (`../backend/`) deployed to **Railway** via Docker |
| Database | PostgreSQL (asyncpg + SQLAlchemy 2.0) |
| Auth | JWT (PyJWT) + bcrypt |
| AI | Claude (Haiku 4.5) — backend proxies `/api/proxy/claude` |

**State** lives in a single `state` object. Notably:

- `state.token` — JWT, sent as `Authorization: Bearer ...` on every API call
- `state.userId`, `state.userEmail`, `state.userName`
- `state.userRole` — `"student"` or `"teacher"`, drives which tabs render
- `state.words`, `state.sentences`, `state.essays`, `state.plan` — local cache, kept in sync with the API

**API base URL** is read from `window.API_BASE` (or defaults to a hard-coded production URL). All paths under `/api/*` go to the Railway backend; the rest is served statically from Cloudflare Pages.

**External APIs used directly from the browser:**

- **MyMemory** (`api.mymemory.translated.net`) — free translation for word lookups
- **LanguageTool** (`api.languagetool.org`) — grammar-check fallback
- **Bokmålsordboka** (`ordbokene.no`) — dictionary deep links

## Local development

```bash
# Static-serve the frontend (no API)
python3 start_server.py    # → http://localhost:8080/norsk_b2_pro.html

# Or via wrangler for a Pages-like environment
npm install
npx wrangler pages dev .
```

For a fully working app locally, run the backend too (see `../backend/README.md`) and point the frontend's `API_BASE` to `http://localhost:8000`.

## Deploy

```bash
npm run deploy    # wrangler pages deploy . --project-name norsk-b2-pro
```

Backend deploys automatically from `../backend/` on a push to `main` (Railway watches the repo).

## Key files

| File | Purpose |
|------|---------|
| `norsk_b2_pro.html` | The entire frontend |
| `functions/` | Legacy Cloudflare Functions — no longer used; backend lives in `../backend/` |
| `wrangler.toml` | Cloudflare Pages project config |
| `lesing-tekster.json` | 120 reading texts with topic, grammar-focus, key-words, source |
| `gin3-ordliste.json`, `herpaberget-ordliste.json` | Source ordlister for vocabulary import |
| `ordbank-2-med-emner.json` | Sample word bank with topic tags |
| `start_server.py` | Local-only Python dev server (static files + optional Claude proxy) |
| `tests/` | Playwright end-to-end tests |
| `Multiuser_design.md` | Original design notes; superseded by `specs/` in the repo root |

## Topics

All features — reading texts, essay prompts, vocabulary tags, flashcards, sentence practice and study plan — share the same 12 canonical topics. The list is defined as `VALID_TOPIC_LIST` in `norsk_b2_pro.html` and enforced everywhere: topic fields are dropdowns (not free text), imported words with unrecognised topics are stored with an empty topic, and filter chips are generated from this list (showing only topics with at least one word).

| Value | Display |
|-------|---------|
| arbeid | Arbeid — Work |
| demokrati | Demokrati — Democracy |
| familie | Familie — Family |
| helse | Helse — Health |
| integrering | Integrering — Integration & culture |
| internasjonalt | Internasjonalt — International affairs |
| miljø | Miljø og klima — Environment & climate |
| natur | Natur — Nature |
| politikk | Politikk — Politics |
| språk | Språk — Language |
| teknologi | Teknologi — Technology |
| utdanning | Utdanning — Education |

**Note on essay tab keys:** the `TOPICS` object used internally by the essay/skriv tab uses ASCII keys (`miljo`, `sprak`) for prompt lookups. This is a separate internal map. The `ESSAY_TOPIC_TO_WORD_TOPICS` bridge maps those keys to the word-bank topic strings above. Do not change either mapping — they are already consistent.
