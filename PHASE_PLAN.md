# Ledger — Next Phase Plan

> Planning document only. Nothing described here is built yet. Once a phase is
> implemented, its behavior should be folded into FEATURES.md (the source of
> truth for what the live app actually does) and this checklist item marked
> done. This file is the "why and how we agreed to build it" record; FEATURES.md
> stays the "what the app does" record.

## Starting state used in every worked example below

So the numbers connect across phases like one continuous story instead of
isolated snippets:

| Account | Currency | Kind | Opening balance |
|---|---|---|---|
| SBI | INR | Bank | ₹10,000 |
| Deutsche Bank | EUR | Bank | €500 |

A cash account ("Wallet Cash") and a credit card ("HDFC Card") get introduced
partway through, exactly where they naturally come up.

---

## Phase 1 — Loan payments: edit and delete individually

**Problem today:** once a payment is recorded against a loan, it's permanent.
Fixing a typo or removing a duplicate means trashing the entire loan and
re-entering everything, including the payments that were correct.

**Setup:** Sripal owes you €100 (a "lent" loan). Aug 1 you record a €50
payment → Paid €50, Remaining €50, status Open.

**1a. Edit a payment** — you meant €40, not €50.
- Open the payment in the loan's History, change €50 → €40, save.
- Remaining recalculates: €100 − €40 = **€60**.
- App asks *"Save a note about this edit?"* — optional, your own words (e.g.
  "Typo, corrected from 50"). If you say no, the number still changes, but
  nothing is written to History. The prompt never blocks the edit itself —
  it only controls whether a note gets attached.

**1b. Delete a payment** — you accidentally logged €50 twice (Aug 1 and Aug
3), so Paid = €100, Remaining = €0, and the loan auto-settled.
- Delete the Aug 3 duplicate.
- Paid drops to €50, Remaining reopens to **€50**, status flips back to Open
  automatically — a loan can't stay "Settled" once money is owed again.
- Same optional note prompt as 1a.

**Edge cases:**
- Editing a payment *up* past what's owed can create an overpayment — same
  "Overpaid by X" banner that already exists, no new logic needed there.
- Deleting the only payment on a settled loan reopens it to the full
  original principal.
- Every edit/delete is reflected in Paid/Remaining/status immediately and
  automatically; the optional note is purely a record of *why*, never the
  mechanism that makes the numbers correct.

---

## Phase 2 — Recurring subscriptions: **no separate feature needed**

Originally scoped as an automated engine (saved rules, scheduled
confirmations). Descoped: subscriptions are just regular expense entries,
logged by hand whenever they happen, using the same Add Transaction flow as
everything else (Phase 4). Netflix at €15/month means typing "Netflix, €15"
into the normal spending flow once a month — no rule to configure, no
confirmation prompts to manage, no separate system to maintain.

**Subscriptions are excluded from Net Income/Net Spending, automatically —
no popup shown for them.** Tagged with their own category (e.g.
"Subscriptions"); an entry carrying that category still reduces the
account's real balance like any expense, but never gets asked "include in
spending?" and never counts toward the total — same treatment as Credit
Cards and Investments (see Phase 6), just reached through a category tag
instead of a separate account type, since a subscription payment still
comes out of a normal bank/cash account.

Nothing to build here beyond Phase 4 itself, plus this one exclusion rule.

---

## Phase 3 — Fix the FAB overlap bug (root cause identified, approach settled)

**Root cause:** the page content area reserves `6.5rem` of bottom padding to
clear the tab bar — but the floating "+" button sits from `5.5rem` up to
roughly `9rem` from the bottom of the screen (its position plus its own
height). That leaves a **~2.5rem dead zone where the button physically
overlaps content, on every page that has one** — Home and Wallet are just
the two that happened to get scrolled into that zone during manual checking.

