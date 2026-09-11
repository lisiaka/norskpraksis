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

## Button, chip, and icon conventions (feature 025)

There are exactly **3 button variants** — do not introduce a 4th without a new decision
recorded in a spec. A toggle/segmented-control style (e.g. Ordbank's "Mine ord"/"Elevenes
ord" switch) is not a 4th type; its selected state must visually read as secondary.

- **`.btn-primary`** — main call-to-action. Green, filled, bold. `.btn-cta` shares its
  color/border/typography (via `class:"btn-cta btn-primary"`) but keeps its own block/
  centered/shadow layout.
- **`.btn-secondary`** — neutral/secondary action. Gray, outlined. `.btn-io` and `.btn-nav`
  share its rules; each keeps its own padding where a call site needs it.
- **`.btn-destructive`** — delete/remove action. Red, outlined. Replaces the former
  `.btn-del-essay` (declaration-identical, so its one call site was repointed directly
  rather than kept as a second name for the same rule).

Classes not listed above (`.btn-del`, `.btn-learnt`, `.btn-tts-*`, `.plan-nav-btn`,
`.plan-go-btn`, `.fc-mode-btn`, `.btn-fc-next`, `.btn-skip`, `.btn-next-sent`,
`.btn-save-key`, `.btn-lookup`) were deliberately left unmigrated in feature 025 — see
`specs/025-component-and-interaction-consistency/data-model.md` for the full inventory and
why each was deferred rather than folded in.

**Selection state is always shown with a border, at one of two levels**:
- **Independent chips** (each option separately clickable, e.g. `.topic-chip`, `.plan-chip`)
  are individually bordered in both selected and unselected states.
- **Segmented controls** (mutually-exclusive options grouped as one control, e.g. the
  Ordbank "Mine ord"/"Elevenes ord" toggle, the Tekstbank/Oppgavebank source-tab bars) put
  the border on the wrapping container instead — the group boundary is the border, the
  active segment is the background fill. Individual segments do not need their own border
  on top of that.

Do not add a third pattern (e.g. a chip or segment with no border anywhere, relying on
background color alone) — an audit for feature 025 found every existing selection control
already follows one of the two patterns above; keep it that way.

**Icon usage rule**: an icon is required only where it carries load-bearing scanning
meaning — removing it would make two similar controls indistinguishable, or it is the only
signal of a control's type (e.g. Mine oppgaver's 📖/✍️/📚 type badges, Lesing's 🔊
read-aloud control). Elsewhere it is optional/decorative and MUST NOT be added purely for
visual symmetry with a sibling control.

## Filter conventions (feature 026)

**Filter chips are pill-shaped (`--radius-lg`) — that shape, not color, is what marks a
control as a filter rather than an action.** All 3 button variants (above) use the squarer
`--radius-md`. `.topic-chip`, `.toggle-btn`, and `.plan-chip` all already follow this; keep
any new filter-like control on `--radius-lg` too rather than inventing a new shape.
`.topic-chip` is the filter-chip class in practice — used for topic, tag, time, and
learning-status filters alike, not just topics — despite its name; don't rename it.

**Every topic filter chip shows the topic's canonical icon**, via `topicIcon(topic)`
(defined next to `TOPICS`, ~L486). `TOPICS` is the one source of topic emoji — a
topic-filter surface that hardcodes its own emoji (as Lesing's `LESING_TOPICS` and
Setningsbygging's setup screen both used to, and as the Lesing reader's `TOPIC_META` used
to) drifts from it silently, which is exactly what happened before feature 026 (miljø
rendered `♻️` in Lesing vs. the canonical `🌿` everywhere else). `topicMeta(topic)` is the
`{emoji, color}` form for text-card badges. "Alle" and "generelt" resolve to no icon by
design — neither is a real topic.

**Filter blocks are collapsible as one group per tab**, via the shared
`buildFilterToggle(tab, stateObj, key, onToggle)` helper (~L1798). A block collapses/
expands as a whole — not by individual filter category — and its state resets to expanded
every time its tab is (re-)entered (`setTab()` deletes the relevant field on every tab
switch, ~L1523) rather than persisting. Action rows that happen to sit near a filter block
(Ordbank's share bar and print buttons, Lesing's search box) stay outside the collapsible
container — only the filter chip rows themselves collapse.

