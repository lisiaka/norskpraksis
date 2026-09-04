# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Keep this file up to date at all times.** Whenever the codebase changes in a meaningful way — new features, architectural decisions, changed commands, new dependencies — update this file to reflect the current state.

## Running the App

**Frontend only (port 8080)** — static files, no API, no secrets:
```bash
python3 -m http.server 8080 --directory public
```
`.claude/launch.json` wraps this same command as the `frontend` config, so Claude Code's
preview tools can start it. It serves `public/` only and needs no secrets.

This replaced `start_server.py`, deleted 2026-08-27. That script also carried local
`/words/`, `/sentences/`, `/essays/`, `/stats/` and `/plan/` endpoints backed by JSON files
in `stats/`, plus a `/proxy/claude` route — all dead since the FastAPI backend took over
user data and the Pages Function took over the proxy. Nothing had called them in months.
Since feature 015 the app talks to `${API_BASE}/…` and nothing else — the Pages proxy is
gone too, so **a plain static server is now enough to exercise every AI surface**. The
`stats/` folder with its old local test data is left on disk, untracked and unused.

**Full stack with Cloudflare Pages Functions (port 8788):**
```bash
npm run dev   # wrangler pages dev
```
Copy `.dev.vars.example` → `.dev.vars` and fill in secrets before running wrangler.

⚠️ **`JWT_SECRET_KEY` is required and must match the FastAPI backend's.** The Pages Function
verifies the backend's tokens with it and rejects every request when it is unset — there is
no fallback. Until 2026-08-27 there was one (a shared `DEMO_PASSWORD`), which is why local
dev worked without this key; that path was deleted because it also let anyone holding the
leaked password reach the Claude proxy.

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
- `state.learntFilter` — `""` (all) or `"hide_learnt"` (hides `learnt_auto`/`learnt_manual` words). A separate axis from `practicedFilter`, so the two stack. The bank shows learnt words by default — only flashcards exclude them by default
- `lesingState.readFilter` — `""` (all) or `"hide_read"` (hides texts with a `text_read` event, the same signal behind the "✓ Lest" badge). Applies to the text list only; the reader's prev/next navigation deliberately ignores it, since opening a text marks it read
- `state.sentences` — `{ wordId: sentenceText }` — written sentences keyed by word id
- `lesingState.savedSummaries` — `{ textId: readingSummaryObj }` — cached reading summaries keyed by text id (loaded from backend on login + on save)
- `b2_tts_rate` — read-aloud speed, `0.7` or `1` (see "Tekst til tale" below)

**UI rendering** uses a custom `el(tag, props, ...children)` helper. Re-renders by calling `renderContent()`.

**Tabs / features:**
- `ordbank` — vocabulary bank (add, search, filter by topic + "ikke øvd ennå", import/export)
- `lesing` — reading texts with subscription access control + paywall overlay; each text has 3 comprehension questions (2 MCQ + 1 open-ended) and a Gjenfortell (reading summary) section with Claude AI feedback, plus a read-aloud bar over the text body (see "Tekst til tale" below)
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
- `students` / `classes` — cached roster and class list (`null` = not loaded yet). **Load both
  with `ensureTeacherRoster()`**, never one on its own: four surfaces need them (roster, both
  banks, the Ordbank share bar) and three are reachable without passing through the roster, so a
  half-fetch silently drops the class quick-select. Both are reset on login — a second login in
  the same tab used to show the previous teacher's roster.
- `selectedStudent` — current student object for detail views
- `bankTexts` / `bankPrompts` — cached teacher bank arrays (`null` = not loaded)
- Call `laererSetView(view)` to change view and re-render

**Teacher sidebar nav** — always visible when `state.tab === "laerer"`:
- "👩‍🏫 Klassen min" → `teacherState.view = "roster"`
- "📖 Tekstbank" → `teacherState.view = "bank-texts"`
- "✍️ Oppgavebank" → `teacherState.view = "bank-prompts"`
- "📚 Ordbank..." → `setTab("ordbank")` (teacher's own ordbank — also where they send words to
  students; see "Word sharing" below)

**Word sharing — one bar, both roles** (`buildShareBar`, in the Ordbank filter block):
- `shareModeConfig()` returns the role's descriptor — `recipients`, labels, `send`, and whether
  the "Inkluder oversettelse" checkbox appears. `buildShareBar()` reads only that, so neither
  role's flow is special-cased inside it.