**Correct fix:** this is one CSS padding value that's smaller than the
button's actual footprint, not a set of unrelated page-specific bugs.
Increasing that one constant so it's always larger than the FAB's full
vertical extent fixes every current page at once — Home, Wallet, and every
page not yet manually checked (Person detail, Account detail, Investment
detail, Reports, Settings) — without needing to individually re-verify each
one, because the fix is structural rather than dependent on visual
inspection catching every occurrence.

---

## Phase 4 — Notes is removed; every transaction requires a real account

**What's gone:** the standalone Notes feature — no page, no data model, no
"log it without an account" option. There is no free-floating financial
record anywhere in the app anymore.

**What replaces it:** a single "Add Transaction" flow, reachable the same
quick way Notes was (FAB, from anywhere), that requires an account before it
will save:

1. Pick an account (required).
2. Pick a direction (Money in / Money out — or Charge / Payment if the
   account is a credit card, see Phase 5).
3. Amount.
4. Description (optional free text — "Sent to father", "Netflix" — exactly
   like a bank app or Google Pay asking for a note when you send money).
5. Date.

**Example 4a — money out:** Send ₹30,000 to your father from SBI.
Account: SBI · Direction: Money out · Amount: ₹30,000 · Description: "Sent
to father."
→ SBI: ₹10,000 − ₹30,000 = **−₹20,000**.

**Edge case — going negative:** not blocked. SBI genuinely doesn't have
₹30,000 available in this example, and the app has always allowed negative
balances (shown in red) rather than rejecting an entry — it's a ledger you
control, not a live bank connection that can decline a transaction.

**Edge case — trashed accounts don't appear in the picker.** Example: you
have SBI and an old account, ICICI, which you closed and moved to Trash last
month. Opening the account picker in Add Transaction shows SBI (and Wallet
Cash, HDFC Card, etc.) but never ICICI — it's not live anymore. Same in
reverse: if SBI itself were accidentally sitting in Trash, it simply
wouldn't be selectable until restored, which doubles as a signal that
something needs restoring first.

**Example 4b — money in:** Salary into Deutsche Bank.
Account: Deutsche Bank · Direction: Money in · Amount: €900 · Description:
"Salary."
→ Deutsche Bank: €500 + €900 = **€1,400**.

---

## Phase 5 — Credit cards through the same Add Transaction flow

**Setup:** new account, HDFC Card (INR, credit card), limit ₹50,000, opening
outstanding ₹0.

Picking a credit card as the account swaps the direction options to
Charge / Payment (matching how cards already work today) instead of Money
in/out.

**Example:** Charge ₹3,000 (category Eating out) → outstanding ₹0 + ₹3,000 =
**₹3,000** owed. Later, pay it off from SBI: a Payment entry on HDFC Card
(outstanding → ₹0) *and* a separate SBI entry for the money leaving your bank
account — accounts aren't auto-linked, so paying a card is always two
entries, one on each side.

**The card side of both of these — Charge and Payment — never shows the
Income/Spending popup and never counts toward Net Income/Net Spending.**
The whole credit card section is deliberately kept out of this feature
entirely, same as Investments. The SBI-side entry that actually pays the
bill *does* go through Add Transaction like anything else leaving a bank
account, and *does* get asked the popup — see Phase 6 for how that one
should typically be answered.

---

## Phase 6 — Whether something counts as income or spending: you decide, every time

**The mechanism:** every time an entry is created through Add Transaction —
spending, receiving money, a transfer between your own accounts, lending,
borrowing, a loan repayment — a popup asks a direct yes/no question:
- Money out → *"Include this in Spending?"*
- Money in → *"Include this in Income?"*

Your answer controls **only** whether it's added into the Net
Income/Spending totals. It never controls whether the account's real
balance changes — that always happens regardless of the answer. (Credit
card entries and subscription-tagged entries are the exception — they never
even show this popup; see Phases 2 and 5.)

