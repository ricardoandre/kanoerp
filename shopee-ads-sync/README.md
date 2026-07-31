# Shopee Ads Tiering & Review System

A decision-support system for managing Shopee GMV Max ad spend across InKano and
AskaLabel, built on NocoBase. It ingests weekly and monthly ad exports, maps
listings to product models, sorts them into tiers, and walks you through a
disciplined monthly review that ends in logged decisions.

This README exists so nobody has to relearn what took a long conversation to work
out. Read the **Strategy** section first — the tooling only makes sense once the
mental model is clear.

---

## 1. The mental model (read this first)

### GMV Max pins ROAS to your target
Shopee GMV Max maximises `bid × pCTR × pCVR` per slot. The ROAS target you set is
a **throttle on the bid, not a promise**. Realised ROAS lands wherever you set the
target, which has one crucial consequence:

> **ROAS carries no information about the product.** Two very different listings
> both run at ROAS 10 if you target them both at 10.

So selection and diagnosis must run on metrics the algorithm does *not* pin: CVR,
revenue-per-click, CTR, and volume. ROAS is an output you dial, not a signal you
read. This is the single most important idea in the whole system.

### ROAS 10 is a ceiling, not a floor
Business policy is ad spend ≤ 10% of GMV, i.e. blended ROAS ≥ 10. Treat this as a
**ceiling**:

- **Above** the target → you are *underspending*. There is profitable demand you
  are not buying. Scale.
- **Below** the target → you are *overspending*. Raise targets on the worst
  offenders (that strips your least efficient impressions first). Do **not** cut
  budgets — that removes good spend along with bad.

A ±15% band around the target is noise, not a problem. Breakeven at ~50% margin is
around ROAS 2, so anything holding 7 is comfortably profitable. **"Kill" almost
never means "stop the ads"** — it means "move it to a tier that doesn't get weekly
attention." Genuine stop-the-ads cases are narrow: broken size run, unrestockable
stock, or spend with literally zero units.

### CVR is price-dependent — never rank it flat
`corr(AOV, CVR) ≈ −0.45` in this account. A Rp 89k tee and a Rp 340k outer are
different purchase decisions; ranking them together penalises everything expensive.
**CVR is always ranked against price-similar peers** (AOV within ±33%, min 6 peers,
300+ clicks). Revenue-per-click (`CVR × AOV`) is the price-neutral twin and is
ranked catalogue-wide; note `ROAS = revenue-per-click ÷ CPC`.

### CVR is two steps, not one
`CVR = click→cart × cart→buy`. "Low CVR" is never actionable; "loses people between
click and cart" is. Click→cart problems are the page/expectation (image over-
promises, wrong colour in stock, weak gallery). Cart→buy problems are price,
shipping, or a broken size run. **Add-to-cart is Seller Centre UI only — not in the
CSV export**, so this split can't be automated yet.

---

## 2. The tiers

| Tier | Target ROAS | Judged on | Notes |
|---|---|---|---|
| **Hero** | 7 (floor 6) | units/day trend + falling CPC, **never ROAS** | 3–5 models max. A concentrated velocity bet. |
| **Potential Hero** | 11 | — | Hero economics, blocked on stock. Runs at Profit targets until stock clears, then promote. Never drags the blend. |
| **Profit** | 11 | ROAS near ceiling while absorbing budget | 20–40 models. Where contribution comes from. |
| **Test** | ~10 | CTR & CVR, **never ROAS** | 14 days untouched. Decides a *managed slot*, not whether to advertise. |
| **Tail** | 13 | autopilot | High target, no attention. Let the algorithm scavenge cheap conversions. |
| **Clearance** | 13 | cash recovery | COGS already sunk. Ads only while ROAS ≥ 5, else cut price / bundle. Stop when the size run breaks. |

### Hero selection — 7 criteria, in weight order
1. **CVR** ≥ p75 vs price-similar peers (the compounding metric)
2. **Revenue/click** ≥ p70 catalogue-wide (price-neutral earner test — CVR **OR** RPC qualifies)
3. **Volume** ≥ 20 units/week (below this, weekly numbers are luck)
4. **Spend** ≥ p50 (can it absorb more budget? *different question from volume*)
5. **History** ≥ 3 periods (guards against a fluke)
6. **CTR** never a gate (low CTR + high CVR = under-marketed gem — an image fix)
7. **Listings** ≤ 2 (a 3rd+ splits reviews/velocity/rank — derived from data)

**Confidence** is graded, not guessed: *clear* = every deciding signal clears its
threshold by ≥15%; *borderline* = a signal only just clears/misses, or a blocker
exists; *thin* = not enough data. Never gate confidence on a condition GMV Max
makes unreachable (e.g. "ROAS ≥ 14").

