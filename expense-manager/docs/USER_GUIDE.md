# Ledger — User Guide

Ledger is a private, local expense tracker: your transactions, categories,
and reports live on your own machine, not in the cloud. This guide covers
installing, running, and using the app day to day.

## 1. Installing & running

You have three ways to run Ledger, depending on what you need:

| Method | Command | What you get |
|---|---|---|
| Installed app | run `release\Ledger Setup 0.1.0.exe` | Normal desktop app: Start Menu shortcut, SQLite storage, OS-keychain API key, database encryption. Recommended for real use. |
| Dev mode (desktop) | `npm run electron:dev` (from `expense-manager/`) | Same desktop feature set as above, but running from source with hot reload. Use this if you're developing the app. |
| Browser mode | `npm run dev`, then open the printed `localhost` URL | Runs in a regular browser tab. Data is stored in `localStorage` instead of SQLite, and API-key storage, database encryption, and PDF export are unavailable. Fine for a quick look, **not recommended for your real financial data** — no encryption, no OS-level protection, and data can be lost if you clear browser storage. |

To build a fresh installer yourself: `npm run electron:build` (produces
`release\Ledger Setup <version>.exe`).

The first time you launch with no existing data, Ledger seeds itself with
sample accounts and transactions so you can explore the UI before
importing your own data.

## 2. The layout

- **Top bar**: global search (jumps to Transactions and filters as you
  type) and the **Import** button.
- **Sidebar**: three sections —
  - *Overview*: Dashboard, Transactions (badge = items awaiting review),
    Analytics
  - *Insights*: Trends, Subscriptions
  - *Manage*: Categories & Rules, Reports & Export, Settings
  - Below that, your linked accounts and household name.

## 3. Importing transactions

Click **Import** to open the wizard:

1. **Choose account** — pick which linked account this statement belongs
   to (or add a new account first, from Settings).
2. **Choose file** — CSV or Excel (`.xlsx`) export from your bank.
3. **Map columns** — tell Ledger which column is the date, description,
   and amount (either a single signed amount column, or separate
   debit/credit columns). If your bank represents expenses as *positive*
   numbers, check the "flip sign" option. Save this mapping as a named
   **import profile** so future statements from the same account/bank
   import with one click.
4. **Review & confirm** — Ledger imports the rows, automatically:
   - classifies each row as an expense, a merchant credit (refund), or a
     transfer — credit-card payments and account-to-account transfers are
     detected automatically and excluded from your spending totals, while
     refunds net against what you spent in that category,
   - applies any matching categorization rules,
   - flags anything it isn't confident about for your review.

## 4. Categorizing transactions

Newly imported transactions that Ledger couldn't confidently categorize
show up with a **review badge** on the Transactions nav item.

- Open **Transactions**, filter to "Needs review" if you like, and set a
  category on each one. Every manual categorization is remembered as a
  rule — the same merchant will auto-categorize correctly on your next
  import.
- **AI fallback** (optional): in Settings, you can enable AI-assisted
  categorization, choose between **Claude** and **Gemini**, and provide
  your own API key for whichever you pick. When enabled, merchants that
  don't match any rule are sent to that provider for a suggested
  category. This is **off by default** — nothing leaves your machine
  unless you turn it on, and only merchant names are ever sent (never
  amounts, dates, or account details). Keys are stored in your OS
  keychain (Windows Credential Manager / macOS Keychain), never in your
  data file or backups, and each provider keeps its own key so switching
  back and forth doesn't make you re-enter anything.
- **Splitting a transaction**: open a transaction and turn on "Split."
  Add rows, each with its own category and amount — the amounts must add
  up to the transaction total before you can save. A split transaction
  shows each category's share in reports and analytics instead of one
  lump category.
- **Bulk actions**: select multiple transactions with the row checkboxes
  to bulk-categorize, tag, mark reviewed, or delete.
- Every transaction can also carry free-text **notes** and **tags**.

## 5. Categories & rules

**Categories & Rules** shows your category tree (categories with
subcategories nested underneath).

- **Add**: create a top-level category or a subcategory under an
  existing one; optionally mark it **tax-deductible** so it's pulled into
  the tax-summary export.
- **Edit**: rename or recolor a category, or toggle tax-deductible.
- **Merge**: fold one category into another — every transaction, split,
  and rule that referenced the old category is repointed to the target,
  and any of its subcategories move under the target too.
- **Delete**: shows an impact preview first (how many transactions,
  splits, and rules reference it) and lets you pick a replacement
  category for anything currently using it. Anything left unassigned
  falls back to **Other**, which is why "Other" itself can't be deleted
  or merged away.

## 6. Trends

Ledger has no budgets or savings targets — it compares your spending
against **its own history** instead. Pick a 6, 12, or 24-month window and
you get:

- **Average / median / highest / lowest month**, so you know what
  "normal" actually looks like for you. The average only counts months
  that had spending, so an empty stretch doesn't drag it down.