**Dropdowns (`<select>`) use `var(--radius-md)`**, the same radius as `.text-input` and
`.sel` — matching their sibling form controls, not the pill shape filters use.

Page layout (how many content panels a tab shows beyond the sidebar) was audited in feature
026 but deliberately not changed — see
`specs/026-filter-layout-consistency/plan.md`'s "User Story 5" section for the inventory and
proposed two-kinds rule (contextual aid vs. sticky action panel) a future feature can adopt.

## B2 Norsk design system (every tab and both nav trees done — see deferred list below for remaining exceptions)

A full visual redesign is underway, driven by `specs/DESIGN-RULES.md` and
`specs/b2-norsk.css` (copied verbatim into `public/b2-norsk.css` and linked from
`<head>`, alongside Google Fonts for Instrument Sans/IBM Plex Mono — `_headers`' CSP
was widened for `fonts.googleapis.com`/`fonts.gstatic.com` accordingly). A separate,
much more detailed reference — `specs/Web app redesign consultation.zip` — contains 5
rounds of pixel-exact mockups with real SVG icon paths; Round 4 (`id="4a"`, "Ordbank
med ny navigasjon") and Round 3's dialog spec (`id="3b"`) were treated as ground truth
for what's been built so far.

**This supersedes the feature 024/025/026 token system (`--color-primary`,
`--radius-md`, `.btn-primary`, `.topic-chip`, etc.) wherever it's been applied** — the
two systems currently coexist: anything not yet touched (every tab except Ordbank, and
the teacher sidebar) still uses the old tokens/classes documented above; Ordbank and
the student sidebar use the new ones (`--green`, `--r-pill`, `.btn`, `.pill`, `.card`,
`.tag`, `.status`, `.dialog`, `.nav-item`, `.filter-panel`). **Do not mix them on the
same element** — pick whichever system the surface you're editing already uses.

**No emoji anywhere the new system reaches.** `ICON_PATHS`/`icon(name)` (~L1436) is the
replacement — a fixed SVG set with paths lifted directly from the consultation file's
own mockup, not redrawn. Extend this set rather than reaching for an emoji; the whole
point of the redesign is that icons are structural signals (16px, stroke 1.6,
`currentColor`), not decoration.

**Tema is colour, never emoji**, in anything rebuilt under the new system —
`topicTema(topic)` (~L539) resolves a `{bg, fg}` CSS-variable pair from the 12
`--tema-*-bg`/`-fg` custom properties in `b2-norsk.css`, using the same ASCII-key
bridge as the older `topicIcon()`/`topicMeta()` helpers (which remain in place for
surfaces still on the old system).

**Student sidebar is 5 destinations, no groups**: Min uke, Ord, Lese, Skrive, Framgang,
then Innstillinger below a divider — replacing the old 4-group, 11-item list.
Flashcards/Setninger/Setningsbygging are sub-items under Ord rather than top-level
siblings, and `buildOrdbank()`'s "Øv med disse N ordene" panel launches them carrying
the *current topic filter* (`launchPracticeWithFilter()`, ~L2213) — the whole
rationale for folding them in is that they're things you do to a word set you just
filtered, not places you navigate to and re-filter from scratch.

⚠️ **`state.tab` values are unchanged for every existing surface.** The new sidebar
doesn't rename or remove any tab key — it just changes which key a nav click sends and
how the sidebar highlights it. Two consequences:
- **"Min uke" is a new composite tab** (`buildMinUke()`, ~L1710) that stacks the shared
  inbox + `buildMineOppgaver()` + `buildPlan()` **unmodified** — it composes existing
  builders rather than reimplementing them, so `"mineoppgaver"` and `"plan"` remain
  valid, independently dispatchable tab keys for any internal deep link that still
  names them directly (there is exactly one, a "Lag plan →" button in Lesing, repointed
  to `"minuke"`).
- **"Skrive" has no sub-items** — unlike Ord, it's a single nav entry that opens
  `"oppgaver"` (the prompt picker) and reads as active for both `"oppgaver"` and
  `"skriv"`, matching the reference exactly (only Ord shows expanded sub-items there).

**The teacher-facing redesign has started, scoped to the roster landing view only**
(`buildLaererRoster()`, ~L7425) — Round 5 of the consultation (`id="5a"`, "Lærer ·
Klassen min") is the reference, but that mockup shows a full sidebar+table rebuild with
data the app doesn't compute client-side yet (per-student progress bars, "ukas tekst"
status, "trenger oppfølging" counts). Building fake versions of those columns just to
match the mockup pixel-for-pixel would be inventing functionality, not restyling — so
only what the mockup and the current data model both support was done:
- Topbar (title + live student count), `.card` for the class-admin block and each
  student row (with a new `.avatar` initials chip — `.avatar` class added to
  `b2-norsk.css`, reusable anywhere else a person needs one), `.label-mono` group
  headers, `.select` for the per-student class picker, `.btn`/`.btn--danger` with icons
  for rename/delete/remove.
- **"Legg til elev" and "Ny klasse" moved into dialogs** (`buildDialog()`/`buildField()`,
  the same two already built for Ordbank's "Nytt ord"). Both used to be forms pinned
  above their list — exactly what `openDialog()`'s own comment says never to do — so
  this isn't new scope, it's applying a rule the codebase already states to two forms
  that were never brought into line with it.
- **The student progress detail (`buildLaererProgress()`, ~L7642) is also redesigned**
  — reached by clicking a roster row. `.topbar` header (name + email), back button
  reuses the plain `.btn` "← Tilbake" pattern Lesing's reader already established (a
  bare arrow character, not an icon-component — consistent with the "← ▾ ✕ ✓" Unicode
  exception elsewhere), and the 10-card KPI grid dropped its per-card emoji entirely
  rather than swap in 10 new SVGs. Per the icon rule, an icon here would be decoration:
  each card's label is already a distinct, legible word, so nothing was lost — this
  matches Statistikk's own stat-grid, which was already text-only. The numbers are a
  bare 28px/700 value with a `.label-mono` caption underneath and `.btn--link` for
  "Se detaljer →" on clickable cards; no new CSS needed, all existing tokens.
- **The per-student AI-fokus screen is also redesigned** — `buildLaererAiFokus()`
  (~L7699, the instruction editor + refinement chat) and the two feature-021 pieces
  that share the same screen, `buildReportLayoutCard()` (~L7903) and
  `buildPromptTestPanel()` (~L8062). Notably:
  - The essay/reading-summary switch in `buildReportLayoutCard()` is a
    `.pill[aria-pressed]` pair, the same toggle treatment as Innstillinger's role
    switcher and Ordbank's filter chips — not two competing buttons.
  - The block-reorder row's ↑/↓/✕ controls became `.icon-btn` (the same 24px square
    button already used for the pronunciation control on a word card) instead of
    undersized `.btn-secondary`s — they're single-glyph actions, not labelled buttons.
  - Chat bubbles dropped their hardcoded `#e8f4fd`/`#f8f9fa` for `var(--green-tint)`
    (user) / `var(--surface-head)` (assistant) — same colours, now tokens.
  - 🤖/✨/📋/🧪 emoji all removed; ✓ and ✕ were kept (the established Unicode-glyph
    exception, not emoji — `toast("✓ …")` is the same convention Ordbank already uses).