- `shareCap()` is `50` for a student (`MAX_SHARE_WORDS`, matching the backend) and `Infinity`
  for a teacher. The cap exists to stop one classmate flooding another's *inbox*; a teacher
  writes to a bank, which has none.
- `sendWordsAsTeacher()` → `POST /api/teacher/students/words/bulk`, a **direct write** into each
  student's bank. `shareWordsWithClassmates()` → `POST /api/me/shared-words`, an **offer** the
  recipient must accept. ⚠️ Keep the button labels distinct ("Send til ordbank" vs "Send") —
  the asymmetry is deliberate.
- The teacher payload maps each bank word through `CAT_MAP` and `VALID_TOPIC_LIST`, falling back
  to `enkeltord` / `FALLBACK_TOPIC`. The backend **rejects** an unknown category or topic rather
  than defaulting, after teacher-pushed words once landed in student banks and never rendered.
- `buildShareBar()` **always returns an element**, hidden while recipients load. Returning
  `null` left no node for `refreshShareBar()` to replace, so a bar empty at first paint could
  never appear.

**Bank views** (`buildLaererBankTexts`, `buildLaererBankPrompts`):
- Two-column layout: left = tabbed content, right = sticky assignment panel
- Each card has a checkbox; checked items accumulate in `selectedItems[]`
- Assignment panel shows selected items, student checkboxes (+ "alle elever" toggle), optional label, and a "Gi oppgave" button → `POST /api/teacher/assignments`
- Tekstbank tabs: Systemtekster (from `lesing-tekster.json`) | Mine tekster | + Ny tekst
- Oppgavebank tabs: Systemoppgaver (from `PROMPTS` object, all 48 prompts) | Mine oppgaver | + Ny oppgave
- Text cards use `.text` field for system texts (NOT `.body` or `.content`) — `txt.body||txt.content||txt.text`

**Subscription access logic — paywall currently DISABLED:**
- `SUBSCRIPTION_ENABLED = false` — master switch. While off, everyone is an active subscriber:
  all 120 texts open, free-tier counters inert, plan lock lifted, no payment UI. Set to `true`
  to restore gating; no other edits needed and no data fixup
- `isActiveSubscriber()` — returns `true` immediately when the switch is off; otherwise true if
  `state.subscription.status` is active/grace/cancelled-but-not-expired
- `canOpenText(textId, topicKey)` — true for subscribers; for free users: max 3 texts, 1 per topic
- `recordTextOpened(textId, topicKey)` — persists free-tier usage to localStorage; no-ops for subscribers
- `buildSubscriptionSection()` checks the flag separately — `state.subscription` stays `null`, so
  `active && sub` would otherwise fall through to the payment UI
- Enforcement is client-side only; no backend endpoint has ever checked it

**Publishing is opt-in — only `public/` goes live.** `wrangler.toml` sets
`pages_build_output_dir = "public"`, so a deploy uploads that directory and nothing else.
`public/` holds exactly four files: `norsk_b2_pro.html`, `lesing-tekster.json`, `_redirects`
and `_headers`. **To make a new asset public you must put it in `public/`** — there is no
other mechanism, and referencing it from the HTML is not enough.

This replaced a `pages_build_output_dir = "."` that published the whole repo, including
`CLAUDE.md` and — until it was found — `.dev.vars`, which leaked `ANTHROPIC_API_KEY`.
`.gitignore` and `.wranglerignore` never helped: wrangler uploads a filesystem directory,
not the git tree. See `.wranglerignore` for the full account.

Local secrets still live in `~/.config/norskb2/.dev.vars`. Copying one into the repo root
for a `wrangler pages dev` session is now safe from publication, but keeping them out
remains good hygiene.

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
- Claude API — grammar feedback in **Norwegian**, via the FastAPI backend at
  `POST ${API_BASE}/api/ai/feedback`. **Not** through a Cloudflare function any more; see
  "AI feedback" below
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

Reading summaries are persisted via `PUT /api/reading-summaries/{textId}`. AI feedback is
checked with `checkGjenfortellWithClaude()`. Since feature 015 this goes to the backend, so
a plain static server is enough — `npm run dev` (wrangler) is no longer required for AI.

### The AI transport (feature 015)

All three feedback surfaces go through **`requestAiFeedback(surface, system, userMsg,
truncatedHint)`** → `POST ${API_BASE}/api/ai/feedback`. Do not hand-roll this fetch; three
near-identical copies is what the helper replaced.

