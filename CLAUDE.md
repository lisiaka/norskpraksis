# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Keep this file up to date at all times.** Whenever the codebase changes in a meaningful way — new features, architectural decisions, changed commands, new dependencies — update this file to reflect the current state.

## Running the App

**Frontend only (port 8080):**
```bash
python3 start_server.py
```

**Full stack with Cloudflare Pages Functions (port 8788):**
```bash
npm run dev   # wrangler pages dev
```
Copy `.dev.vars.example` → `.dev.vars` and fill in secrets before running wrangler.

**Run Playwright tests:**
```bash
npm test
# For subscription tests (requires wrangler running + SUBSCRIPTION_TEST_MODE=true in .dev.vars):
npx playwright test tests/abonnement.spec.ts
```

## Architecture

This is a single-file SPA (`norsk_b2_pro.html`) for Norwegian B2 language learning. All HTML, CSS, and JS are inline in that one file. No framework, no bundler, no external JS dependencies.

**Backends:**
- **FastAPI** (`http://localhost:8000`) — auth (JWT), words, sentences, essays, stats, plan
- **Cloudflare Pages Functions** (`functions/api/[[route]].ts`) — subscription management (KV storage), Vipps/PayPal webhooks, Claude proxy

**State** is a single `state` object in memory + `localStorage`:
- `b2_session_token` — JWT from FastAPI auth
- `b2_user_id` / `b2_user_name` / `b2_user_email` — user identity
- `b2_free_access_{userId}` — free tier text tracking `{ openedTexts[], topicsUsed[] }`
- `state.subscription` — loaded from `/api/subscription/{userId}` after login
- `state.topicFilter` — active topic chip in Ordbank (`""` = all)
- `state.practicedFilter` — `""` (all) or `"not_practiced"` (hides words with a sentence or correct flashcard answer)
- `state.sentences` — `{ wordId: sentenceText }` — written sentences keyed by word id
- `lesingState.savedSummaries` — `{ textId: readingSummaryObj }` — cached reading summaries keyed by text id (loaded from backend on login + on save)

**UI rendering** uses a custom `el(tag, props, ...children)` helper. Re-renders by calling `renderContent()`.

**Tabs / features:**
- `ordbank` — vocabulary bank (add, search, filter by topic + "ikke øvd ennå", import/export)
- `lesing` — reading texts with subscription access control + paywall overlay; each text has 3 comprehension questions (2 MCQ + 1 open-ended) and a Gjenfortell (reading summary) section with Claude AI feedback
- `setninger` — sentence practice; "Lagre og neste" navigates to next word without a sentence
- `flashcards` — quiz modes (choice + write); filter by topic / time / learning status
- `setningsbygging` — word-sort game
- `oppgaver` — essay prompts (48 system prompts across 12 topics)
- `skriv` — essay editor with Claude grammar feedback (output in Norwegian); `state.currentPrompt = {title, text}` and `state.currentTopic` (TOPICS ASCII key) must be set before navigating here
- `mineoppgaver` — teacher-assigned tasks; "Les teksten →" opens Lesing reader, "Skriv stilen →" opens Skriv with prompt (converts topic to TOPICS ASCII key), "Legg til i ordbank →" imports words + auto-marks done
- `plan` — personal study plan stored server-side
- `statistikk` — learning statistics
- `innstillinger` — profile, subscription management (upgrade/cancel)
- `laerer` — teacher dashboard; view is controlled by `teacherState.view` (see below)

**teacherState** — controls which sub-view the teacher sees within the `laerer` tab:
- `view` — `"roster"` | `"progress"` | `"essays"` | `"essay-detail"` | `"texts"` | `"words"` | `"sentences"` | `"plan"` | `"summaries"` | `"assignments"` | `"bank-texts"` | `"bank-prompts"`
- `students` — cached student list (`null` = not loaded yet)
- `selectedStudent` — current student object for detail views
- `bankTexts` / `bankPrompts` — cached teacher bank arrays (`null` = not loaded)
- Call `laererSetView(view)` to change view and re-render