- **The AI-fokus *hub* is also redesigned** (`buildLaererAiFokusHub()`, ~L8196 — the
  class/all-students-scope version reached from the top nav rather than a specific
  student). It's the same four-card shape as the per-student screen (scope, instruction,
  rapportlayout, forhåndsvis), so the same treatment applied directly:
  - The three-way scope picker (Alle elever / En klasse / Utvalgte elever) is a
    `.pill[aria-pressed]` trio — the same toggle rule as the Stil/Gjenfortelling switch
    one card below it, not three competing buttons.
  - `updateInstrButtonLabel()`/`updateRcButtonLabel()`'s dynamic text (which describes
    *where* Lagre/Bruk will write, depending on scope) needed no changes — that logic
    lives entirely in `.textContent` assignments, untouched by the class-name swap.
  - Verified the scope switch actually re-filters correctly: selecting "En klasse" →
    a class narrows the Forhåndsvis student dropdown to that class's members, exactly
    as `renderPreviewStudentOptions()` already did before the reskin.
- **The essay list and detail views are also redesigned** — `buildLaererEssayList()`,
  `buildLaererEssayDetail()`, and `buildAiRatingWidget()` (~L8570, ~L8986, ~L9028).
  Notably:
  - The essay-card "Godkjent"/"Kommentar" indicator (previously a bare ✓ or 💬 glyph)
    became a `.status status--learned`/`.status--doing` pair — a colour-coded dot the
    list can be scanned by, matching the meaning-carrying-icon exception, not a
    decorative swap.
  - `buildAiRatingWidget()` — the teacher-rates-the-AI widget under an essay's AI
    feedback — replaced its 👍/👎 buttons with plain "Bra"/"Dårlig" `.btn`s that turn
    `.btn--primary` once picked. A thumbs glyph is content here (the rating itself),
    not decoration, so it couldn't just be dropped like the emoji elsewhere in this
    pass — it needed an actual replacement, and no thumbs icon exists in `ICON_PATHS`
    lifted from the mockup, so text was the honest choice over inventing an SVG.
  - `renderEssayClaudeResult()` itself is still the shared, untouched renderer (see the
    deferred list) — it now simply sits inside a `.card` with a `var(--surface-head)`
    background instead of the hardcoded `#f0f7ff`/`#2c5f9e` blue box, which was the
    same kind of stray hardcoded colour Ordbank's teacher toggle had before 025.