- **`AI_SURFACE`** mirrors `AiSurface` in `backend/app/schemas/ai.py`. The backend answers
  `422` for anything outside the three members rather than defaulting, so a typo here fails
  loudly rather than silently borrowing another surface's token budget.
- **Do not send `model` or `max_tokens`.** The backend picks both from `surface` and ignores
  anything the caller sends. Sending them is harmless but pointless.
- **We still compose the wording — but no longer the steering block.** The three long
  Norwegian prompt bodies stay here by design; 015 moved the cost decision, not the prompt.
  **Feature 020 moved the teacher steering block**, which the backend now appends itself.
  Send the body as `system_base` and do **not** append steering, or it lands in the prompt
  twice. Moving the three bodies server-side is still a named follow-up.
- **The signature is `requestAiFeedback(surface, systemBase, userMsg, truncatedHint, meta)`.**
  `meta` carries `templateId` (from `AI_TEMPLATE`, mirroring `TemplateId` in
  `backend/app/schemas/ai_record.py`), `contentKind`, and a content reference where one
  exists. ⚠️ A content **id** usually does not exist: all three surfaces ask for feedback
  before the thing being assessed is saved, so `contentKind` with no id is the ordinary case,
  not a gap. Only the sentence surface has a real reference (`wordId`).
- **Bump `AI_TEMPLATE_VERSION` when you edit one of the three prompt bodies.** It is not
  trusted — the backend hashes the body it actually received — so a stale value degrades the
  operator's drift report rather than corrupting data.
- ⚠️ **This request shape needs a backend from 2026-09-04 or later.** Deploy the backend
  first; an older one answers 422 because it has nowhere to put `system_base`.
- Errors arrive as `{detail:{reason}}`; `aiFailureMessage()` turns a status and reason into
  one Bokmål sentence. A `401` is an expired session, never an AI failure.

**Distractors are not generated here.** `generateFormsAndDistractors()` was deleted in 015 —
the classifier produces them server-side alongside `forms`, and they arrive in the
`/words/lookup` proposal. `enrichWord(wordId)` → `POST /api/words/{id}/enrich` covers the two
paths a proposal cannot reach: bulk import, and the "✨ Generer med AI" button. It returns a
boolean; the automatic callers ignore it, the button reports failure.

Text cards in `lesing-tekster.json` have an optional `questions` array. Each question is either MCQ `{ question, options[], answer }` (answer is the correct option index) or open-ended `{ question }` (no options). All 120 texts have questions.

### Teacher AI steering (feature 012)

A teacher can set per-student "AI-fokus" instructions and rate individual AI feedback blocks; both are automatically woven into that student's future Claude calls.

- ⚠️ **The student half of this is no longer in the frontend.** `state.aiSteeringContext`,
  `fetchAiSteeringContext()` and `buildTeacherSteeringBlock()` were **removed in feature
  020**. The backend composes the block (`app/services/ai_steering.py`) and appends it to
  the `system_base` a feedback call sends, so a new feedback function needs to do nothing
  at all to pick up a teacher's instructions — and must **not** append a block of its own.
  A backend test pins the Python against the deleted JavaScript as byte-identical, so no
  learner's feedback changed when it moved.
- `GET /api/me/ai-context` still exists and still works; nothing in the SPA calls it today.
  The planned "Tilpasset av læreren din" badge is what would call it again.
- Teacher-facing UI lives in `buildLaererAiFokus()` (`teacherState.view === "ai-fokus"`, reached via a KPI card in `buildLaererProgress()`): textarea + save/clear (`PUT`/`DELETE /api/teacher/students/{id}/ai-instructions`), plus a "✨ Utform med Claude" refinement chat panel (`POST /api/teacher/students/{id}/ai-chat`, capped at 10 turns — the backend rejects turn 11 with a 429 `chat_limit_reached`).
- `buildAiRatingWidget(sourceType, sourceId)` — shared 👍/👎 + comment widget, attached under AI feedback blocks in `buildLaererEssayDetail` and `buildLaererSummaries` (`POST /api/teacher/ai-ratings`). Distinct from the existing teacher→student comment/Like widget on the same essay card — this one is teacher→AI.
- `teacherState.aiInstructions` / `aiChatMessages` / `aiChatTurnCount` / `aiRatings` — cached state for the above, scoped to `teacherState.selectedStudent`.
- A student has at most one active teacher at a time (`UNIQUE(student_id)` on `teacher_student_links`), so there is no multi-teacher resolution logic anywhere in this feature.

## Tekst til tale (feature 016)