Hero suggestions are **candidates only** — supply, margin, review depth, return
rate and seasonality are not in the ads export. The block hands those back to you.

### Why differentiated targets are a *bet*, not free efficiency
At the same blend, uniform and differentiated targeting produce **identical** GMV
and contribution in-period — blended ROAS is just a spend-weighted average. With
diminishing returns (`marginal ROAS ≈ 0.7 × average`), moving a rupiah from profit
into hero loses ~2.31 GMV immediately. The flywheel (cheaper CPC, reviews, organic)
must lift hero GMV 46–139% over 12 months to pay that back, depending on how much
share actually moves. It buys an *option* uniform can't — concentrated velocity —
but it's unfundable until the non-hero portfolio clears 10 on its own. **Right now
it does not** (non-hero runs ~9.23), so the hero programme is deferred; the fastest
path to policy is raising tail targets.

---

## 3. Architecture

```
Shopee CPC export (CSV/XLSX, "ALL" tab)
        │  parse_shopee_ads.py         → normalised rows, one per listing per period
        ▼
nocobase_import.py                     → period-replace import via REST API
        ▼
┌─────────────────────────────────────────────────────────┐
│  shopee_ads_performance   (facts: one row per listing/period)   │
│  shopee_product_map       (listing → model, tier, target_roas)  │  ← source of truth
│  shopee_ads_action_log    (every decision, with snapshot)       │
└─────────────────────────────────────────────────────────┘
        ▼
NocoBase jblocks (read via ctx.api.resource, never ctx.sql)
  • view_shopee_ads_review     — the monthly guided review
  • view_shopee_ads_listings   — sortable browse table
  • one-off maintenance blocks  — model mapping, action-log normalisation
```

### Identity & the `family` column
`family` **is** `product.model` (e.g. `O35Cassia`) — brand letter (A=askalabel,
O=inkano) + sequence + name. It is **not** a separate taxonomy. Rules learned the
hard way:

- **`shopee_product_map.family` is the only source of truth.** It's keyed on
  `product_code`.
- **`shopee_ads_performance.family` was dropped.** It was a parser guess that
  drifted out of sync. Roll-ups join on `product_code` → map. Never reintroduce a
  fallback to a perf-level family.
- **The action log stores the model name in `family`** (stable, it's your own
  identifier) and records `product_code` as the listings in scope. History joins on
  the model name; a rename is corrected by the maintenance block, not migrated.
- Matching an ad title to a model: strip to the name, un-camel-case
  (`PlumeSol → Plume Sol`), **brand letter is a hard filter**, same-name-different-
  sequence forces `unsure` (never auto-confirm).

---

## 4. The review flow (`view_shopee_ads_review`)

Steps run **top-to-bottom for setup, then bottom-up for execution**:

- **Step 0 — Map listings to models.** Only appears when something is unmapped.
  Proposes matches, writes nothing until confirmed.
- **Step 1 — Decide the tier.** Shows current → suggested with the 7-criteria table
  (each criterion shows its absolute threshold and the gap, e.g. `≥ 1.21% (p75)
  −0.18pp`). You agree, override, or change. **A logged decision is settled** and
  never re-asked — including deliberate overrides, which are flagged so you can
  later audit whether ignoring the engine was right.
- **Step 2 — Composition.** One decision for the whole portfolio: agree tier
  targets, see the live projected blend, record **one** `blend_plan` entry. No
  per-listing editing here.
- **Steps 3–7 — Bottom-up (Clearance → Tail → Test → Profit → Hero).** Clearance
  and tail are deliberately thin (the data shows no chronic waste — cutting every
  listing under ROAS 8 moves the blend only 9.37→9.57 while losing 78jt GMV).
  Profit/Hero show **models as headers with per-listing detail**: each listing gets
  its own CVR/CTR read, a suggestion with the target folded in, and buttons
  (**Set target / Queue listing fix / Stop ads / No action**). Every button logs
  immediately and the row collapses to a green summary.
- **Step 8 — Review what you already did.** Overdue decisions with then→now pulled
  from the snapshot.

### One log, not two
The suggestion is recomputed from data each time, so it lives *inside* the action
entry (`snapshot.suggested_action` / `suggested_tier`) rather than in its own row.
**"No action" is a real logged decision** (`action_type: no_action`) — it's what
stops the report re-asking and the only way to audit ignored advice.
`handledThisPeriod` scopes by `period_ref`, so each period starts fresh.

### The block can't change Shopee
Every target/budget decision records **intent** and the number you'll set. The note
ends with `STILL TO DO: set this in Seller Centre`. Next month's banner tells you
whether the blend actually moved — if not, either the target was never set or the
tier couldn't reach it.

---

## 5. Files