- **Texts/words/sentences detail are also redesigned** — `buildLaererTexts()`,
  `buildLaererWords()`, `buildLaererSentences()` (~L8766, ~L8831, ~L8937). Notably:
  - `buildLaererWords()` keeps its native `<table>` — it wasn't converted to the
    `.table`/`.table__row` div-grid component. That component assumes CSS-grid rows;
    this table has click-to-expand detail `<tr>`s with `colSpan`, which don't map onto
    a div-grid without real restructuring. Only the cell colours/borders were moved to
    tokens (`var(--line)`, `var(--surface-head)`, `var(--green-tint-2)` for a practiced
    row) — same "reskin, don't rebuild" call as Statistikk's donut chart.
  - The ✅/⬜ practiced-column glyphs became a plain `.status__dot` (green = øvd, gray =
    ikke øvd) — the same dot vocabulary as everywhere else state is shown at a glance,
    not a new component.
  - **Found and fixed a pre-existing bug while touching this exact line**: the per-topic
    group header's "N/total øvd" always read the *grand-total* `practiced` variable
    instead of that group's own `group.practiced` — so every group but one showed the
    same (wrong) count. One-word fix (`practiced` → `group.practiced`), verified with a
    two-group mock where the counts previously collided.
  - Topic and word-topic tags in all three views now go through `topicTema()` for their
    colour instead of a flat hardcoded blue (`#e8f4fd`/`#2c8ec4`) — the same fix
    Ordbank's teacher toggle needed in 025, found again here.