**Example — a transfer between your own accounts:** move ₹5,000 from SBI
into a new Cash account, "Wallet Cash." Two entries: SBI −₹5,000, Wallet
Cash +₹5,000. For both, you'd answer **No** — it's the same money, just
relocated, not new economic activity. Both balances still update fully;
neither counts toward Net Income or Net Spending.

**Example — paying off a credit card bill:** the SBI-side entry that sends
₹3,000 to cover HDFC Card's bill (see Phase 5) goes through Add Transaction
like any bank expense, and gets asked the same popup. You'd answer **No** —
the real spending already happened the moment the card was charged;
answering "yes" here would count the same ₹3,000 twice.

**Cross-currency transfers: out of scope, by choice.** A transfer only
works between two accounts of the same currency. You're handling any actual
EUR↔INR movement yourself outside the app rather than needing it modeled
here. Simpler, and correctly reflects that you won't be creating that
situation.

---

## Phase 7 — Dashboard: Net income, Net spending, Net amount — per currency

Six figures total: three metrics × two currencies, all-time (a date-range
filter is a later, separate phase — not forgotten, just not now).

**Running the full story through, in order:** salary €900 → sent ₹30,000 to
father → groceries ₹2,000 → ₹5,000 transfer to Wallet Cash → ₹3,000 card
charge → ₹3,000 card payoff.

**EUR side** (only one event touched EUR):
| | |
|---|---|
| Net income (EUR) | **€900** |
| Net spending (EUR) | **€0** |
| Net amount (EUR) | **€1,400** |

€500 + €900 − €0 = €1,400 exactly — income minus spending matches the
balance perfectly here, because nothing was excluded.

