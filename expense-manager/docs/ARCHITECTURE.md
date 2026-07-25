# Ledger — Architecture Guide

Ledger is a local-first personal expense manager. It ships as an Electron
desktop app with a SQLite database on disk, and degrades to a browser-only
mode (`localStorage`, no encryption, no OS keychain) when run outside
Electron. This document explains how the pieces fit together and *why* the
non-obvious decisions were made.

## 0. Scope: expenses only

Ledger deliberately tracks **spending and nothing else**. There is no
income, savings, net-worth, or budget concept anywhere in the data model,
and adding one back is a schema change rather than a screen. Every figure
in the app answers "what did I spend, and how has that changed?" — never
"am I under a target?".

Two consequences worth knowing before reading further:

- `FlowType` has three values, not four. A deposit has nowhere to go.
  `merchant_credit` (a refund) nets *against* spend in its category;
  `transfer` (card payments, account-to-account movement) is excluded from
  spend entirely. Neither is treated as income.
- The app is built for **credit-card statement imports**. That's what makes
  the above safe: on a card statement a positive amount is either a
  payment or a refund, never a paycheck. `classifyFlow` still parks an
  unexplained positive amount on a non-card account as a `transfer`, so it
  can never silently reduce a spend total.

Comparison against history replaces comparison against targets: see
`categoryMovers`, `spendStats`, `rollingAverage`, `unusualCharges`,
`categoryAnomalies`, `dayOfWeekSpend`, `spendPace`, and `merchantTrends`
in `lib/analytics.ts`, surfaced on the Trends and Analytics screens.

A recurring hazard across all of these: never construct a `Date` from a
raw ISO string (`new Date(t.date)`) — `Date` parses a bare `YYYY-MM-DD`
string as UTC midnight, and in any timezone behind UTC that's the
*previous* local calendar day, silently shifting weekday/day-of-month
math by one. `dayOfWeekSpend`'s `isoWeekday()` helper and every date
constructor in `format.ts` build `Date`s from explicit parsed `(year,
monthIndex, day)` components instead, which `Date` always treats as
local time. This isn't theoretical — an early version of
`dayOfWeekSpend`'s own *test harness* (not the function) hit exactly
this bug, misattributing a large chunk of spend to the wrong weekday
under a UTC-4 test environment, and it looked entirely plausible until
cross-checked against a timezone-safe recomputation.

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| UI | React 19 + TypeScript, Vite 8 | single-page app, no router — view switching is local state |
| Desktop shell | Electron 43 | contextIsolation + sandboxed preload, no `nodeIntegration` |
| Database | `node:sqlite` (`DatabaseSync`) | built into Node 24+, **no native compiler required** |
| Packaging | electron-builder (NSIS) | Windows installer today; the config is cross-platform-ready |
| AI categorization | Claude (`@anthropic-ai/sdk`) or Gemini (REST) | optional, user-supplied key, off by default |

### Why `node:sqlite` instead of `better-sqlite3` or Tauri+`rusqlite`

This machine has no Rust toolchain, no MSVC build tools, and no `node-gyp`
prerequisites installed. `better-sqlite3` and most native SQLite bindings
need to compile a C addon at install time; Tauri needs a full Rust
toolchain. `node:sqlite` is a built-in Node module (stable since Node 22,
used here on Node 24) with zero native compilation — `npm install` just
works. The trade-off, discussed in §5, is that it has no encryption
extension (no SQLCipher), which shaped the security design.

## 2. Process architecture

```
┌─────────────────────────────┐        IPC (contextBridge)        ┌──────────────────────────────┐
│   Renderer (Chromium)       │ ───────────────────────────────▶  │   Main process (Node)         │
│                             │ ◀───────────────────────────────  │                                │
│  React app (src/)           │      window.ledgerApi.*           │  electron/main.cjs             │
│  - screens/*.tsx            │                                    │  electron/db.cjs (SQLite)      │
│  - store.tsx (useReducer)   │                                    │  electron/secrets.cjs (keychain)│
│  - lib/*.ts (pure logic)    │                                    │  electron/dbCrypto.cjs (AES-GCM)│
│  sandbox:true, no Node APIs │                                    │  full Node + OS access          │
└─────────────────────────────┘                                    └──────────────────────────────┘
```