- **The teacher-facing plan and reading-summaries views are also redesigned** —
  `buildLaererPlan()` (~L8634) and `buildLaererSummaries()` (~L9133). Notably:
  - `buildLaererPlan()` mirrors the already-redesigned student `buildPlanView()`
    exactly where the two overlap: the same `.tag` "Nåværende uke" (not a bespoke "Nå"
    pill), the same `.plan-prog-wrap`/`.plan-prog-fill` progress bar **left as-is,
    unconverted** — that class pair is still the old visual language even on the
    student side (see the Studieplan note above), so converting only the teacher
    view would have made the two *less* consistent with each other, not more.
  - `week.topicEmoji` is still rendered here on purpose. This view is one of the
    three call sites named in the Studieplan note below ("one of them in a
    teacher-facing view") — it stays deferred as a set, not fixed one call site
    at a time.
  - The ✅/⬜ done-markers on plan text/essay rows became `.status__dot`, the same
    swap as the ordbank practiced-column in the texts/words/sentences pass.
- **Tekstbank and Oppgavebank are also redesigned** — `buildLaererBankTexts()`
  (~L10142), `buildLaererBankPrompts()` (~L10381), and the card renderer both banks
  share, `renderPickCard()` (~L10082). Notably:
  - **`renderPickCard()`'s bespoke `.pick-card`/`.pick-check`/`.pick-title`/
    `.pick-meta`/`.pick-preview`/`.pick-more` CSS classes were deleted outright** (not
    just stopped using — removed from the stylesheet, nothing else referenced them).
    The card itself now reuses `.card[aria-selected]`, the same selected-state
    language as Skriv's topic tiles; the one addition is a circular ✓ badge
    (`icon("check")` in a tinted `.icon-btn`), since a dense list of many selectable
    cards benefits from a corner scan-target the border+tint alone doesn't give —
    the old version had exactly this badge too, just built from raw hex.
  - The three-way tab row in both banks (Systemtekster/Mine tekster/+ Ny tekst, and
    the prompt equivalent) became a `.pill[aria-pressed]` trio, same rule as every
    other exclusive-choice toggle this pass touched.
  - **`buildClassQuickSelect()` and `attachWordCounter()` were deliberately left on
    the old system.** Both are small shared helpers also called from
    `buildGiOppgaver()`, which is still old-system and appended unmodified at the
    bottom of the roster — that was true only until this same pass reached
    `buildGiOppgaver()` itself (see below), which resolved it.
- **`buildGiOppgaver()` is also redesigned** (~L9453, the assignment picker appended
  at the bottom of the roster — by far the largest single function touched this
  pass: two modes, three source tabs each for texts and essays, an optional word-list
  builder). Same vocabulary throughout — `.pill[aria-pressed]` for every exclusive
  toggle (mode, and each source-tab row), `.status__dot` instead of a literal "✓" text
  glyph for already-added rows, `.pill--removable` chips (with an `icon("close")` in
  a small `.icon-btn`) for the selected-texts/selected-essay lists instead of
  `#e8f5ee`-background rows with a bare "×" button.
  - **Because this was the last caller, `buildClassQuickSelect()` and
    `attachWordCounter()` — the two small helpers flagged as "deliberately left on
    the old system" in the Tekstbank/Oppgavebank note above — were converted too.**
    All three call sites (`buildLaererBankTexts`, `buildLaererBankPrompts`,
    `buildGiOppgaver`) are now new-system, so there was no longer a mixed-system
    caller to avoid; the inconsistency flagged one pass ago is fully resolved, not
    just moved.
- **The teacher's top nav is also redesigned** (`renderTabs()`'s teacher branch,
  ~L1596) — the last piece of Round 5. It's a bounded conversion, not the mockup's
  full sidebar: the same six destinations, the same three groupings ("Lærer" /
  "Mine banker" / "Konto"), the same `teacherState.view` dispatch, now built from
  `buildNavItem()` instead of the old `.tab-btn` class, with the group labels as
  `.label-mono` instead of the now-deleted `.nav-section-label`.
  - **Per-class expansion and roster-health badges (trenger oppfølging / til
    retting) from mockup section 5a were deliberately not built.** Both need data
    the backend doesn't expose yet — building them as decoration with no real
    numbers behind them would be fabricating functionality, the same restraint
    applied throughout this pass (see the roster and progress-detail notes above).
  - **Added `people` to `ICON_PATHS`** for "Klassen min" — lifted verbatim from the
    mockup's own sidebar SVG (section 5a), not redrawn, per the icon rule. "AI-fokus"
    intentionally has no icon: nothing in the mockup's icon set represents it, and
    inventing one would be the same fabrication problem as the missing thumbs-up/
    down icon in the AI-rating widget (see the essay-detail note above) — there,
    text ("Bra"/"Dårlig") was the honest substitute; here, for a plain nav label,
    *no* icon is the honest substitute. Tekstbank/Oppgavebank/Ordbank reuse `book`/
    `pen`/`words` — the same icons already carrying those exact meanings in the
    student sidebar (Lese/Skrive/Ord), not new assignments.
  - **Fixed a leftover from the original student nav restructure while touching
    the shared code above the role branch**: the sidebar brand row still read
    `class="sidebar-brand"` (hyphen) with a 🇳🇴 flag emoji, even though
    `b2-norsk.css` had an unused `.sidebar__brand` (double-underscore) rule sitting
    right next to `.nav-item` the whole time. Switched the element to the existing
    rule and dropped the emoji — this fixes both roles' sidebars, since the brand
    row renders once above the role branch.
  - **`.tab-btn`, `.nav-section-label`, and `.sidebar-brand` were deleted from the
    stylesheet** (grepped first — no other caller). `.tabs` itself (the sidebar's
    236px fixed-position container) was left alone; it's shared with the
    already-redesigned student nav, which never renamed the container class either.
  - Verified both roles by calling `renderTabs()` directly with mocked `state`/
    `teacherState`: correct active-state highlighting, correct counts (roster
    student count, word bank size), and no regression to the student sidebar,
    which shares the same brand-row code path.