**INR side** (transfers and a credit card are both involved, so it's more interesting):
| | |
|---|---|
| Net income (INR) | **₹0** (nothing arrived that you'd answer "yes" to) |
| Net spending (INR) | **₹32,000** (₹30,000 father + ₹2,000 groceries, both answered "yes." The ₹5,000 transfer and the ₹3,000 SBI-side card payoff were answered "no." The ₹3,000 HDFC Card *charge* was never even eligible — cards don't get the popup at all, Phase 5) |
| Net amount (INR) | **−₹25,000** (SBI ends at −₹30,000 after the payoff; Wallet Cash ends at ₹5,000; sum = −₹25,000 — unaffected by any popup answer, since it's a direct balance sum) |

**The important distinction to hold onto:** Net amount is *always* exact —
it's a direct sum of every account's real balance, the same math the app
already does today, nothing new that could drift or get out of sync. Net
income and Net spending are a *curated* view on top of it, built from your
own popup answers (Phase 6) rather than any automatic rule — the numbers
above assume you'd answer "yes" to father/groceries/salary and "no" to the
transfer and the card payoff, which is a choice, not something the app
decides for you. On the EUR side those two views happen to agree (nothing
was excluded); on the INR side they don't arithmetically reconstruct each
other, and that's intentional, not a bug — the balance stays trustworthy by
construction either way.

**Net Income and Net Spending are always calculated live** — a fresh sum of
every entry currently marked "yes," recalculated on demand, never stored as
a running total that gets incremented or decremented. Edit an entry's
amount, or delete it, and the totals simply reflect whatever currently
exists — nothing separate to keep in sync, nothing that can silently drift.

---

## Phase 8 — Archive, not delete

**Problem:** the old "Sent to father, ₹30,000" test note has nowhere to live
once Notes is removed — but permanently deleting it loses a record that
existed, even if it's outdated.

**Solution:** a new **Archive**, separate from Trash:

| | Trash | Archive |
|---|---|---|
| Purpose | Recently deleted, might still want it back | Deliberately retired, kept forever for reference |
| Auto-purge | Yes — permanently deleted after the retention window (default 30 days) | No — never auto-removed |
| Removed by | Restore, or wait out the retention window | Only a manual, explicit "permanently delete" from inside the Archive itself |
| Reached from | Settings (shows a count), same as today | Settings (shows a count), next to Trash |

The old note migrates into the Archive as a read-only record — original
text, amount, currency, and date preserved exactly as they were, with no
effect on any account balance (it never had one). Built as a general
mechanism, not a one-off: anything retired from the app in the future (a
removed feature's leftover data, for instance) has somewhere permanent and
tidy to go instead of being silently deleted.

---

## Phase 9 — Loans tie to real accounts, both lending and repayment

**Problem:** today, lending or repaying money only changes numbers inside the
loan itself — it never touches any actual account, even though real cash
changes hands. That breaks the "everything should reconcile" principle
everything else in this plan follows.

**Fix:** creating a loan, and recording a repayment against it, both now ask
which account the money moved through — same question Add Transaction
already asks for everything else.

**Example — lending:** "I lent Sripal €100" → asks *"From which account?"*
→ you pick **Deutsche Bank** → Deutsche Bank drops by €100 (you handed it
over for real). Borrowing works the same in reverse: the account you pick
*gains* the amount, since money came to you.

**Example — repayment:** Sripal repays €50 → asks *"Into which account?"* →
you pick **Deutsche Bank** again → Deutsche Bank rises by €50.

**General rule, so it doesn't need four separate cases spelled out:** the
account always moves in whichever direction matches what really happened to
your cash. Lending or repaying someone who owes you = your account rises on
repayment, falls on lending. Borrowing or repaying someone you owe = the
reverse.

**Edge case — currency mismatch.** The loan is in whatever currency you set
when creating it (say EUR). The account you pick for lending or repayment
should be in that same currency — same as Phase 6, cross-currency isn't
modeled, so you'd pick a EUR account for a EUR loan, an INR account for an
INR loan.

**Lending, borrowing, and repayment all get the same Income/Spending popup
as everything else (Phase 6) — including repayment, not just the original
loan.** There's no automatic rule that excludes loans; you decide each time,
same mechanism as a transfer or a card payoff. Lending money usually isn't
spending — you haven't lost that value, it's changed form into an IOU, so
you'd typically answer **No**. Getting repaid usually isn't income — you're
turning that IOU back into cash you already effectively had, so **No**
again. But it's your call each time, not a fixed category rule.

Worked example, assuming you answer "No" both times as above: Deutsche
Bank sits at €1,400. Lend Sripal €100 → popup asks "Include in Spending?" →
No → Deutsche Bank drops to €1,300 (real balance, correct either way) — Net
Spending doesn't move. Sripal repays €100 → popup asks "Include in Income?"
→ No → Deutsche Bank rises back to €1,400 (real balance, correct) — Net
Income doesn't move. Had you answered "Yes" instead — say you consider a
particular loan effectively a gift you don't expect back — it would count,
and that's fine; the app isn't second-guessing your answer either way.

---

## Status: plan confirmed, not yet built

**Final structure for Income/Spending (supersedes earlier category-based
drafts):**
- The popup ("Include in Spending?" / "Include in Income?") appears for
  every Wallet transaction and every loan transaction — lending, borrowing,
  and repayment all included.
- Three things are fully separate, no popup, never counted: **Credit cards**
  (Phase 5), **Investments/Stocks**, and **Subscriptions** (Phase 2, excluded
  by category).
- Net Income/Net Spending are always calculated live from current "yes"
  answers — never a stored running total.
- No cross-currency handling anywhere — same-currency only, confirmed
  dropped.

**Other confirmed items:**
- Phase 3: root cause identified and fix approach settled — confirmed.
- Phase 9 (loans tie to accounts, including repayment) — confirmed.
- Phase 1/Phase 9 auto-sync (editing a payment also correcting its linked
  account entry) — explicitly not required; accepted as a manual-care risk.
- Backup/restore version handling and the "no category fits gifts/family
  transfers" gap — explicitly not needed; skip.
- Vivek and Sripal test records — to be removed from the live app later,
  not yet.
- Nothing in this document has been built yet. Next step is implementation,
  phase by phase, whenever you're ready to proceed.
