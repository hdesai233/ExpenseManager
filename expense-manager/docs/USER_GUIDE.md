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
   - flags anything it isn't confident about for your review,
   - skips exact repeats of a transaction already in that account (same
     date, merchant, and amount) and marks them **DUPE**,
   - flags likely near-duplicates — same merchant and amount within a few
     days of another charge, either elsewhere in the file or already in
     that account — as **MAYBE DUP**. Unlike an exact duplicate, these
     still import normally; it's a nudge to double-check, not an
     auto-skip, since a same-amount purchase a few days apart is
     sometimes entirely legitimate.

## 3a. Adding a cash expense by hand

Not everything reaches a statement. **Add expense** in the top bar records
spending manually — cash, a split bill, an IOU — from any screen.

Fill in what it was for, the amount (as a positive number), and
optionally a category, date, tags, and notes. **Save & add another**
keeps the form open and holds onto the date, category, and account, so a
stack of receipts goes in quickly.

- **Paid with** defaults to **Cash**. The Cash account is created for you
  the first time you save one; after that it's a normal account you can
  rename in Settings. You can also attribute a manual expense to any
  other account.
- Hand-typed names are tidied the same way imported ones are, so a cash
  "starbucks" groups with your card's "SQ *STARBUCKS #4471" in merchant
  totals and trends.
- Manual expenses count toward spending exactly like imported charges,
  and arrive already categorized, so they never land in the review queue.

## 3b. Asking a question about your spending

Click **Ask** in the top bar to ask something in plain English instead of digging through
Transactions or Analytics — "how much did I spend on coffee last month?", "restaurant charges
over $50 in the last 90 days", "how many times did I use DoorDash this year?". Ledger turns the
question into a filter, then runs that filter against your transactions **entirely on this
device** — your question is sent to your AI provider to interpret, but the matching and the
results never are.

This reuses the same AI categorization key from Settings (desktop app only), so it needs that
turned on with a Claude or Gemini key added first. The answer shows a headline number (a total,
a count, or an average, depending on what you asked) plus the list of transactions behind it.

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
  back and forth doesn't make you re-enter anything. The same toggle and
  key also power **Ask** (§3b) — turning this on enables both.
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
  existing one.
- **Edit**: rename or recolor a category.
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
  versus last month, with the before-and-after dollar figures *and* what
  share of your total spend that category represented before and after
  (e.g. "22%→28% of spend"). The two can point different ways: a
  category's dollars can hold flat or even dip while its *share* rises,
  if everything else fell faster — that's not a contradiction, it's
  telling you something the dollar figure alone can't.
- **Category mix by month** and **total by category** for the window.
- **Spend distribution by category** — median trip size, typical range
  (25th–75th percentile), and a count of statistical outliers per
  category, for the same window as the rest of the page. A category
  total tells you "how much"; this tells you "what does a typical charge
  here actually look like, and which ones didn't." Click any row to see
  the specific outlier charges. Note this is a different question from
  "Unusual charges" below it — a category that mixes one big regular
  bill with several small ones (rent + utilities under Housing, say)
  will flag the big bill as a statistical outlier every month even
  though it's completely predictable, because "Unusual charges" compares
  a charge to *that merchant's own* history while this compares it to
  everything else in the category.
- **Spend by day of week** — your average spend per weekday, so patterns
  like weekend dining or Friday impulse buys show up even though a
  monthly view smooths them out. This is an *average per occurrence*,
  not a raw total, so an uneven number of, say, Fridays vs. Sundays in
  the window doesn't skew it.
- **Unusual category spend this month** — a category running well above
  its own 6-month median, not just above last month. This catches drift
  a single month-over-month comparison can miss, since one unusually
  cheap or expensive prior month can't swing a median the way it can
  swing a one-month comparison.
- **Unusual charges this month** — individual charges well above what
  that specific merchant normally costs you. A merchant needs at least
  three previous charges before it can be flagged, so a first-time
  merchant is never called unusual just for being new.

## 7. Subscriptions

Ledger looks at your transaction history for recurring, same-merchant,
similar-amount charges and lists them as detected subscriptions, so you
can spot ones you forgot about.

Detection is automatic and can occasionally flag something that isn't
really a subscription — a garage you park at every month, say. Click the
**×** on any row to remove it from the list. Dismissed merchants are
remembered, so they won't come back the next time detection runs; click
**"Show not-a-subscription list"** at the bottom of the screen to see
everything you've dismissed and **Restore** one if you change your mind.