With this, every teacher view and both nav trees are on the new system. What
remains is listed below — content shared with the student side, or content this
pass judged too risky to touch, not navigation.

**Mine oppgaver and Studieplan are also redesigned** (they're what "Min uke" actually
shows). No exact mockup exists for either — the component vocabulary was applied by
the same rules as Ordbank, not lifted from a reference screen. Notably:
- Mine oppgaver's assignment-type badges (`ITEM_TYPE_META`, ~L9159) keep their icon —
  it's load-bearing (the only signal of an item's kind in the list), consistent with
  the icon-usage rule.
- Studieplan's `week.topicEmoji` **still renders an emoji** — it comes from
  `generatePlan()`'s data model (~L6217) and reaches three render call sites, one of
  them in a teacher-facing view; replacing it with `topicIcon()` needs each of those
  three checked rather than a two-line fix, so it was left alone rather than done
  halfway. Same for the mini week-overview at the bottom of Studieplan
  (`.plan-week-mini*` classes, ~L6597) — untouched, still the old visual language.

**Lesing is also redesigned** (`buildLesing()`/`refreshLesingList()`/`buildLesingReader()`,
~L5262-5919) — filter panel, text cards (tema tag + status), the reader header, grammar/
key-word tags, comprehension-question option colours, and the Gjenfortell buttons/textarea
all use the new tokens. Two things worth knowing:
- **The word-lookup and add-to-bank flow's dynamic `innerHTML` strings
  (`doLookup()`/`addWord()` inside `buildLesingReader()`) were deliberately left alone.**
  Only their surrounding static chrome (headings, input/button classes) was converted.
  This is the highest-complexity, most-edge-case-heavy logic in the reader — restyling the
  template strings themselves risked breaking a core feature for cosmetic gain, so it's a
  named exception, not an oversight.
- **TTS play/pause/stop glyphs (▶︎ ⏸ ⏹) were kept as-is**, same reasoning as the arrows
  used elsewhere (→ ▾ ✕ ✓) — they're monochrome Unicode control symbols the reference
  mockup itself uses this way, not decorative pictographic emoji.

**Skrive is also redesigned** (`buildOppgaver()` ~L3663, `buildSkriv()` ~L3761) — the topic
picker is now tema-swatch tiles (no big emoji, `aria-selected` drives the green
border+tint every other card uses) instead of `TOPICS`' own per-topic emoji+colour; the
prompt panel, prompt box, action-button row (one primary — "Sjekk tekst med Claude" — the
rest outline/accent, per "one primary action per screen"), and sidebar (word chips, tips
box) all use the new tokens. Two things worth knowing:
- **`#sb-title`'s tag changed from `<h3>` to `<div>`.** `updateWritePanel()` (~L4289)
  updates it by id on every keystroke — both the initial render and that updater had
  their `📚` emoji removed together, so re-check both call sites if this text ever
  changes again, not just one.
- **The recommended-words hint is deliberately NOT `.tag`.** `.tag` is sized for a short
  flat label (11px mono) — using it for a full sentence made the text nearly unreadable
  on first pass. Fixed with a plain styled `<div>` instead. If a new full-sentence
  callout is needed anywhere, don't reach for `.tag`; it's metadata-label-sized only.

