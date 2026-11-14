// token-radar-01 — snapshot-only token launch radar.
//
// Reads a sealed DefiLlama snapshot, finds every protocol whose record
// shows no token and which is not a wrapped, staked or bridged product,
// values each one from the snapshot's own live-token comparables, and
// writes a ranked board plus the dashboard data the page renders.
//
// Node 22, standard library only. Deterministic: two runs on the same
// snapshot write byte-identical output.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

type Proto = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

type Snap = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
};

const BARRED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function dayCount(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function usd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function recordsNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function isVersionedName(name: string): boolean {
  return VERSION_TAIL.test(name);
}

function isWrappedProduct(name: string): boolean {
  return WRAPPED_WORD.test(name);
}

function startsWithExchange(name: string): boolean {
  return EXCHANGE_PREFIXES.some((ex) => name === ex || name.startsWith(ex + " ") || name.startsWith(ex + "-"));
}

// The admission rule from the snapshot's field guide, applied to every
// protocol the same way — the watchlist is the floor, never the ceiling,
// so the same rule also admits the early protocols below the floor.
function rankable(p: Proto): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && BARRED_CATEGORIES.has(p.category)) return false;
  if (isVersionedName(p.name)) return false;
  if (isWrappedProduct(p.name)) return false;
  if (startsWithExchange(p.name)) return false;
  return true;
}

// Live-token comparables: mcap / TVL for protocols whose token trades.
function comparables(protocols: Proto[]): { byCategory: Record<string, number>; global: number; counts: Record<string, number> } {
  const live = protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const perCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? "Uncategorised";
    if (!perCat.has(key)) perCat.set(key, []);
    perCat.get(key)!.push(p.mcap_usd! / p.tvl_usd);
  }
  const byCategory: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [cat, ratios] of [...perCat.entries()].sort()) {
    counts[cat] = ratios.length;
    byCategory[cat] = clamp(median(ratios), 0.05, 1.0);
  }
  const global = clamp(median(live.map((p) => p.mcap_usd! / p.tvl_usd)), 0.05, 1.0);
  return { byCategory, global, counts };
}

function multipleFor(p: Proto, comps: ReturnType<typeof comparables>): number {
  const key = p.category ?? "Uncategorised";
  if ((comps.counts[key] ?? 0) >= 3) return comps.byCategory[key];
  return comps.global;
}

function ageDays(p: Proto, asOf: string): number {
  return p.listed_at ? dayCount(p.listed_at, asOf) : 365;
}

// Implied value, built only from the snapshot's own figures:
// TVL x category multiple, moved by 7-day growth, seasoned by age,
// and widened a little for each extra chain the protocol runs on.
function impliedValue(p: Proto, mult: number, asOf: string): { value: number; age: number } {
  const age = ageDays(p, asOf);
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -50, 100);
  const growthFactor = 1 + (growth / 100) * 0.6;
  const ageFactor = 0.7 + 0.3 * (Math.min(age, 1095) / 1095);
  const chainFactor = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const value = Math.round(p.tvl_usd * mult * growthFactor * ageFactor * chainFactor);
  return { value: Math.max(1, value), age };
}