Three stat tiles at the top summarize the current month: how much of your
spend is **fixed** (going to a recognized recurring merchant) vs.
**variable** (everything else), and how much is **due in the next 30
days**. A subscription whose charge amount recently stepped up or down —
a price increase, most often — shows a badge like "$15.49→$22.99" with
the date it changed. The **"Upcoming charges"** list below the table is
the same 30-day window itemized service-by-service, in date order.

## 8. Analytics & Dashboard

**Dashboard** gives you an at-a-glance monthly view: what you spent and
across how many charges, how that compares with your recent average, the
category that moved most, a projected month-end **range** (not a single
number — it separates known recurring bills still due from a statistical
projection of everything else, so the width of the range reflects real
uncertainty rather than false precision), your category breakdown
(click any category in the legend to drill into exactly which
transactions make up that slice, with its own CSV export), what
changed versus last month, and a **spend growth** line — the running
(cumulative) total for the month you're viewing, day by day, so you can
see the pace it built up at rather than just the final number. For the
current month it stops at today rather than continuing flat for days
that haven't happened yet. The transactions
list at the bottom toggles between **Recent** (most recent first) and
**Largest** (biggest expenses first, transfers and card payments
excluded) for whichever month you're viewing. **Analytics** goes deeper
— spend by month, a day-by-day breakdown of one month split by account
(navigate with the arrows next to the month label; click any bar to see
that day's transactions — click a specific account's colored segment to
filter to just that account, or the empty space around it for the whole
day), a **spend pace**
chart comparing that month's running total against the average of the
prior three months at the same point ("through day 18 you're $140 above
your typical pace" — an early warning, not just a month-end summary),
merchant breakdowns (with a ▲/▼ badge when a merchant's visit frequency
has shifted from its prior 3-month window), a **"merchants you've
stopped visiting"** panel (the mirror of that trend — a merchant with
real activity in the prior 3 months and none in the last 3, sorted by
how much it used to account for), and a what-if simulator for modelling
a spending cut.

Click any merchant name (in Top merchants or the stopped-visiting list)
to open its **detail view**: total spend, charge count, first/last seen,
typical basket size (median and 25th–75th percentile range), which
categories its spend maps to, and every underlying charge. Similar
merchant names that likely refer to the same place ("Coffee Bar" and
"Coffee Bar Downtown", say) are grouped together automatically — this
runs entirely on-device using string similarity, no AI involved — and
the detail view discloses exactly which raw names got merged under
"Also matched" so you can see what happened rather than just trusting it.

## 9. Reports & Export

Four report templates, all built from the same underlying data so numbers
always match what you see elsewhere in the app:

- **Monthly Summary** — one month: totals, category breakdown, top
  merchants, trend, **what changed vs. last month** (which categories
  moved, in dollars and as a share of that month's total spend, plus any
  merchants you stopped visiting), and **subscriptions & recurring**
  (your fixed/variable split, any subscription price changes detected
  that month, and what's due in the next 30 days). The last two only
  appear when the report covers a single calendar month — on Annual or a
  wide Custom range there's no one "last month" to compare against, so
  they show an explanation instead of a number.
- **Annual / Year-in-Review** — a full calendar year with the
  month-by-month trend front and center.
- **Expense Breakdown** — a trailing window (1/3/6/12 months) with every
  category and subcategory, charted.
- **Custom Date Range** — pick any start/end date.

For each report you can toggle which sections are included, then:

- **Drill down**: click any category (or subcategory) in "Spending by
  category" or "Expenses by category" to open a breakdown of exactly
  which transactions make up that number — filterable by subcategory,
  with its own CSV export.
- **Hover for exact values**: every point on "Monthly spend trend" (and
  the other trend charts throughout the app) shows the precise month and
  amount on hover — handy on Annual / Year-in-Review, where the line
  alone only gives you the shape. "Monthly spend trend" also prints each
  month's amount directly above its point, since hovering doesn't work
  once the report is on paper or in a PDF.
- **Export as PDF** (desktop app only) or **Print** (works in browser
  mode too, via your browser's print-to-PDF).
- **Export a chart image** (e.g. the category pie chart) as PNG/SVG.
- **Filtered export**: build a custom transaction export (date range,
  account, category, tags) as CSV.
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
- **Ask** (§3b) uses the same key and toggle. It sends your typed
  question plus your category and account *names* — never a merchant,
  amount, date, or any other transaction data. Matching the question
  against your actual transactions, and the results themselves, never
  leave your device.
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