**Statistikk is also redesigned** (`buildStatistik()`, ~L6654) — card header/section
labels converted to `.card__title`/`.label-mono`, the missed-words action row to
`.btn`/`.btn--primary` with `icon("printer")` on the two export buttons (both
`printMissedWords()` calls are print/export actions, so they share one icon), and the
empty/loading states to plain `.card__title`+`.card__note` text with no decorative
emoji. Two things worth knowing:
- **Per-topic bar-chart fill colour now comes from `topicTema(topic).fg`** for "Leste
  tekster etter tema" — each topic's bar is its own tema colour instead of one fixed
  green for every row, consistent with "tema is colour" elsewhere. "Essays etter tema"
  keeps a single `var(--green)` fill (it groups by free-text `topicName`, not the
  canonical topic list, so `topicTema()` isn't guaranteed to resolve).
- **The donut chart and `.stat-*`/`.donut-*` CSS classes were kept** — a full component
  rewrite (converting the SVG donut and bar rows onto `.card`/`.pill`) was judged too
  risky for the value; instead the hardcoded hex in both the JS (segment colours, center
  '%' text) and the classes' own CSS (in `norsk_b2_pro.html`'s `<style>`, ~L282-303) were
  swapped for design tokens (`var(--green)`, `var(--surface)`, `var(--line)`,
  `var(--ink-2)`, `var(--tema-helse-bg)`) where a token existed, with the old hex kept
  only as a `var(..., fallback)` safety net. The "❌" glyph on each sentence-miss row was
  removed — the row's own red background already signals "wrong".

**Innstillinger is also redesigned** (`buildInnstillinger()`, ~L7233) — the last plain
student tab. `<h2>` section headings lost their emoji (👤/👩‍🏫/💳) in favour of
`.card__title`, and the profile fields/messages are plain `.card__sub`/`.card__note`
text. Two things worth knowing:
- **The role switcher (student ⇄ teacher) is a `.pill[aria-pressed]` pair, not two
  buttons.** It's the same "toggle maps onto secondary, never primary/blue" rule as
  Ordbank's Mine ord/Elevenes ord toggle (feature 025) — reusing the filter-pill
  selected treatment (outline+tint+✓) meant no new CSS was needed, and it reads as "pick
  one of two" exactly like a filter facet does. Clicking the already-active pill is
  still a no-op, same as before.
- **`buildSubscriptionSection()`'s paid/grace/cancelled branches were deliberately left
  untouched.** `SUBSCRIPTION_ENABLED=false` (see "Subscription paywall" above) means
  those branches are dead code in production right now, so restyling them would be
  unverifiable and risks silently breaking the payment machinery for zero visible
  benefit. Only the live `!SUBSCRIPTION_ENABLED` branch — the "Full tilgang" badge — was
  converted, to `.status.status--learned` (green dot) instead of the old
  `.sub-status-badge` class plus a redundant "✓" character in the text.

**Post-review fixes (staging review after the redesign pass above)** — Maria's first
pass over staging found four gaps the redesign work missed:
- **Ordbank was missing a tag filter facet entirely.** Feature 023 added named word
  tags with a filter to Setninger and Flashcards, but never to Ordbank itself — this
  wasn't something the redesign dropped, it was never built. Added as a fifth facet
  (`state.ordTagFilter`, wired into `getFilteredWords()`/`resultLineText()`), using
  `allWordTags()` — the same helper Setninger's tag facet already used — so it only
  appears when at least one word actually carries a tag, mirroring TEMA's own
  visibility rule.
- **`buildOrdbankModeToggle()`** (Mine ord / Elevenes ord) was still on old tokens —
  `var(--color-primary)` fill, `#dde` border — sitting directly above the now-redesigned
  Ordbank chrome. Converted to a `.pill[aria-pressed]` pair, the same toggle rule as
  every other exclusive-choice control.
- **`buildTeacherWordAggregatePanel()`** ("Elevenes ord") and its `_aggFilterChipRow()`
  helper were entirely untouched — old `.topic-filter-bar`/`.topic-chip` chips, `#dde`
  selects, `🖨️` emoji on the print buttons. Rebuilt onto `.filter-panel`/`.facet`/
  `.pill` (matching "Mine ord" exactly, which was always the point of this view — see
  the code comment on `_aggFilterChipRow`), with `.select` for the source-text filter
  and `icon("printer")` buttons.