// The two hands-on moves for a category: what a farmer actually does
// first, and the second qualifying action after it.
function openingMoves(category: string | null): [string, string] {
  switch (category) {
    case "Dexs":
      return ["swap a small amount through its pools", "add liquidity to one of its pools"];
    case "Lending":
      return ["supply collateral into its lending market", "borrow a small amount against that supply"];
    case "Yield":
    case "Yield Aggregator":
      return ["deposit into one of its vaults", "compound or restake the vault position"];
    case "Derivatives":
    case "Options":
    case "Options Vault":
      return ["open a small derivatives position", "close and reopen a position the following week"];
    case "CDP":
    case "CDP Manager":
      return ["mint its stable asset against collateral", "repay part of the debt and mint again"];
    case "Farm":
      return ["stake LP tokens in its farm", "harvest and restake the farm rewards"];
    case "Launchpad":
      return ["join one of its launches with a small ticket", "vote or stake in its launch flow"];
    case "Bridge":
    case "Cross Chain Bridge":
      return ["bridge a small amount through it", "bridge back on a different route"];
    case "RWA":
      return ["buy a small position in its tokenised asset", "hold it through one reporting cycle"];
    case "Prediction Market":
      return ["place a small prediction on one of its markets", "settle and place a second prediction"];
    case "NFT Marketplace":
      return ["list or buy a low-priced item on its market", "complete a second trade the next week"];
    case "Payments":
      return ["send a small payment through it", "receive a payment through it"];
    case "Insurance":
      return ["buy a small cover policy", "keep the cover active through one cycle"];
    case "Synthetics":
      return ["mint a small synthetic position", "burn and re-mint the position"];
    case "Restaking":
      return ["restake a small amount through it", "delegate the restaked position"];
    case "Leveraged Farming":
      return ["open a small leveraged farm position", "adjust the leverage once after a week"];
    case "Uncollateralized Lending":
      return ["lend a small amount into its credit pool", "fund a second borrower tranche"];
    case "Liquidity Manager":
      return ["deposit into one of its managed liquidity vaults", "rebalance the vault position after a week"];
    case "Risk Curators":
      return ["deposit into one of its curated vaults", "allocate to a second curated vault"];
    case "Onchain Capital Allocator":
      return ["allocate a small amount to one of its strategies", "reallocate to a second strategy"];
    case "Basis Trading":
      return ["open a small basis trade position", "roll the basis position after a week"];
    case "Staking Pool":
      return ["stake a small amount in its pool", "top up the stake once after a week"];
    case "Interest Rate Derivatives":
      return ["open a small rate position", "hedge the rate position the following week"];
    case "Indexes":
      return ["buy a small position in one of its indexes", "rebalance the index holding"];
    case "AI Agents":
    case "Decentralized AI":
      return ["run a small job through its agent", "run a second agent job on another chain it supports"];
    case "Privacy":
      return ["make a small private transaction through it", "repeat a private transaction the next week"];
    case "CeDeFi":
      return ["deposit a small amount into its CeDeFi product", "withdraw and redeposit a portion"];
    case "Token Locker":
      return ["lock a small token amount in its locker", "extend the lock by a short period"];
    case "Governance Incentives":
      return ["vote on one of its governance proposals", "delegate voting power to an active delegate"];
    case "Stablecoin Issuer":
    case "Algo-Stables":
    case "Dual-Token Stablecoin":
      return ["mint a small amount of its stable asset", "redeem and re-mint the stable asset"];
    case "Collateral Management":
    case "Collateral Markets":
      return ["post collateral in one of its markets", "adjust the collateral ratio once"];
    case "Chain":
      return ["bridge a small amount onto its chain", "use an app that runs on its chain"];
    case "Anchor BTC":
    case "Decentralized BTC":
      return ["mint a small amount of its BTC-backed asset", "redeem and re-mint the BTC-backed asset"];
    default:
      return ["use its app with a small first transaction", "complete a second on-chain action a few days later"];
  }
}

function money(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "m";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k";
  return "$" + Math.round(n);
}