Read-aloud for reading texts, comprehension questions, and single words. **No AI provider
is involved** — despite the backlog calling it "AI reads a text aloud", Anthropic has no
speech API. This is the browser's own `speechSynthesis`, so there is no per-play cost, no
audio asset, no cache and no credential.

- `speak(text, {onWord, onState})` is the **only** entry point. Everything else —
  `ttsPause`, `ttsResume`, `ttsStop`, `ttsButton` — sits around it. Replacing the engine
  later (pre-generated audio, a server route) is a change inside `speak()` and nowhere
  else; do not call `speechSynthesis` directly from a feature.
- **`ttsAvailable()` gates every control.** With no Norwegian voice installed it returns
  false and each surface renders as it did before the feature existed — no disabled
  button, no reading text split into spans. Reading Norwegian aloud in an English voice
  teaches the wrong pronunciation, so silence is the correct failure, and
  `resolveTtsVoice()` accepts only `nb`/`nn`/`no`.
- **Voices arrive asynchronously.** `getVoices()` is empty on the first call in most
  browsers; `resolveTtsVoice()` re-runs on `voiceschanged` and re-renders the reader if
  one was already open when the list landed.
- **Long text is chunked** (`ttsChunk`, `TTS_CHUNK_MAX = 180`). Chrome stops partway
  through a long utterance, so a 250-word text spoken as one utterance does not finish.
  Chunks are split on sentence ends and carry a character `offset` into the original
  string — that offset is what makes the highlight land on the right word, so any change
  to the splitter must preserve it exactly.
- **`fillSpokenText(host, str)`** renders the reading text as one `<span class="tts-word">`
  per word and returns `mark(charIndex)`. Whitespace stays in plain text nodes so the
  rendered text is character-identical to the source. Safari does not fire `boundary`
  events — the highlight is optional by design, everything else still works.
- **`renderContent()` calls `ttsStop()` first.** A re-render throws away the spans the
  highlight points at, so speech surviving one would talk against detached nodes. That
  one call covers tab switches, the reader's back button and answering a question.
  `visibilitychange`/`pagehide` cover leaving the page.
- `tts.token` is bumped on every stop and checked in every utterance callback, so a
  cancelled run can never advance the queue of the run that replaced it.
- Speed (0.7 / 1) persists in `localStorage` under `b2_tts_rate`.

## Key Files

| File | Purpose |
|------|---------|
| `public/norsk_b2_pro.html` | The entire frontend application |
| `public/lesing-tekster.json` | The 120 reading texts — the only asset the app fetches |
| `public/_redirects` / `public/_headers` | Root redirect and CSP |
| `wrangler.toml` | Pages config + KV binding + `pages_build_output_dir` |
| `.dev.vars.example` | Template for local secrets (copy to `.dev.vars`) |
| `tsconfig.json` | TypeScript config for `functions/` (no `tsc` installed — see below) |
| `functions/api/[[route]].ts` | Cloudflare Pages Function router — **still live** for the Vipps/PayPal webhooks, `/api/subscription/` and the KV data routes. It holds **no AI credential of any kind**: `/api/proxy/claude` and `handleClaudeProxy` were deleted in 015, and `ANTHROPIC_API_KEY` was removed from both the production and preview Pages environments, on 2026-09-03. Each now holds `JWT_SECRET_KEY` alone. Do not add an AI key back here — the whole point of 015 was to get the count to one |
| `tests/abonnement.spec.ts` | Playwright E2E tests for subscription flows |
| `ordbank-2-med-emner.json` | Sample word bank for import testing (not published) |

Everything above outside `public/` is repo-local and not served. `functions/` stays at the
repo root — Pages resolves it there regardless of `pages_build_output_dir`.

**There is no `tsc` in the project** despite `tsconfig.json`. The closest thing to a
typecheck is `npx wrangler pages functions build --outdir=/tmp/x`, which esbuild-compiles
the worker and fails on syntax errors but not type errors.

**Deploy scripts name their branch.** `npm run deploy:staging` / `npm run deploy:production`.
The old bare `npm run deploy` was removed: it omitted `--branch`, so wrangler inferred the
branch from the git checkout and publishing to production was a `git checkout main` away.

<!-- SPECKIT START -->
Active plan: `specs/019-feature-adoption-instrumentation/plan.md` (in the monorepo root, sibling to this submodule).
For additional context about technologies to be used, project structure,
shell commands, and other important information, read that plan and its
companion `research.md`, `data-model.md`, `contracts/api.md`, and `quickstart.md`.
<!-- SPECKIT END -->
