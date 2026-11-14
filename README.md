# Token Radar — pre-token protocols ranked by implied launch value

A snapshot-only radar for the make.fun `token-radar-01` competition. It reads
one sealed DefiLlama snapshot, finds every protocol whose record shows no
token, values each one from the snapshot's own live-token comparables, and
writes a dark dashboard that ranks them by implied launch value, each with a
seven-step farm plan.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22 or later, standard library only — nothing to install. The run writes
`out/board.json`, `out/dashboard/` (the page plus `data.js`), `out/screenshots/`
and `out/dossier.json`. Run it twice and the two outputs are byte-identical.

## The model

Built only from the snapshot's own figures — no outside prices, no hand-kept
list of names:

1. **Admit.** A protocol is rankable when its record shows no token at all
   (market cap, CoinGecko id and symbol all null) and it is not a wrapped,
   staked or bridged product, not a versioned pool, and not an exchange. The
   snapshot's 40-protocol watchlist is the floor; the same rule admits the
   early protocols below the $50m floor too. This snapshot yields 198 rows.
2. **Multiple.** For each category, the median of market-cap ÷ TVL across the
   live-token protocols in that category (at least 3 needed, otherwise the
   global median across all live tokens), clamped to 0.05–1.00.
3. **Implied value.** TVL × multiple × (1 + 0.6 × 7-day change, clamped to
   −50%…+100%) × (0.70 + 0.30 × age in days capped at 1095 ÷ 1095) ×
   (1 + 0.04 × extra chains, capped at 5). Age runs from the listing date to
   the snapshot date (2026-11-14), or 365 days when no listing date is
   recorded.
4. **Rank.** Sort by implied value, highest first.

Live-token protocols are not valued — they appear in a separate tab at their
market cap, as the comparables the pre-token board is valued against. The
snapshot's record is not proof a token will ever launch; every value here is
the entry's own claim.

## Farm plans

Each row carries 7 steps derived from that protocol's own record — its
category, its chains, its TVL and its age. A category-specific opening move
and a second qualifying action, a weekly cadence, an age-based hold, a
points-page check that never pays to claim, a farm log, and an unwind step.
Every step states what it costs and how long it takes.

## Dashboard

`dashboard/index.html` with `app.css` and `app.js`, dark theme, no network
(no remote addresses anywhere). Search box, category and chain filters, a
watchlist toggle, pre-token / live-token tabs, sortable columns, and a detail
view for every protocol that recomputes that row's implied value in the page
and checks it against the board. The methodology tab shows the comparables
table (median multiple per category). Deep-linking works through URL
parameters: `?slug=…`, `?category=…`, `?q=…`, `?chain=…`,
`?watchlist=1`, `?tab=live`.

## Files

- `main.ts` — the whole program: admission, multiples, implied values, farm
  plans, board, dashboard data, dossier.
- `vendor/makefun-board.ts` — the kit's shipped dossier library, byte for byte.
- `dashboard/` — `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `.makefun/owner.json` — the claim file naming the payout wallet.