**Teacher sidebar nav** — always visible when `state.tab === "laerer"`:
- "👩‍🏫 Klassen min" → `teacherState.view = "roster"`
- "📖 Tekstbank" → `teacherState.view = "bank-texts"`
- "✍️ Oppgavebank" → `teacherState.view = "bank-prompts"`
- "📚 Ordbank..." → `setTab("ordbank")` (teacher's own ordbank)

**Bank views** (`buildLaererBankTexts`, `buildLaererBankPrompts`):
- Two-column layout: left = tabbed content, right = sticky assignment panel
- Each card has a checkbox; checked items accumulate in `selectedItems[]`
- Assignment panel shows selected items, student checkboxes (+ "alle elever" toggle), optional label, and a "Gi oppgave" button → `POST /api/teacher/assignments`
- Tekstbank tabs: Systemtekster (from `lesing-tekster.json`) | Mine tekster | + Ny tekst
- Oppgavebank tabs: Systemoppgaver (from `PROMPTS` object, all 48 prompts) | Mine oppgaver | + Ny oppgave
- Text cards use `.text` field for system texts (NOT `.body` or `.content`) — `txt.body||txt.content||txt.text`

**Subscription access logic:**
- `isActiveSubscriber()` — returns true if `state.subscription.status` is active/grace/cancelled-but-not-expired
- `canOpenText(textId, topicKey)` — returns true for subscribers; for free users: max 3 texts, 1 per topic
- `recordTextOpened(textId, topicKey)` — persists free-tier usage to localStorage

**Cloudflare Functions structure:**
```
functions/api/
├── [[route]].ts          # Main router + Env interface
├── handlers/
│   ├── subscription.ts   # GET/POST /api/subscribe, GET/POST /api/subscription/*
│   ├── webhook-vipps.ts  # POST /api/webhook/vipps
│   ├── webhook-paypal.ts # POST /api/webhook/paypal
│   └── test-simulate.ts  # POST /api/test/simulate-renewal (test mode only)
└── lib/
    ├── subscription-kv.ts # KV read/write helpers
    ├── crypto.ts          # HMAC-SHA256 verification (Web Crypto API)
    ├── idempotency.ts     # Webhook deduplication (30-day TTL)
    ├── vipps.ts           # Vipps Recurring API v3 client
    └── paypal.ts          # PayPal Subscriptions API v2 client
```

**Subscription test flow (without real payments):**
```bash
# Set SUBSCRIPTION_TEST_MODE=true in .dev.vars, then:
curl -X POST http://localhost:8788/api/test/simulate-renewal \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","outcome":"success"}'
```

**External APIs used:**
- FastAPI backend (`http://localhost:8000`) — auth + user data
- MyMemory (`api.mymemory.translated.net`) — translation lookups
- Claude API — grammar feedback in **Norwegian** (proxied via Cloudflare function at `/api/proxy/claude`)
- Bokmålsordboka (`ordbokene.no`) — dictionary deep links
- Vipps Recurring API v3 — Norwegian payment subscriptions
- PayPal Subscriptions API v2 — international payment subscriptions

## Topic system

All topic-related fields use a fixed list of 12 canonical strings defined as `VALID_TOPIC_LIST`:
`arbeid demokrati familie helse integrering internasjonalt miljø natur politikk språk teknologi utdanning`

- `normalizeTopic(str)` — maps near-matches (e.g. `"klima"` → `"miljø"`, `"miljo"` → `"miljø"`) to canonical values; returns `""` for anything unrecognised
- Topic fields in forms are `<select>` elements — never free text
- `importWords()` normalises topics; unrecognised values become `""`
- Filter chips in Ordbank, Flashcards, and Setninger iterate `VALID_TOPIC_LIST` (showing only topics with ≥1 word)
- **Do not** add free-text topic inputs — enforce the dropdown everywhere

The `TOPICS` object (essay/skriv tab, ASCII keys `miljo`/`sprak`) is a separate map for essay prompt lookup and is intentionally not changed. `ESSAY_TOPIC_TO_WORD_TOPICS` bridges it to word-bank topic strings.

## AI feedback

`checkWithClaude()` (sentence) and `checkEssayWithClaude()` (essay) both instruct Claude to respond in **Norwegian Bokmål**. JSON keys remain in English (the renderer depends on them); only the string-value fields change language. Do not revert to English prompts.

`renderEssayClaudeResult(result, container)` renders formatted essay feedback — used both on the student side (Skriv tab) and in the teacher essay detail view (`buildLaererEssayDetail`). Always use this function to display essay AI feedback; never dump raw JSON as text.

`renderGjenfortellResult(result, container)` renders formatted reading-summary AI feedback (level badge, comprehension, vocabulary, grammar errors, overall). Used in the student Lesing tab and in the teacher `buildLaererSummaries()` view. Always use this function; never dump raw JSON.

Reading summaries are persisted via `PUT /api/reading-summaries/{textId}`. AI feedback is checked with `checkGjenfortellWithClaude()` which calls `/api/proxy/claude` — this **requires wrangler pages dev**, not `python3 start_server.py`.

Text cards in `lesing-tekster.json` have an optional `questions` array. Each question is either MCQ `{ question, options[], answer }` (answer is the correct option index) or open-ended `{ question }` (no options). All 120 texts have questions.

## Key Files

| File | Purpose |
|------|---------|
| `norsk_b2_pro.html` | The entire frontend application |
| `start_server.py` | Local HTTP server (port 8080) |
| `wrangler.toml` | Cloudflare Pages config + KV binding |
| `.dev.vars.example` | Template for local secrets (copy to `.dev.vars`) |
| `tsconfig.json` | TypeScript config for `functions/` |
| `functions/api/[[route]].ts` | Cloudflare Pages Function router |
| `tests/abonnement.spec.ts` | Playwright E2E tests for subscription flows |
| `ordbank-2-med-emner.json` | Sample word bank for import testing |
