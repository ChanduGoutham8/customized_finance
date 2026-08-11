# Ledger — Complete Feature Specification

> Single source of truth for the **Ledger** app. Hand this to Claude Code (or any
> contributor) as the definitive description of what exists and how it must behave.
> If a change would contradict a rule here, update this file in the same commit.

**What it is:** a private, installable web app (PWA) with three independent layers:

1. **People / Loans (IOUs)** — money you have lent to or borrowed from other people.
2. **Wallet** — your own money: cash, bank accounts, and credit cards.
3. **Investments (Stocks)** — daily balance snapshots for brokerage platforms (e.g. Groww, Upstox), tracked as part of the Wallet layer.

The layers are **never merged into a single number**. Each is tracked and totalled on its own.

Alongside the three layers sits **Income & Spending** (§19) — not a fourth layer, but
a curated lens on top of Wallet and Loans: a per-transaction yes/no question that
decides whether a piece of money counts as real economic activity. Credit cards and
Investments never participate in it at all.

There is no standalone "just log it, no account needed" feature. Every transaction —
spending, receiving money, a transfer between your own accounts, lending, borrowing,
a repayment — goes through **Add Transaction** (§18) or the equivalent loan flow, and
requires a real account.

---

## Table of contents

1. [Core principles (non-negotiable rules)](#1-core-principles)
2. [Tech stack & architecture](#2-tech-stack--architecture)
3. [Design system](#3-design-system)
4. [Data model (Firestore)](#4-data-model-firestore)
5. [Navigation & routes](#5-navigation--routes)
6. [Authentication](#6-authentication)
7. [PIN app-lock](#7-pin-app-lock)
8. [People management](#8-people-management)
9. [Loan entries (lent / borrowed)](#9-loan-entries)
10. [Partial payments — record, edit, delete](#10-partial-payments)
11. [Loan detail, history & audit log](#11-loan-detail-history--audit-log)
12. [Dashboard (Home)](#12-dashboard-home)
13. [Wallet overview](#13-wallet-overview)
14. [Cash & bank accounts](#14-cash--bank-accounts)
15. [Account transaction ledger](#15-account-transaction-ledger)
16. [Credit cards](#16-credit-cards)
17. [Investments (Stocks)](#17-investments-stocks)
18. [Add Transaction](#18-add-transaction)
19. [Income & Spending](#19-income--spending)
20. [Reminders](#20-reminders)
21. [Trash & auto-purge](#21-trash--auto-purge)
22. [Archive](#22-archive)
23. [Reports & exports](#23-reports--exports)
24. [Backup & restore](#24-backup--restore)
25. [Settings](#25-settings)
26. [Theming](#26-theming)
27. [PWA & offline](#27-pwa--offline)
28. [Currency rules](#28-currency-rules)
29. [Edge cases & business rules](#29-edge-cases--business-rules)
30. [Known limitations / non-goals](#30-known-limitations--non-goals)
31. [Roadmap / open items](#31-roadmap--open-items)
32. [File map](#32-file-map)

---

## 1. Core principles

These are the rules the whole app is built around. Do not break them.

- **Currencies never mix.** EUR (€) and INR (₹) are always shown and totalled separately. There is never a single figure that adds euros and rupees together. No transfer or loan-linked account ever crosses currencies either — both sides must match; real cross-currency movement is handled by the user outside the app.
- **Accounts, people-loans, and investments stay separate.** No combined "net worth." Wallet totals, loan totals, and investment totals are shown in their own sections. Income & Spending (§19) is a lens on top of Wallet + Loans, not a fourth layer, and Credit Cards/Investments never participate in it.
- **Explicit, not inferred.** Every account-affecting action happens because the user picked an account and confirmed it — nothing is inferred from context or cascaded automatically. Loans explicitly ask which account when created or repaid (§9/§10); paying off a credit card is always two separate manual entries, one on the card and one on the bank account, never linked automatically. Editing or deleting a loan payment does **not** retroactively touch whatever account entry it originally created — that's a deliberate, accepted limitation (§29).
- **Data ownership.** All data lives in the user's own Firebase/Firestore project. There is no shared backend and no server the developer controls.
- **No build step.** Plain HTML/CSS/JS + Firebase from CDN. Editing a file and reloading is the entire dev loop.
- **Soft-delete first.** People, loan entries, accounts, and investment platforms go to Trash (recoverable) before being permanently removed after a retention window. Archive (§22) is the exception — records there are kept forever until explicitly, permanently deleted; nothing in Archive is ever auto-purged.

---

## 2. Tech stack & architecture

- **Frontend:** vanilla JavaScript (ES modules), single-page app, hash-based router. No framework, no bundler.
- **Backend:** Firebase (the user's own project):
  - **Auth** — email/password.
  - **Firestore** — all data, one document tree per user, with offline persistence (`persistentLocalCache` + multi-tab manager).
- **Firebase SDK:** v10 modular, imported from `https://www.gstatic.com/firebasejs/10.12.5/…`.
- **Lazy-loaded libraries (from cdnjs, only when exporting):**
  - SheetJS (`xlsx`) for Excel export.
  - jsPDF for PDF export.
- **Fonts:** Google Fonts — Space Grotesk (numbers/display), Inter (body).
- **Rendering model:** each view is a function returning an HTML string; the router writes it into `#root` and wires event listeners. State lives in a single in-memory object `S`, kept in sync by Firestore `onSnapshot` listeners; any snapshot change re-renders the current view. Click/input/change handling is delegated once to the persistent `#root`/`#sheet-root` containers (attaching per-render would stack duplicate listeners), dispatched via `data-action` attributes to a shared `actions` registry.
- **Derived totals are always calculated live, never cached.** Account balances, loan Paid/Remaining, and Net Income/Net Spending are all recomputed on demand from the current entries — never stored as a running counter that's incremented/decremented on write. This is deliberate: it makes an entire class of drift bug (a stored total getting out of sync after an edit or delete) impossible by construction.

---

## 3. Design system

**Identity:** ink-on-paper ledger. Brass accent. The signature is **money direction** — the colour and sign of a balance tell you instantly who owes whom.

**Colours (design tokens):**

| Token | Hex | Meaning |
|-------|-----|---------|
| `--brass` | `#C8901E` | primary accent |
| `--credit` | `#2F7D5B` | green — they owe you / money in / credit available / investment gain |
| `--debit` | `#C0533F` | red — you owe / money out / card debt / investment loss |
| `--settled` | `#8A8578` | gray — settled / zero |
| dark bg | `#12100E` | default background |
| light bg | `#FAF7F0` | light background |

- **Themes:** dark (default) and light, switched via `[data-theme]` on `<html>`.
- **Typography:** Space Grotesk for all numerals and headings (tabular figures), Inter for body text.
- **Components:** sticky top bar, 5-item bottom tab bar with badges, cards, list rows, credit-card tiles, bottom-sheet modals, a floating "Add" button (FAB), toasts (some with an Undo action), progress bars, pin pad, empty states, spinner.
- **Account-type accent colours:** cash = green tint, bank = blue tint, card = red tint.
- **The FAB's bottom clearance must always exceed its own full footprint** (position + height), not just some smaller padding value — this was a real bug (the button visually sat on top of content near the bottom of a page) caused by the content area's reserved space being smaller than the button actually occupies. Keep the numbers in sync if either changes.

---

## 4. Data model (Firestore)

All data is under `users/{uid}/`. Timestamps are stored as millisecond numbers (`Date.now()`) unless noted; `dueDate` and investment balance `date` are ISO date strings (`YYYY-MM-DD`).

```
users/{uid}/
  settings/app                     (single document)
    { theme, pinHash, defaultCurrency, purgeDays }

  people/{personId}
    { name, tags[], note, contact, createdAt, deletedAt }

    people/{personId}/txns/{txnId}
      {
        type: "lent" | "borrowed",
        currency: "EUR" | "INR",
        principal: number,
        description: string,
        createdAt: number,          // editable date-time
        dueDate: "YYYY-MM-DD" | null,
        status: "open" | "settled",
        accountId: string | null,   // which account the loan moved through when
                                     // created (§9/§18) — null on loans created
                                     // before this existed
        payments: [ { id, amount, at, note } ],
        history:  [ { at, text } ],  // audit log — see §11 for how it's displayed
        deletedAt: number | null,
        uid: string                 // == the owning user's uid; see note below
      }

  accounts/{accountId}
    {
      kind: "cash" | "bank" | "card",
      name: string,
      bank: string,                 // issuer / bank name (blank for cash)
      currency: "EUR" | "INR",
      opening: number,              // opening balance (cash/bank) OR starting outstanding (card)
      limit: number | null,         // card only
      dueDay: number | null,        // card only, 1–28
      statementDay: number | null,  // card only, reserved (not yet surfaced in UI)
      note: string,
      createdAt: number,
      deletedAt: number | null
    }

    accounts/{accountId}/entries/{entryId}
      {
        type: "deposit" | "expense"   // cash & bank
             | "charge"  | "payment", // card
        amount: number,
        description: string,
        category: string,             // cash/bank only; from a preset list, see §15
        at: number,                   // editable date-time
        createdAt: number,
        countedInIncomeSpending: boolean | undefined,  // §19 — the user's yes/no
                                       // answer; absent entirely for card entries
                                       // and Subscriptions-tagged entries, which
                                       // are never asked
        uid: string                   // == the owning user's uid; see note below
      }

  investments/{investmentId}
    {
      name: string,                  // e.g. "Groww", "Upstox", or any platform
      currency: "EUR" | "INR",
      note: string,
      createdAt: number,
      deletedAt: number | null
    }

    investments/{investmentId}/balances/{balanceId}
      {
        date: "YYYY-MM-DD",          // one snapshot per day (re-saving the same date updates it)
        amount: number,              // account value as of that date
        createdAt: number,
        uid: string                  // == the owning user's uid; see note below
      }

  archive/{archiveId}
    {
      kind: string,                  // what was archived, e.g. "note"
      data: object,                  // the original record's fields, preserved as-is
      reason: string,                // why it was archived, e.g. "Notes feature removed"
      archivedAt: number
    }
```

**No `notes/{noteId}` collection anymore.** The standalone Notes feature was removed
entirely — see §18. Any leftover documents from before removal are migrated into
`archive/` on first load after upgrade and the originals deleted (§22); the `notes`
collection should be empty for every account going forward.

**Why `txns`/`entries`/`balances` carry a `uid` field, but `archive` doesn't:** the app
syncs `txns`, `entries`, and `balances` with a single `collectionGroup` listener each
(all loan entries across every person, in one query, etc.) rather than one listener
per parent. Firestore can't authorize a collection-group *query* using a path-based
rule — the query isn't scoped by parent path, so the rule can't prove every possible
match belongs to the requesting user. Storing the owner's uid directly on the
document, writing a rule that checks `resource.data.uid`, **and** adding a matching
`where("uid", "==", uid)` clause to the client query itself is the standard way
around that (see the two-rule setup below). `archive` (like `people`, `accounts`,
`investments`) is a plain top-level collection under `users/{uid}/`, synced with a
normal per-parent listener, so it's already covered by the path-based rule alone —
no `uid` field or collection-group index needed.

**Firestore security rules** (locks every user to their own tree — covers all of the above via the wildcard; see `firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /{path=**}/txns/{txnId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }
    match /{path=**}/entries/{entryId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }
    match /{path=**}/balances/{balanceId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }
  }
}
```

---

## 5. Navigation & routes

Hash-based router. Bottom tab bar shows 5 destinations: **Home, People, Wallet, Reports, Settings**. (Trash and Archive are reached from Settings, not the tab bar. Investments are reached from Wallet, not the tab bar.)

| Route | View | In tab bar? |
|-------|------|-------------|
| `#/` | Dashboard / Home | ✔ |
| `#/people` | People list | ✔ |
| `#/person/{pid}` | Person detail | back button |
| `#/txn/{pid}/{tid}` | Loan (transaction) detail | back button |
| `#/wallet` | Wallet overview | ✔ |
| `#/account/{aid}` | Account detail | back button |
| `#/investment/{iid}` | Investment platform detail | back button |
| `#/reports` | Reports & exports | ✔ |
| `#/trash` | Trash | back button (opened from Settings) |
| `#/archive` | Archive | back button (opened from Settings) |
| `#/settings` | Settings | ✔ |

**Tab badges:**
- Home: number of overdue loan entries.
- Wallet: number of credit cards with a repayment due within 5 days.

**FAB "Add" (on Home)** opens a quick-add chooser: Add transaction · New person · New account/card · New investment platform · Loan entry for {an existing person}.
**FAB "Add" (on Wallet)** opens a chooser scoped to Wallet: cash account · bank account · credit card · investment platform.
**Home also has a standalone "+ Add transaction" button** in the page body (not just inside the FAB chooser), since it's the single most common action.

---

## 6. Authentication

- Firebase **email/password**.
- Screens: **Sign in**, **Create account**, **Forgot password** (sends reset email).
- Switch between sign-in and sign-up inline.
- Friendly, specific error messages (wrong password, email in use, weak password, network error, etc.).
- The same login on any device shows the same data (cross-device sync).
- Signing out returns to the login screen and tears down all listeners.

---

## 7. PIN app-lock

- **Optional** 4-digit PIN, set in Settings.
- Stored as a **SHA-256 hash** in `settings/app.pinHash` (never plain text).
- When enabled, a lock screen with a pin pad appears **after login, before the app**.
- Unlock lasts for the session; the app re-locks on reload.
- Setting a PIN requires entering it, then confirming it.
- Turning it off asks for confirmation.
- It is a convenience lock on top of the account password, not a replacement.

---

## 8. People management

- **Add person:** name (required), contact (optional — phone/email), tags (multi-select from **Family, Friends, Work, Neighbour**), note (optional).
- **Edit person:** all of the above.
- **Delete:** soft-delete to Trash, with an **Undo** toast.
- **Restore** from Trash; **auto-purge** after the retention window.
- **Search** people by name (live).
- **Filter** by tag.
- **Sort** by: balance (largest absolute net first), A–Z (name), Newest (creation date).
- **Avatar:** initials derived from the name.
- **Colour coding** on each row: green (net = they owe you), red (net = you owe), gray (settled/zero).
- **Row content:** name, one tag, a direction dot + label ("owes you" / "you owe" / "settled"), the **primary balance** (the currency with the largest absolute net), and a `+N ccy` hint when the person has balances in more than one currency.

---

## 9. Loan entries

Each loan entry ("txn") belongs to a person.

- **Type:** `lent` (they owe you) or `borrowed` (you owe them), chosen with a two-option toggle.
- **Currency:** EUR or INR, per entry.
- **Amount (principal):** required, > 0.
- **Description:** optional.
- **Date & time:** defaults to now, **editable**.
- **Due date:** optional.
- **Status:** `open` or `settled`.
- **Create** via the person detail screen ("I lent" / "I borrowed" buttons) or via quick-add.
- Green/red styling follows the type.

**Creating a loan asks which account the money moved through.** Only accounts whose
currency matches the loan's chosen currency are selectable; if none exist, the form
shows a message telling the user to add one first rather than a broken empty picker.
Lending decreases that account's balance (money left you); borrowing increases it
(money arrived). This creates a normal entry on that account, subject to the same
Income & Spending question as anything else (§19) — lending isn't spending and being
lent to isn't income, but the app doesn't enforce that; it's the user's own answer
each time. Editing an existing loan does **not** re-ask for an account — only the
original creation is tied to one.

---

## 10. Partial payments

Repayments are recorded against a single loan entry.

- A **slider** from 0 to the remaining amount, with a live amount label.
- **"Pay full"** opens the same payment sheet as "Record payment," pre-filled to the full remaining amount (it no longer records instantly — an account is required now, see below).
- **Record payment** sheet: amount (capped at remaining in the slider) + **which account** (required, filtered to the loan's currency) + optional note.
- Each payment is appended to `payments[]` as `{ id, amount, at, note }`.
- **Remaining** = `principal − sum(payments)`.
- **Auto-settle:** when a payment brings remaining to `≤ 0`, the entry is marked `settled` automatically.
- **Overpayment:** if remaining goes below 0, the detail screen shows **"Overpaid by X"**.
- A **progress bar** shows `paid / principal`.
- **Recording a payment also asks the Income & Spending question (§19)** for the account entry it creates: being repaid on a loan you gave brings money to you (an income-direction entry); paying someone back on a loan you took sends money out (a spending-direction entry). The account's real balance always updates regardless of the answer.

### Editing and deleting an individual payment

- Any payment already recorded can be **edited** (the confirmed, built case is
  correcting the **amount** — e.g. a typo'd €50 fixed to €40) or **deleted** entirely.
- Both **always apply immediately** — Paid, Remaining, and status (open/settled)
  recalculate right away. If deleting or shrinking a payment brings Remaining back
  above zero on a Settled loan, the loan **automatically reopens**; conversely, an
  edit that brings Remaining to zero or below auto-settles it, same as recording a
  new payment would.
- After the edit/delete applies, a prompt asks **"Save a note about this change?"** —
  free text, entirely optional. Answering with a note adds a line to the loan's
  History explaining what changed and why (in the user's own words); skipping adds
  nothing. **The prompt never blocks or reverses the edit/delete itself** — it only
  controls whether a note gets attached.
- **Known, accepted limitation:** editing or deleting a payment does **not**
  automatically adjust whatever account entry that payment originally created
  (§9's "which account" step). This was raised as a gap and explicitly declined —
  the user relies on careful data entry instead of automatic syncing here.

---

## 11. Loan detail, history & audit log

- **Header:** remaining amount (coloured by direction), "paid X of Y", description, start date-time, due date.
- **Payment slider** (shown while open and remaining > 0).
- **Mark settled / Reopen** toggle.
- **History timeline** (newest first) merges three sources into one list: the original "Started" line, every payment (each with its own Edit/Delete icons, §10), and the audit log (`history[]`) — settle/reopen events, loan edits, and payment edit/delete notes. "Created" and "Payment recorded" log lines are filtered out of the merged view since they'd just duplicate the Started/Payment lines already shown.
- **Audit log:** `history[]` records every creation, edit, settle/reopen, and (optionally, per user choice) payment edit/delete, each with a timestamp. **Loan edits keep the old values** by describing the change (e.g. "amount €50 → €60").
- **Edit entry:** description, principal, currency, due date. Every edit is written to the audit log. (This does not re-ask for an account — see §9.)
- **Move entry to Trash** (with Undo).
- **Per-person statement PDF** export (from the person detail screen).

---

## 12. Dashboard (Home)

- **Owed to you** — totals per currency.
- **You owe** — totals per currency.
- **Net position** — per currency, coloured; shows "All settled" when zero. Explicit note that currencies are never added together.
- **Needs attention** (up to 6): overdue entries, then stale ones (open, remaining > 0, no activity for 30+ days). Each row taps through to the loan.
- **Top balances:** the 5 people with the largest absolute net.
- **"Your money" strip:** a compact, clearly-separate card showing cash+bank on hand per currency and a "N card repayments due soon" note, linking to Wallet. It **does not** merge wallet and loan figures.
- **"Income & spending" card:** Net Income and Net Spending, per currency, computed live (§19). A short note clarifies these are all-time totals and that credit cards, investments, and subscription-tagged entries are never included, regardless of any answer.
- **FAB** quick-add, plus a standalone "+ Add transaction" button in the page body.
- Empty state prompts adding the first person.

---

## 13. Wallet overview

The Wallet tab is the home of the user's own money: cash, bank, cards, and investments.

- **Money on hand:** cash + bank balances, per currency (kept separate).
- **Card debt** and **Available credit:** per currency, shown when any cards exist.
- **Repayments due:** cards with outstanding balances, sorted by soonest due date, each showing amount and due date; flagged when within 5 days.
- **Groups:** Cash accounts, Bank accounts (as rows with balances), Credit cards (as tiles), and Investments (as rows with latest balance + latest change).
- **Add** FAB scoped to Wallet (cash/bank/card/investment).
- Empty state prompts adding the first account.

---

## 14. Cash & bank accounts

- **Kinds:** `cash` and `bank`.
- **Fields:** name, bank/issuer (bank only — hidden for cash), currency (EUR/INR), opening/current balance.
- Add, edit, and **move to Trash**. Only active (non-trashed) accounts are ever selectable anywhere an account picker appears (Add Transaction, loan creation, payment recording) — a trashed account simply isn't in the list, which doubles as a signal that something needs restoring first if it was trashed by mistake.
- **Balance** = `opening + Σ(deposits) − Σ(expenses)`, coloured green when ≥ 0, red when negative. **Negative balances are allowed, not blocked** — this is a self-maintained ledger, not a live bank connection that can decline a transaction for insufficient funds.
- Full transaction ledger (see next section).

---

## 15. Account transaction ledger

Every cash/bank account keeps a full ledger (this is the chosen model — not just a running number).

- **Money in (deposit)** and **money out (expense)**.
- Each entry: amount, description, **category** (from: Groceries, Rent, Bills, Transport, Eating out, Shopping, Salary, Transfer, Health, **Subscriptions**, Other), date-time (defaults to now, editable).
- Entries listed newest-first, each showing a signed coloured amount (+green in / −red out) and the **running balance** at that point.
- **Delete** an individual entry (permanent, with confirmation — entries are not soft-deleted).
- **Every eligible entry prompts an Income & Spending yes/no question when saved** (§19). Entries tagged category **Subscriptions** are the one category-based exception — they're automatically excluded, no popup shown at all.
- Entries can be created two ways — directly from an account's own page ("Money in" / "Money out" buttons), or via **Add Transaction** (§18) from anywhere in the app — both funnel through the same save path and behave identically.

---

## 16. Credit cards

- **Kind:** `card`.
- **Fields:** name, issuer, currency, **credit limit**, **current outstanding** (optional at creation), **repayment due day** of the month (1–28).
- **Charge/payment ledger:** charges increase outstanding, payments reduce it.
- **Outstanding** = `opening + Σ(charges) − Σ(payments)`.
- **Available credit** = `limit − outstanding`.
- **Usage bar** = `outstanding / limit`.
- **Next repayment date:** computed from the due day; if this month's day has passed, it rolls to next month. The due day is clamped to the month's length.
- **Days left** until the next due date is shown; **within 5 days is highlighted** as "soon".
- Card **tile** shows: name, issuer, currency, usage bar, outstanding / available / limit, and the repayment line.
- `statementDay` exists in the data model but is **not yet surfaced** in the UI (reserved for a future statement-vs-due distinction).
- **Card entries never participate in Income & Spending (§19).** Neither a Charge nor a Payment ever shows the yes/no popup, and neither is ever counted toward Net Income/Net Spending — the whole feature is kept out of the card section entirely, regardless of category. Paying off a card bill is always two separate entries (a Payment on the card, and a separate Money-out entry on whichever bank/cash account actually paid it, since accounts aren't auto-linked) — the bank-side entry *does* go through the normal Income & Spending question, same as any other Wallet entry; answering "No" there is what avoids double-counting the same real expense (the charge itself already counted, if the user chose to include it).

---

## 17. Investments (Stocks)

Tracks brokerage platforms — e.g. **Groww**, **Upstox**, or any others the user adds — as part of the Wallet layer. Unlike accounts, an investment platform has no deposit/withdrawal ledger: the user simply logs what the account is worth today, on any day they check it. Investments have their own separate "enter today's balance" flow entirely — they never go through Add Transaction (§18) and never participate in Income & Spending (§19) in any way, not even as an exclusion that needs checking for; the two systems just never meet.

- **Add a platform:** name (free text, with Groww/Upstox suggested), currency, note. Add, edit, and **move to Trash**.
- **Enter today's balance:** a single number — what the platform shows as the total value right now. One snapshot per calendar date; entering a balance again for a date that already has one **updates** it rather than creating a duplicate.
- **Profit/loss** for a snapshot = **that day's balance − the immediately preceding recorded balance** (not the same calendar day necessarily — the previous *entry*, whatever date it was logged on). Positive = profit (green), negative = loss (red). The very first entry for a platform has no P/L yet (nothing to compare against).
- **Platform detail screen:** current balance, latest change, cumulative change since the first recorded entry, and a full history list (newest first) with each entry's date, balance, and the change vs. the entry before it. Any entry can be deleted.
- **Wallet overview** shows an Investments section: each platform's latest balance and latest change, plus aggregate **Value** and **Latest change** totals per currency across all platforms.
- Investments are **never combined** with cash/bank/card totals, with loan balances, or with Income & Spending (§19) — they get their own figures, per currency, like everything else in this app.

---

## 18. Add Transaction

The single entry point for logging money moving through a real account. There is no
free-floating record anywhere in the app — the old standalone Notes feature (a note
+ amount + currency with no account attached) has been removed entirely: no page, no
data model, no "log it without an account" option. Anything that used to be a Note is
now a normal transaction against a real account.

**The flow, reachable via the FAB from anywhere, or the standalone button on Home:**

1. **Account** (required) — only active, non-trashed accounts are selectable.
2. **Direction** — Money in / Money out for cash and bank accounts; Charge / Payment for credit cards, matching how cards already work (§16). Changing the selected account live-updates which direction options and fields show (e.g. picking a card hides the category field, since cards don't use one).
3. **Amount.**
4. **Description** (optional free text — "Sent to father," "Netflix" — exactly like a bank app's note-when-sending-money field). This is the only place that describes *what* a transaction is; there's no separate note feature. (Editing/deleting a loan payment has its own, narrower optional note — §10 — which explains *why* a correction was made, a different purpose from Description.)
5. **Category** (cash/bank only — see §15's list, including Subscriptions).
6. **Date & time.**
7. For cash/bank accounts, saving then asks the Income & Spending question (§19), unless the entry is tagged Subscriptions, in which case it's skipped automatically. Card entries never ask it at all (§16).

**This is not the only way a Wallet entry gets created** — loan-linked entries (§9,
§10) have their own separate entry point, the loan/payment forms, which independently
ask for an account. Both paths produce the same kind of entry underneath and are
subject to the same Income & Spending rules.

---

## 19. Income & Spending

A per-transaction yes/no question, not a category-based rule. This is the part most
likely to be implemented wrong if summarized loosely, so it's stated precisely:

**Where it applies:** every eligible Wallet transaction created via Add Transaction
(§18) — spending, receiving money, a transfer between the user's own accounts — and
every loan-linked entry (§9, §10) — lending, borrowing, and repayment, all three.

**Where it never applies — no popup shown, the entry is simply never eligible. Three categories:**
1. **Credit card Charge/Payment entries** (§16) — go through Add Transaction, but are excluded from this feature entirely.
2. **Entries tagged category "Subscriptions"** (§15) — logged the normal way, still reduce the account's real balance, but are automatically excluded, no popup asked.
3. **Investment balance entries** (§17) — not excluded so much as structurally unrelated; Investments never go through Add Transaction in the first place.

**The mechanism, exactly:** when an entry is eligible, saving it shows one question:
- Money out → *"Include this in Spending?"* (Yes/No)
- Money in → *"Include this in Income?"* (Yes/No)

The answer is stored on the entry as `countedInIncomeSpending: true | false` (§4). It
controls **only** whether the entry is included when Net Income/Net Spending are
calculated — it has **zero** effect on whether the account's real balance changes,
which always happens unconditionally regardless of the answer. There is no automatic
rule based on category or description — a transfer between the user's own accounts,
or lending/repaying money, is not auto-excluded; the user decides each time, though
in practice those are usually answered "No" since they're not real economic activity.

**Net Income and Net Spending are always calculated live** (§2) — a fresh sum of
every currently-eligible entry currently marked "yes," per currency, recomputed on
every render. Never a stored running total. Editing or deleting an entry, or changing
its yes/no answer after the fact, just naturally changes what the next computation
sums — nothing separate to keep in sync.

**Net Amount is always exact by construction** (a direct sum of account balances,
unaffected by any popup answer) — Net Income and Net Spending are a *curated* view on
top of it and will not always arithmetically reconstruct the change in Net Amount
when transfers or loans are involved (some money that really moved is deliberately
excluded from the curated totals). Both figures are individually correct; they're not
meant to explain each other.

Displayed on the Home dashboard (§12) as the "Income & spending" card.

---

## 20. Reminders

All reminders are **in-app** (there are no push notifications — that would need a backend, which the app deliberately avoids).

- **Loan overdue:** an open entry with remaining > 0 whose due date has passed.
- **Loan stale:** an open entry with remaining > 0 and no activity for 30+ days.
- **Card repayment due:** countdown to the next due date; "due soon" when within 5 days.
- Surfaced on the Home "Needs attention" list, the Wallet "Repayments due" list, and as tab-bar badges.

---

## 21. Trash & auto-purge

- Holds soft-deleted **people, loan entries, accounts, and investment platforms**.
- Each item shows a **days-remaining countdown** (`retention − days since deletion`).
- **Restore** an item, or **permanently delete** it.
- **Empty trash now** permanently deletes everything in Trash (with confirmation).
- **Auto-purge:** on app boot (a few seconds after load), any item older than the retention window is permanently removed. Purging a person/account/investment platform also deletes its sub-entries (txns / entries / balances respectively).
- **Retention window** is configurable in Settings (default 30 days).
- Reached from **Settings** (shows a count).
- **Not the same as Archive (§22):** Trash is for recently-deleted things you might still want back, and it auto-expires. Archive is for deliberately retired records you want to keep forever.

---

## 22. Archive

A place for records that are permanently retired but shouldn't be destroyed — kept
forever, never auto-purged, only removed by an explicit, manual "permanently delete"
performed inside Archive itself. General mechanism, not a one-off: any future retired
feature's leftover data goes here the same way.

| | Trash (§21) | Archive |
|---|---|---|
| Purpose | Recently deleted, might want it back | Deliberately retired, kept forever |
| Auto-purge | Yes, after the retention window (default 30 days) | Never |
| How it's removed | Restore, or the retention window elapses | Only an explicit, manual "permanently delete" from inside Archive |
| Reached from | Settings (shows a count) | Settings (shows a count), next to Trash |

**Migration on upgrade:** the old standalone Notes feature (§18) used to store
records in a `notes` collection. On first load after the feature was removed, any
documents still sitting in `notes` are automatically wrapped into an Archive record
(`kind: "note"`, original fields preserved under `data`, `reason: "Notes feature removed"`)
and the original document deleted. This check runs once per session (idempotent —
finds nothing on subsequent runs once the `notes` collection is empty) and is not
tied to any specific account; it applies to whichever account is currently signed in.

Each Archive row shows a short summary (for a migrated note: the note text and
amount), the reason it was archived, when it was archived, and — where available —
when the original record was created. No restore-to-active flow; Archive is
read-only aside from permanent deletion.

---

## 23. Reports & exports

- **Per-currency summary:** owed to you, you owe, and net — one block per currency.
- **Export CSV** — loan transactions, opens in any spreadsheet.
- **Export Excel (.xlsx)** — loan transactions (SheetJS, lazy-loaded).
- **Export full report (PDF)** — all people and balances (jsPDF, lazy-loaded).
- **Per-person statement (PDF)** — from the person detail screen.
- Excel/PDF need an internet connection the first time (they fetch a library from a CDN). CSV works fully offline.
- **Current scope:** exports cover **loans only**. Account/card spending, investment history, and Income/Spending totals are not yet exportable (see roadmap).

---

## 24. Backup & restore

- **Back up all data:** downloads a JSON file (`version: 4`) containing settings, all people (with their loan entries), all accounts (with their entries), and all investment platforms (with their balance history). Notes are no longer part of the backup format — the feature was removed (§18); Archive records aren't included either.
- **Restore from backup:** imports a JSON file and **adds** its people, accounts, and investment platforms to the current data (existing data is kept, not overwritten). Confirms the counts before importing.
- **Older backup files (version 3 and earlier) may still contain a `notes` array** from before the feature was removed — restoring one of these silently ignores that part of the file rather than erroring or attempting to recreate the removed feature's data. Everything else in an old file still restores normally.
- Works fully offline.

---

## 25. Settings

- **Appearance:** dark-theme toggle.
- **Security:** app-lock (PIN) toggle → set/confirm/turn-off flows.
- **Defaults:**
  - Default currency (EUR/INR) used when adding new entries, accounts, and investment platforms.
  - Trash retention (7 / 14 / 30 / 60 / 90 days).
- **Data:** Trash (with count) · Archive (with count) · Back up all data · Restore from backup.
- **Sign out.**
- Shows the signed-in account email.

---

## 26. Theming

- **Dark** (default) and **light** themes.
- Persisted to `settings/app.theme` (syncs across devices) and cached in `localStorage` so the correct theme paints instantly on load, before Firestore responds.

---

## 27. PWA & offline

- **Installable** via `manifest.webmanifest` (standalone display, 192/512/maskable icons, theme colour, start URL).
- **Service worker** (`sw.js`): caches the app shell **cache-first**; ignores Firebase/Google origins so the SDK manages its own network.
- **Offline:** the app shell loads offline; Firestore offline persistence keeps data available and queues writes.
- Apple touch icon and iOS web-app meta tags included.
- **Release rule:** whenever any app file changes, **bump the `CACHE` version string in `sw.js`** or installed users keep the old cached files. During active local development, registering a service worker at all makes iterating on `js/app.js` unreliable (the browser can keep serving a stale cached copy through several reloads) — if that happens, prefer temporarily commenting out the `navigator.serviceWorker.register(...)` call in `js/app.js` over fighting the cache, and always restore it (plus bump `CACHE`) before considering a change finished.

---

## 28. Currency rules

- Supported: **EUR (€)** formatted `en-IE`, **INR (₹)** formatted `en-IN`.
- **Never** summed across currencies — anywhere, including investments and Income & Spending totals.
- Every total (people net, wallet on-hand, card debt, available credit, investment value/P&L, Net Income/Spending, reports) is computed and displayed **per currency**.
- A person's **primary balance** (shown on list rows) is the currency with the largest absolute net; a `+N ccy` hint signals additional currencies.
- **No cross-currency transfers or loans anywhere.** A transfer between the user's own accounts, or the account linked to a loan, must match currencies on both sides — there's no two-amount entry, no implied exchange rate, no conversion modeled anywhere in the app. Real EUR↔INR movement is handled by the user outside the app. This was raised and deliberately declined, not an oversight.
- Adding a new currency should be a matter of extending the currency table and its formatting locale.

---

## 29. Edge cases & business rules

- Payments are capped at the remaining amount in the slider; typing more still records and simply auto-settles (overpayment surfaced on the loan detail).
- A loan auto-settles when remaining ≤ 0; it can be reopened — automatically (editing/deleting a payment, or recording one that changes the remaining amount) or manually (the Mark settled / Reopen toggle).
- Settled and trashed loans are **excluded** from all balance/net calculations.
- A person can hold balances in both currencies at once; they are reported separately and never combined.
- Card due dates roll forward monthly and clamp to the month length (e.g. day 31 → last day of a short month).
- **Soft-delete vs hard-delete:** people, loan entries, accounts, and investment platforms are soft-deleted to Trash; **account ledger entries and investment balance entries are hard-deleted** immediately (with confirmation). Archive records are also hard-deleted on request, but never automatically.
- **Individual loan payments can be edited (amount) and deleted** (§10) — the edit/delete always applies; an optional note about *why* is a separate, non-blocking prompt.
- **Editing or deleting a payment does not sync back to its linked account entry.** If a €50 repayment (which created a real account entry) is corrected to €40, the account entry itself is untouched — a deliberate, accepted limitation, not a bug to fix later.
- **A loan's linked account must match the loan's currency** — a EUR loan can only be linked to a EUR account, same for INR. No cross-currency modeling (§28).
- **Paying off a credit card is always two separate entries** — a Payment on the card and a Money-out entry on the bank/cash account that actually paid it — since accounts are never auto-linked (§16). Answering "No" to Income & Spending on the bank-side entry is what prevents the same real expense being counted twice.
- An investment platform's profit/loss is always computed against the **previous recorded entry**, not a fixed calendar interval — if you skip a week, that week's movement all lands on the next entry you log.

---

## 30. Known limitations / non-goals

- **No push notifications.** Reminders are in-app only; real notifications would require a backend, which the app avoids by design.
- **No *automatic* linking between loans, account balances, and investment balances.** Loans do explicitly ask for and update a real account (§9/§10/§18) — but only when the user creates or repays one, always as a manual, confirmed choice, never inferred or cascaded afterward. Investment balances remain fully manual with no link to any account at all.
- **No merged net worth** across accounts, loans, and investments (explicit product decision).
- **No cross-currency transfers or loans** (§28) — explicit product decision, not a gap.
- **No multi-user / sharing.** Data is single-owner, per Firebase account.
- **Exports are loans-only** for now; Income & Spending totals aren't exportable yet either.
- **Currencies limited** to EUR and INR (extensible).
- **No brokerage integration.** Investment balances are entered by hand — there's no live price feed or API connection to Groww/Upstox/any broker.
- **Editing/deleting a loan payment doesn't sync its linked account entry** (§10, §29) — accepted, not planned to change.

---

## 31. Roadmap / open items

Tracked so they don't get lost:

1. **Spending export** — include account/card transactions, investment history, and Income/Spending totals in CSV and Excel (e.g. separate sheets), and optionally a spending PDF.
2. **More currencies** beyond EUR/INR.
3. **Card statement date** — surface `statementDay` (statement vs. payment-due distinction).
4. Optional per-account / per-investment export or statement (like the per-person loan statement).
5. **Investment charts** — a simple line/area chart of balance over time per platform.
6. **A global activity log** spanning People/Wallet/Investments in one feed, instead of Home's separate capped mini-lists.
7. **Charts:** spending by category, net worth over time (Wallet + Investments).
8. **A date-range filter** (monthly/yearly) for Reports and the Home dashboard — Income/Spending and everything else is currently all-time only.
9. **Budgets / spending limits** per category, with an over-budget warning.
10. **Attachments or receipt photos** on Wallet entries and loan payments.
11. **Richer, custom reminders** beyond the built-in overdue/stale/card-due-soon alerts.

When picking one up: branch `feature/<name>`, implement, update this file if behaviour changes, commit with a `feat:`/`fix:` message, and bump `sw.js` `CACHE`.

---

## 32. File map

```
index.html             app shell + PWA meta
css/styles.css         design system (dark + light), all components
js/config.js           Firebase keys (web keys are public; safe to commit)
js/app.js              the entire application
manifest.webmanifest   PWA manifest
sw.js                  service worker (offline shell) — bump CACHE on release
firestore.rules        Firestore security rules (see section 4)
icons/                 192 / 512 / maskable-512 PNGs
README.md              setup, security rules, deploy
CONTRIBUTING.md        branch & commit conventions, local run, release steps
FEATURES.md            this document
PHASE_PLAN.md          working notes from the Notes-removal/Income-Spending build —
                        the "why" behind decisions in this document, with worked examples
FINAL_SPEC.md          the standalone build spec that PHASE_PLAN.md's decisions were
                        distilled into before implementation — kept as a historical
                        record; this file (FEATURES.md) is the current source of truth
```