| File | What it is |
|---|---|
| `parse_shopee_ads.py` | Parses Shopee CPC exports (CSV/XLSX, reads the `ALL` tab), multi-period, auto-detects brand. Emits no `family`. |
| `nocobase_import.py` | Reads `.env` (`NOCOBASE_URL`, `NOCOBASE_API_KEY`). Period-replace import. `--test/--inspect/--probe/--schema/--purge/--drop-obsolete`. |
| `view_shopee_ads_review.js` | The monthly guided review (jblock). |
| `view_shopee_ads_listings.js` | Sortable browse table — brand/period/model/product, search, tier column. |
| `fix_action_log.js` / `.py` | One-off: normalise legacy `family` names to `product.model`. |
| `shopee_model_migration.js` | One-off: align `family` across tables (largely superseded by Step 0). |

Run order for a fresh import: `parse_shopee_ads.py <out.csv> <export...>` then
`nocobase_import.py`. Both brands in one command.

---

## 6. Hard-won learnings (don't relearn these)

### NocoBase / jblock sandbox
- **`ctx.sql` is admin/root-gated** — silently returns empty for non-admin roles.
  Never use it for data. Use `ctx.api.resource()` everywhere.
- **`antd.Drawer` / `Modal.confirm` aren't reliably available** — build slide-overs
  from plain divs with lifted React state.
- Guard against missing antd exports (a missing one renders as `undefined` →
  React #130, which says nothing). Name the culprit instead.
- **Static-check every block before shipping:** scan for `ce(Component)` references,
  confirm each resolves to an antd destructure or a local def, then execute with a
  stub React counting `undefined` createElement types. This caught real bugs
  (a deleted `BenchmarkPanel`, stray `ce &&` typos) that syntax-checking missed.

### Data patterns
- `belongsTo` payloads need nested objects: `{ rel: { targetKey: value } }`.
- `.get({filterByTk})` returns truthy-but-empty for nonexistent records on this
  instance — use `.list({filter, pageSize:1})` + length for existence checks.
- Large `$in` arrays cause **414 errors** — batch into chunks of ~150, each fully
  paginated. (`fetchByIn` / `fetchAllPages` helpers.)
- bigInt columns may return strings — coerce with `num()`.
- `media_id`/`story_id` and Shopee product codes can exceed `Number.MAX_SAFE_INTEGER`
  — treat as strings, never numeric-cast.

### Formatting & UI
- Money scales: `1.66 M / 176jt / 450rb`.
- `border-collapse: collapse` breaks `position: sticky` in WebKit — use
  `separate; border-spacing: 0`.
- Every scrollable drawer/sheet ends with an ~80–120px spacer div so the last row
  isn't clipped.

---

## 7. Product findings (as of Jun 2026)

- **Cassia / Thames** — hero candidates blocked on **3 listings each** sharing one
  title. Consolidating colourways into variants of one listing is the single
  highest-leverage merchandising change in the account (concentrates reviews,
  velocity, rank). Both have bottom-quartile CTR vs price peers hiding behind
  excellent conversion economics.
- **Plume** — Profit, not Hero. Best CTR in the account (p92) but cleared the hero
  earner bar **0 of 9 months**, including in-stock ones. Its problem is inside the
  family: the street/pink listing loses at click→cart, sky loses at cart→buy. Best
  fix is the page, not the tier. (See `Plume_tier_decision_2026-07.pdf`.)
- **Lunel / Thara** — "convert poorly but cheaply" cases. Demote to Tail on a high
  target; they're profitable, so this is a demotion, not a shutdown.

---

## 8. Open questions / next steps

- **Consolidate Cassia/Thames/Spire colourways** into single-listing variants.
- **Backfill `target_roas`** — no data exists yet; entries during review seed it.
  From next period the blend loop closes properly.
- **Weekly export** — parser now reads the `ALL` tab; load weekly data and use the
  weekly toggle in both blocks.
- **Add-to-cart** — check whether the Shopee export can include it; it's the
  missing half of every CVR diagnosis.
- **Decide whether 10 is the right policy** — the whole portfolio runs ~9.4 with no
  fat tail of waste, so closing the gap means accepting less volume, improving
  conversion, or moving the goalpost. Worth an explicit answer before optimising
  toward it.

---

## 9. Glossary

- **CIR** — cost-to-income ratio = spend ÷ GMV. Policy ≤ 10%.
- **RPC / revenue-per-click** — `GMV ÷ clicks = CVR × AOV`. Price-neutral earner.
- **Managed slot** — a place in the weekly review with your attention on it. Test
  decides whether something earns one, not whether it deserves ads.
- **Flywheel** — velocity → cheaper CPC + reviews + organic → more velocity. The
  thing a hero bet is buying.
- **Markdown** — a price cut. (Costs nothing until someone buys; ads cost per click.)