- **Monthly spend** as a line, with a 3-month rolling average over it to
  separate a real drift from one noisy month.
- **Spending more / Spending less** — the categories that moved most
  versus last month, with the before and after figures.
- **Category mix by month** and **total by category** for the window.
- **Unusual charges** — individual charges well above what that merchant
  normally costs you. A merchant needs at least three previous charges
  before it can be flagged, so a first-time merchant is never called
  unusual just for being new.

## 7. Subscriptions

Ledger looks at your transaction history for recurring, same-merchant,
similar-amount charges and lists them as detected subscriptions, so you
can spot ones you forgot about.

## 8. Analytics & Dashboard

**Dashboard** gives you an at-a-glance monthly view: what you spent and
across how many charges, how that compares with your recent average, the
category that moved most, a projection for the month, your category
breakdown, and what changed versus last month. **Analytics** goes deeper
— spend by month, merchant breakdowns, and a what-if simulator for
modelling a spending cut.

## 9. Reports & Export

Four report templates, all built from the same underlying data so numbers
always match what you see elsewhere in the app:

- **Monthly Summary** — one month: totals, category breakdown, top
  merchants, trend.
- **Annual / Year-in-Review** — a full calendar year with the
  month-by-month trend front and center.
- **Expense Breakdown** — a trailing window (1/3/6/12 months) with every
  category and subcategory, charted.
- **Custom Date Range** — pick any start/end date.

For each report you can toggle which sections are included, then:

- **Export as PDF** (desktop app only) or **Print** (works in browser
  mode too, via your browser's print-to-PDF).
- **Export a chart image** (e.g. the category pie chart) as PNG/SVG.
- **Filtered export**: build a custom transaction export (date range,
  account, category, tags) as CSV.
- **Tax export**: a CSV of everything in your tax-deductible categories
  for a given year, handed straight to your accountant or tax software.
- **Scheduled reports**: enable "auto-generate monthly summary" in
  Settings and choose a folder — Ledger will remind you (banner at the
  top of the app) once a new month has started and offer to generate that
  summary automatically.

## 10. Settings

- **Household name** and **accounts** (add/edit bank & credit card
  accounts — nickname, issuing bank, type, last 4 digits, color).
- **AI categorization** — enable/disable the API fallback, pick your
  model provider (Claude or Gemini), pick the **model** for it, and
  manage that provider's API key
  (desktop app only; stored in the OS keychain, shown masked once
  saved). Get a key from `console.anthropic.com` for Claude or
  `aistudio.google.com/apikey` for Gemini. If a call ever fails saying
  the model isn't available, the provider has retired that model id —
  type a current one into the **Model** field; no update needed.
  "Categorize unmatched
  merchants now" runs a one-off pass against the selected provider.
- **Database encryption** (desktop app only) — enable a passphrase to
  encrypt your database file whenever the app is closed. When enabled,
  launching the app shows a lock screen asking for your passphrase before
  your data loads. You can change the passphrase or turn encryption back
  off at any time from here.
  - **Important**: this protects your data file at rest between sessions
    (e.g. someone copying the file off a powered-down laptop). It does
    **not** protect a running app, and a crash or force-quit can leave
    that session's data unencrypted on disk until you close the app
    normally next time. Use a real disk-encryption tool (BitLocker,
    FileVault) if you need protection against a stolen/lost powered-on
    machine.
- **Backup & restore** — manually export your entire dataset to a JSON
  file, or restore from one. Useful before a big cleanup, or to move data
  to another machine.
- **Storage location** — shows where your database file lives on disk.

## 11. Data & privacy

- Everything is stored locally: SQLite database (desktop) or your
  browser's `localStorage` (browser mode). Nothing syncs to a server.
- Nothing is sent to any external service unless you explicitly enable
  AI categorization and supply your own API key — and even then, only
  merchant descriptions go to your chosen provider (Anthropic or
  Google), never amounts, dates, accounts, or your transaction history.
- Your database file is **not** tracked by git if you're working from
  source — it lives in your OS app-data folder, well outside the project
  folder.

## 12. Troubleshooting

- **"Needs review" badge won't go away** — you have transactions with no
  category, or a low-confidence auto-category. Open Transactions, filter
  to review items, and categorize them (or mark reviewed if the
  auto-category is actually correct).
- **Forgot your encryption passphrase** — there is no recovery path; the
  encryption key is derived entirely from the passphrase and nothing else
  is stored. Your only options are to restore from a JSON backup made
  before encryption was enabled, or to lose access to the encrypted file.
  Keep backups if you enable encryption.
  - The passphrase only protects the file at rest, so — as with any
    local password — writing it down somewhere safe (a password manager)
    is a reasonable tradeoff against permanent lockout.
- **Import mapped columns wrong** — reopen Import, adjust or delete the
  import profile, and re-import; a bad import batch can be identified and
  its transactions bulk-deleted from Transactions.