// Seven concrete steps, each naming what it costs and how long it takes,
// drawn from the protocol's own record: its category, its chains, its
// TVL, and how long it has been listed.
function farmPlan(p: Proto, age: number): string[] {
  const chain = p.chains[0] ?? "its home chain";
  const chainList = p.chains.slice(0, 3).join(", ");
  const [first, second] = openingMoves(p.category);
  const holdWeeks = clamp(Math.round(age / 30), 4, 52);
  const size = p.tvl_usd >= 100_000_000 ? "a modest position" : "a small test position";
  const weekly = age < 180 ? "twice a week" : "once a week";
  const steps = [
    `Start on ${chain}: ${first} with ${size} in ${p.name} (${p.category ?? "uncategorised"}, TVL ${money(p.tvl_usd)}). Cost: gas only, about $1-3. Time: 20 minutes.`,
    `Qualify the wallet: ${second} on ${chain} so the address shows repeat use, not a single touch. Cost: gas only, about $1-3. Time: 15 minutes.`,
    `Keep a ${weekly} rhythm: return to ${p.name} and repeat a small on-chain action so activity looks steady across weeks. Cost: gas only, about $1-2 per visit. Time: 10 minutes per visit.`,
    `Hold for the long run: keep the position open for at least ${holdWeeks} weeks — ${p.name} has run ${age} days with no token recorded, so patience is the edge here. Cost: $0 while held. Time: 5 minutes a week to check it.`,
    `Check its points or quests page ${weekly} and complete any free task it lists; never pay to claim points and never sign a claim that asks for a fee. Cost: $0. Time: 5 minutes per check.`,
    `Log every move: write the date, chain (${chainList}), amount and transaction hash for each action in a farm log, so you can prove the history later. Cost: $0. Time: 5 minutes per entry.`,
    `Unwind cleanly: when a token launches or TVL falls for two straight weeks, withdraw in two parts over two days and keep the log. Cost: gas only, about $1-3. Time: 20 minutes.`,
  ];
  return steps;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputFlag = argv.indexOf("--input");
  if (inputFlag === -1 || !argv[inputFlag + 1]) {
    console.error("usage: node main.ts --input <snapshot.json>");
    process.exit(2);
  }
  const inputPath = resolve(argv[inputFlag + 1]);
  const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? join(HERE, "out"));
  const snap: Snap = JSON.parse(readFileSync(inputPath, "utf8"));

  const comps = comparables(snap.protocols);
  const watchSet = new Set(snap.watchlist);

  // The board: every rankable protocol, watchlist and below-floor alike.
  const scored = snap.protocols
    .filter(rankable)
    .map((p) => {
      const mult = multipleFor(p, comps);
      const { value, age } = impliedValue(p, mult, snap.as_of);
      return { p, mult, value, age };
    })
    .sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.value,
    farm_steps: farmPlan(s.p, s.age),
  }));

  // Live-token protocols go in a separate view, shown at market cap.
  const live = snap.protocols
    .filter((p) => p.mcap_usd !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: ageDays(p, snap.as_of),
    }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));

  const boardData = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    multiple: s.mult,
    implied_value_usd: s.value,
    rank: i + 1,
    watchlist: watchSet.has(s.p.slug),
    farm_steps: farmPlan(s.p, s.age),
  }));

  const payload = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    generated: "token-radar-01",
    global_multiple: comps.global,
    multiples: comps.byCategory,
    multiple_counts: comps.counts,
    watchlist_count: snap.watchlist.length,
    rows: boardData,
    live,
  };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows, generated: "token-radar-01", as_of: snap.as_of }, null, 2) + "\n", "utf8");
  writeFileSync(
    join(outDir, "dashboard", "data.js"),
    "window.RADAR = " + JSON.stringify(payload) + ";\n",
    "utf8",
  );
  cpSync(join(HERE, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  if (existsSync(join(HERE, "screenshots"))) {
    cpSync(join(HERE, "screenshots"), join(outDir, "screenshots"), { recursive: true });
  }
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(outDir, "dossier.json"), dossier, "utf8");

  console.log(`board: ${rows.length} rows, top ${usd(rows[0].implied_value_usd)} (${rows[0].slug}), bottom ${usd(rows[rows.length - 1].implied_value_usd)}`);
  console.log(`watchlist covered: ${rows.filter((r) => watchSet.has(r.slug)).length}/${snap.watchlist.length}; live view: ${live.length} protocols`);
}

main();
