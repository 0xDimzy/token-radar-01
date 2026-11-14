# Token Radar — pre-token protocols ranked by implied value

A make.fun entry for competition `token-radar-01`. The program reads the sealed
DefiLlama snapshot (`/input/snapshot.json`) and writes a ranked board plus a
static, no-network dashboard. It runs on Node 22 with the standard library only.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

`out/` then holds `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json`. The run is deterministic: the same snapshot bytes always write
the same output bytes.

## The model (`lib/model.ts`, `radar-2`)

The board ranks **every** rankable pre-token protocol in the snapshot — the full
40-protocol watchlist plus every pre-token protocol below the $50M floor that the
same admission rule admits (198 rows). A protocol is rankable when it records no
token (no market cap, no CoinGecko id, no symbol) and is not a wrapped, staked or
bridged product, not a versioned pool and not an exchange. "Records no token" is
DefiLlama's record, not proof it has none.

Implied value is a comparables model built from the snapshot itself:

```
multiple   = median(mcap_usd / tvl_usd) over live-token protocols in the
             protocol's own category (>= 3 live protocols with a market cap,
             else the global median), clamped to [0.05x, 1.00x]
implied    = round(tvl_usd x multiple
             x (1 + clamp(change_7d, -50, +100) / 100 x 0.6)
             x (0.70 + 0.30 x min(age_days, 1095) / 1095)
             x (1 + 0.04 x min(chains - 1, 5)))
```

Age is days since first listed (365 when unlisted): how long the protocol has
run with no token. No protocol name is ever special-cased. Live-token protocols
are kept apart in their own view, shown at their market cap, never a model's.

## Farm plans

Each row carries a 7-step plan derived from the protocol's own record
(category, chains, TVL, age): a category-specific opening action and a second
qualifying action, a weekly cadence, an age-based hold, a points-page check that
never pays to claim, and a farm log plus unwind. Every step states its cost and
its time.

## The dashboard (`dashboard/`)

A static page with no network: search, category and chain filters, a watchlist
toggle, pre-token / live-token tabs, sortable columns, a detail view per
protocol that recomputes the row's implied value in the page and checks it
against `board.json`, and a methodology panel with the comparables table.
Deep links work from the query string: `?detail=<slug>`, `?q=<text>`,
`?filter=<category>`, `?chain=<chain>`, `?watch=1`, `?tab=live`.

## Files

- `main.ts` — entrypoint: snapshot in, board + dashboard data + dossier out
- `lib/model.ts` — the model, the board builder and the farm-plan derivation
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — 1-board, 2-detail, 3-filtered, rendered from this dashboard
- `LICENSE` — MIT
- `.makefun/owner.json` — claim file naming the payout wallet