- **Setninger and Flashcards were fully untouched** — both were large, self-contained
  passes:
  - Setninger (`buildSetninger()`, ~L3274, plus `renderClaudeResult()`,
    `checkWithClaude()`, `fillSentenceFeedback()`): filter panel converted from
    `buildFilterToggle()`/`.topic-filter-bar` to the shared `.filter-panel`/facet/pill
    component (TEMA + TAGG); word card, AI grammar-check result, and previous-sentences
    list all converted to `.card`/`.tag`/`.status`/tokens. `renderClaudeResult()` is
    Setninger's own AI renderer (not shared with any teacher view, confirmed by grep),
    so it was safe to redesign fully — unlike `renderEssayClaudeResult()`/
    `renderGjenfortellResult()`, which stay deferred for exactly that reason.
  - Flashcards (`buildFcSetup()`/`buildFcHeader()`/`buildFcChoiceCard()`/
    `buildFcWriteCard()`/`buildFcDone()`, ~L4402): same filter-panel/facet/pill
    treatment for setup; the centered-card/2-column-option-grid layout is different
    enough from anything else in the app that it kept its own `.fc-card`/`.fc-options`/
    `.fc-opt` classes rather than being forced into `.card`/`.btn` — but every hardcoded
    hex in them was retokenized (`var(--green)`, `var(--danger)`, `var(--tema-helse-bg)`,
    etc.), the same "reskin the bespoke layout, don't rebuild it" call as Statistikk's
    donut chart. The celebratory result-screen emoji (🎉/👍/💪) were dropped — decorative
    only, no load-bearing meaning — leaving the message text alone to carry it.
  - **`buildFilterToggle()` itself was left alone**, since Setningsbygging still calls
    it and is not part of this fix. Setninger and Flashcards now build their filter
    headers inline instead of through that helper — the same "leave a shared helper on
    the old system until its last non-redesigned caller is gone" call made for
    `buildClassQuickSelect()`/`attachWordCounter()` earlier in this pass.
  - Confirmed-dead CSS deleted after checking every remaining call site by grep:
    `.claude-improved*`, `.claude-tip`, `.sent-nav/-progress/-card/-word/-meta/-prompt/
    -area/-feedback/-actions/-badge/-saved-label/-done-box`, `.prev-sent*`,
    `.btn-next-sent`, `.btn-nav`, `.fc-setup/-section-label/-mode-*/-filter-bar/
    -score-*/-progress-*`, `.fc-done-emoji`, `.btn-fc-next`. **Kept**: `.sent-cat`,
    `.sent-topic-badge`, `.btn-skip` — still used by Flashcards's own card layout — and
    every `.claude-*` class `renderEssayClaudeResult()`/`renderGjenfortellResult()`
    still depend on.

**Deliberately not done yet**, in priority order a future pass should pick up:
1. The full sharing redesign (one-click send + confirm-strip-with-Angre + optional
   message + inbox in Min uke) — current share flow still works, just isn't restyled
   to the new system's card/dialog language.
2. `week.topicEmoji` in Studieplan (see above) and the mini week-overview's styling.
3. Lesing's word-lookup `innerHTML` templates (see above).
4. `renderEssayClaudeResult()`/`renderGjenfortellResult()` (~L4102/4222) — the AI-feedback
   renderers shared between the student Skriv/Lesing tabs and the teacher essay/summary
   detail views. Both teacher views around them are now redesigned (they sit inside a
   `.card` with a `var(--surface-head)` background instead of the old hardcoded blue
   box), but the renderers' own internals (level badge, error/strength/improvement
   blocks) are untouched — restyling the one shared component affects four call sites
   at once, which is a larger, separate pass, not something to do incidentally.
5. `buildSubscriptionSection()`'s paid/grace/cancelled branches (see above) — dead code
   while the paywall is off, so restyling them can't be verified in the running app.
6. Round 5 (the teacher-facing redesign) is fully done, nav included — see the
   "teacher's top nav" note above. The only thing it deliberately stopped short of is
   matching mockup section 5a's *sidebar structure* pixel-for-pixel (per-class
   expansion, roster-health badges) — that needs roster stats the backend doesn't
   expose yet, which is new backend work, not a frontend reskin.
7. Setningsbygging (`buildOrdstilling()`, uses `ws` state) is now the only student
   tab still on the old system — it shares `buildFilterToggle()`/`.topic-filter-bar`
   with what Setninger and Flashcards used to have before the post-review fixes
   above. Same treatment needed: filter panel onto `.filter-panel`/`.facet`/`.pill`,
   game chrome onto tokens.

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