The renderer never touches the filesystem, SQLite, or the OS keychain
directly. Everything crosses through `electron/preload.cjs`, which exposes a
narrow, typed surface as `window.ledgerApi` (declared in
[`src/electron.d.ts`](../src/electron.d.ts)). `contextIsolation: true` +
`sandbox: true` + `nodeIntegration: false` mean a compromised renderer
(e.g. malicious content rendered from imported CSV data) cannot reach
Node or Electron APIs except through that bridge.

When there's no Electron host (`window.ledgerApi` is `undefined` — i.e. the
app was opened as a plain web page via `npm run dev`), [`src/lib/persist.ts`](../src/lib/persist.ts)
falls back to `localStorage` for the whole `AppData` blob. This is the
**browser fallback mode**: same UI and logic, no SQLite, no encryption, no
OS-keychain API key storage, no PDF export. It exists mainly for fast UI
iteration; see the User Guide for why it isn't recommended for real data.

## 3. State management

`src/store.tsx` is a single React Context + `useReducer` store holding the
entire `AppData` object (accounts, transactions, categories, rules,
batches, profiles, settings). There's no per-screen local
copy of domain data — every screen reads from and dispatches to this one
store, which keeps derived views (dashboard totals, review counts,
category trees) always in sync.

- **Hydration**: `StoreProvider` starts with `ready = false`, calls
  `loadData()` (Electron IPC `db:load` or `localStorage`), then flips
  `ready = true`. `main.tsx` additionally checks `securityGetState()` first
  — if the database is encrypted-at-rest and locked, it renders
  `<LockScreen>` instead of mounting the store at all.
- **Persistence**: every dispatch that mutates data schedules a debounced
  `saveData(state)`, which round-trips the *entire* `AppData` object.
- **Business logic split**: the reducer itself is thin. Anything with real
  rules — category CRUD with referential-integrity remapping
  ([`lib/categoryOps.ts`](../src/lib/categoryOps.ts)), rule matching
  ([`lib/categorize.ts`](../src/lib/categorize.ts)), transfer/flow
  classification ([`lib/classify.ts`](../src/lib/classify.ts)), report
  aggregation ([`lib/report.ts`](../src/lib/report.ts)) — lives in
  `src/lib/*.ts` as pure, independently testable functions. The reducer
  calls into these and stores the result.

## 4. Persistence: full-snapshot, not incremental

Every save writes the *whole* dataset, not a diff:

- **Main process** (`electron/db.cjs`, `saveSnapshot`): one SQL transaction
  that `DELETE`s every row from every table, then bulk-`INSERT`s the
  incoming `AppData`. `loadSnapshot` does the reverse — read every table,
  reassemble `AppData` (including re-attaching `transaction_splits` rows
  onto their parent transaction's `splits` array).
- **Browser fallback**: `JSON.stringify(state)` into a single
  `localStorage` key.

This was a deliberate simplicity-over-throughput trade-off: at the
"thousands to tens of thousands of transactions" scale this app targets, a
full rewrite inside one transaction is fast enough (sub-100ms) and
eliminates an entire class of bugs — partial writes, drift between
in-memory state and disk, incremental-sync edge cases — for free. It would
not scale to millions of rows; that's out of scope for a personal finance
tool.

Two related version numbers are tracked, deliberately kept separate:

- `SCHEMA_VERSION` (in `db.cjs`) — the SQLite table structure. Currently
  `2` (added `transaction_splits` in this version).
- `AppData.schemaVersion` / `APP_DATA_VERSION` (in `types.ts` / `db.cjs`)
  — the shape of the JSON backup format used by manual export/import
  (`db:backup` / `db:restore`). Currently `1`.

These used to be conflated (`loadSnapshot` returned the SQLite structural
version as the JSON schema version), which would have silently broken
backup/restore compatibility checks. Keep them separate when adding future
migrations.

## 5. Security model

### 5.1 API key storage (OS keychain)

LLM API keys (`electron/secrets.cjs`) are stored via Electron's
`safeStorage` API, which delegates to Windows DPAPI, macOS Keychain, or
Linux `libsecret` depending on platform. Each provider gets its own file
(`<userData>/secrets/anthropic-api-key.enc`,
`<userData>/secrets/gemini-api-key.enc`) so switching providers doesn't
discard the other's key. The provider id arriving over IPC is resolved
through a filename allowlist rather than interpolated into a path, so an
unexpected value can't escape the secrets directory.

Keys are **never** part of `AppData`/`Settings` — a deliberate type-level
decision (see the comment in `src/types.ts` above `Settings`) so they can
never leak through a JSON backup, a full-database export, or a bug that
logs `AppData`. Which provider is *selected* is not a secret, so
`settings.aiProvider` does live in `AppData`.

`safeStorage` requires the full Electron app context; it does not work
under `ELECTRON_RUN_AS_NODE`, which is why `secrets.cjs` has to be
exercised with a real `app.whenReady()` harness in tests, unlike `db.cjs`.

### 5.2 Database encryption at rest

`node:sqlite` has no SQLCipher-equivalent extension, so page-level
continuous encryption isn't available. Instead, `electron/dbCrypto.cjs`
implements **whole-file encryption between sessions**:

1. On enable: derive an AES-256 key from the user's passphrase with
   `scrypt` (salt stored in `ledger.security.json`), checkpoint the WAL
   (`PRAGMA wal_checkpoint(TRUNCATE)`, so there's only one file —
   `ledger.sqlite` — to encrypt instead of three), close the DB, encrypt
   `ledger.sqlite` → `ledger.sqlite.enc` (AES-256-GCM, layout
   `[iv(12)][tag(16)][ciphertext]`), delete the plaintext file.
2. On next launch: `main.cjs` sees `ledger.sqlite.enc` present and
   `ledger.sqlite` absent, sets `dbLocked = true`, and the renderer shows
   `<LockScreen>` instead of the app. Submitting the passphrase
   (`security:unlock`) derives the key, decrypts back to `ledger.sqlite`,
   opens it normally, and caches the derived key in memory (`cachedKey`,
   process memory only, never written to disk).
3. On graceful quit (`before-quit`, guarded against re-entrancy by
   `quitting`): if encryption is enabled, checkpoint + close + re-encrypt
   using the cached key, so the passphrase doesn't need to be re-entered
   every save.

**Explicit limitation, disclosed to the user in-app**: the database is
plaintext on disk *while the app is running*, and encryption only happens
at graceful shutdown. A crash or force-kill (task manager, power loss)
leaves that session's data unencrypted on disk until the next clean quit.
This is a real, load-bearing trade-off of building on `node:sqlite` rather
than a cipher-capable engine — it is not full at-rest encryption, and the
UI copy should keep saying so rather than overclaiming.

## 6. Data flow: import → categorize → review

1. **Import** (`src/screens/ImportWizard.tsx` + `lib/importer.ts` +
   `lib/ingest.ts`): CSV (PapaParse) or Excel (SheetJS) file → column
   mapping (`ImportProfile`, reusable per account) → normalized rows.
2. **Classification** (`lib/classify.ts`): each row is classified into a
   `FlowType` (`expense` / `merchant_credit` / `transfer`)
   using description-pattern heuristics (payment/transfer/refund regexes)
   plus, for transfers specifically, cross-account pair-matching
   (`findTransferPairs`: a debit on checking/savings + a near-equal credit
   elsewhere within ±3 days). This runs *before* categorization so
   transfers and card payments never show up asking to be categorized.
3. **Categorization** (`lib/categorize.ts`): for each remaining
   transaction, `matchRules` checks the rule set (`exact` / `contains` /
   `regex` merchant patterns) — user-created rules win ties over
   system/seed rules (confidence 0.98 vs 0.95). Unmatched transactions are
   either left uncategorized or sent to an LLM if
   `settings.apiFallbackEnabled` is on (opt-in, off by default, per the
   privacy requirement).

   `lib/api.ts` dispatches to one of two interchangeable backends chosen
   by `settings.aiProvider`: **Claude** through `@anthropic-ai/sdk`, or
   **Gemini** through a single `fetch` against the REST endpoint (no
   second SDK — it keeps the bundle smaller and avoids opting into
   another browser-environment escape hatch; the key travels in the
   `x-goog-api-key` header, never a URL). Both share the same system
   prompt, the same taxonomy rendering, and a provider-appropriate JSON
   schema (Anthropic's `output_config.format`, Gemini's
   `generationConfig.responseSchema` — an OpenAPI subset using uppercase
   type names and `nullable` instead of union types). Both funnel through
   `normalizeResults`, so the rest of the app never learns which provider
   answered. Only merchant names are sent in either case.

   **Model ids are not hardcoded-and-forgotten.** Both providers retire
   ids on their own schedule (this bit us once: a default went two
   generations stale and every call 404'd). `AI_PROVIDERS` holds a
   built-in default plus known alternates, and `settings.aiModels` stores
   an optional per-provider override edited in Settings — so moving to a
   newer model is a text field, not a rebuild. `modelFor()` resolves
   override-then-default, and a 404 from Gemini is rewritten to name the
   offending model and point at that field.
4. **Learning**: any manual categorization (initial confirm, review-queue
   correction, or accepting an AI suggestion) calls `learnRule`, which
   creates or updates an `exact`-match user rule for that merchant, so the
   same merchant auto-categorizes correctly next import.
5. **Review queue**: `needsReview(t)` (`lib/categorize.ts`) flags a
   transaction when it's not yet `reviewed`, isn't a transfer, and either
   has no category or confidence below `REVIEW_THRESHOLD` (0.7). The count
   surfaces as a badge on the Transactions nav item.

### 6a. Manual entry

Cash and other off-statement spending bypasses the pipeline above: the
`addManualExpense` reducer case builds the `Transaction` directly, with
`categorizationSource: 'manual'`, `confidence: 1`, and `reviewed: true`,
so it never enters the review queue. Two details are load-bearing:

- **Cash accounts are excluded from `findTransferPairs`.** That function
  runs over *existing* transactions on every import, so a hand-entered
  cash expense that happened to match a card credit in amount and date
  would otherwise be silently reclassified as a transfer and vanish from
  spend.
- **The Cash account is created with a blank `issuingBank`.** That field
  feeds `looksLikeCardPayment`, which matches a bank name near "PAY"/
  "PMT" — an account literally named "Cash" would make a description like
  "CASH APP PAYMENT" look like a card payment.

Descriptions still go through `normalizeMerchant`, so a typed "starbucks"
aggregates with the imported "SQ *STARBUCKS #4471". `importBatchId` is the
`MANUAL_BATCH_ID` sentinel; nothing dereferences that field, so no
`ImportBatch` row is fabricated to match it.

## 7. Categories, splits, and referential integrity

Category CRUD (`lib/categoryOps.ts`) is written as pure functions so
integrity rules are enforced in one place rather than scattered across
screens:

- `'other'` (`UNCATEGORIZED_ID`) is a protected category — it can't be
  deleted or merged away, since it's the fallback target when a category
  is deleted with no reassignment and a `TransactionSplit.categoryId`
  (non-nullable by type) needs somewhere to point.
- **Delete** cascades to subcategories; the caller must supply a
  reassignment category for any transactions/splits/rules
  currently pointing at the deleted category (or they fall back to
  `'other'`).
- **Merge** reparents subcategories into the target category instead of
  deleting them, and remaps every reference the same way delete does.
- `categoryUsage()` counts impact before a destructive action; its
  `transactions` count is the *union* of transactions that reference the
  category directly or through a split (not two disjoint counts), which
  matches the "(N within splits)" language in the delete-confirmation UI.

**Splits**: a `Transaction` can carry a `splits?: TransactionSplit[]`
array. When splitting is active, the parent's own `categoryId`/
`subcategoryId` are cleared to `null` — the split rows are the source of
truth for categorization once present — and the UI enforces that split
amounts sum exactly to the transaction total before allowing a save.

## 8. Reports & export

`lib/report.ts` is a pure data layer: `buildReport(data, range, title)`
takes any `AppData` slice and a date range and returns a `ReportData`
(summary totals, category breakdown, hierarchical category detail, top
merchants, month-by-month trend, itemized transactions, tax-deductible
rows). Four templates (`REPORT_TEMPLATES`) reuse the same function with
different default section toggles and range logic — Monthly defaults to
the current month, Annual to the current year, Expense Breakdown to a
trailing window, Custom to a user-picked range.

Rendering and export live in `src/screens/Reports.tsx`, deliberately kept
separate from the data layer:

- **PDF**: Electron's `webContents.printToPDF()` via IPC
  (`report:exportPdf`) in the desktop app.
- **Print**: `window.print()` + a `@media print` stylesheet in
  `index.css` (`.report-print-area` shown, everything with `.no-print`
  hidden) — works in both desktop and browser-fallback mode.
- **Chart image export**: `PieChartSvg` (a real `<svg>`, not the CSS
  `conic-gradient` `Donut` used elsewhere in the UI, which can't be
  serialized to an image) + `downloadSvgAsImage()` in `src/components/ui.tsx`.

No PDF library is bundled — this mirrors the requirements doc's stated
technical approach of using the OS/browser's native print pipeline
instead of a client-side PDF renderer.

**Drill-down**: every row in "Spending by category" and "Expenses by
category" is clickable and opens `CategoryDrilldownModal`, which reuses
`report.categoryDetail` (already computed, not recalculated) for the
subcategory chips and calls `transactionsInCategory()` to list the
underlying transactions for the report's date range. That helper is
split-aware — a split transaction matches if *any* of its splits lands in
the category, the same contribution logic `buildCategoryDetail` already
uses internally, just exposed for filtering rather than aggregation.
Clicking a subcategory row opens straight into that subcategory; a `null`
subcategory id (vs. `undefined`) specifically means the "no subcategory"
bucket. The modal has its own CSV export scoped to whatever's currently
filtered.

## 9. Build & packaging

- `npm run dev` — Vite only, browser-fallback mode, hot reload, fastest
  iteration loop for UI work.
- `npm run electron:dev` — Vite dev server + Electron pointed at it
  (`VITE_DEV_SERVER_URL`), full desktop mode (real SQLite, keychain,
  encryption) with hot reload.
- `npm run build` — `tsc -b && vite build`, type-check + production
  renderer bundle to `dist/`.
- `npm run electron:build` — builds the renderer, then runs
  electron-builder (NSIS target) to produce `release/Ledger Setup
  <version>.exe`.

**Known local workaround**: electron-builder's binary-extraction step can
lose a race with Windows/AV file locks on a freshly-downloaded Electron
zip, failing with `EPERM: rename 'win-unpacked.tmp' -> 'win-unpacked'`.
This repo's `node_modules/app-builder-lib` has been patched locally
(`extractArchive`) to retry the rename a few times with backoff and fall
back to copy+delete. **This patch lives only in `node_modules` and is not
tracked by npm/git** — if you run a clean `npm install`, you may need to
reapply it (or simply retry the build; it's a transient race, not a
deterministic failure).

## 10. Where things live on disk

All real user data lives *outside* this repository, in the OS per-user
app-data directory (`app.getPath('userData')`), currently under the
folder name `expense-manager` (the Electron `appId`/internal name — the
product is branded "Ledger" in the UI, but the on-disk folder hasn't been
renamed to match):

```
%APPDATA%\expense-manager\        (Windows)
  ledger.sqlite                   plaintext DB (present when unlocked / encryption off)
  ledger.sqlite.enc               encrypted DB (present when encryption on + app closed)
  ledger.sqlite-wal / -shm        SQLite WAL side files (transient)
  ledger.security.json            { encrypted: bool, salt } — no key material
  secrets/anthropic-api-key.enc   safeStorage-encrypted Claude API key
  secrets/gemini-api-key.enc      safeStorage-encrypted Gemini API key
```

The repo's `.gitignore` blocks `*.sqlite*`, `ledger.security.json`, and
`release/` defensively, even though none of them should ever be inside
the repo tree in normal operation.
