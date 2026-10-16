import { useEffect, useMemo, useState, Fragment } from "react";
import { RefreshCw } from "lucide-react";
import { PriceChart } from "@/components/price-chart";
import { useFeed, type FeedSource } from "@/components/use-feed";
import {
  formatPct,
  formatPrice,
  formatZ,
  getMarket,
  WINDOWS,
  zLabel,
  type WindowSize,
} from "@/lib/markets";
import {
  analyze,
  clampBarrier,
  contractLabel,
  describeContract,
  KIND_HELP,
  needsBarrier,
  rankSignals,
  readout,
  type Analysis,
  type ContractKind,
  type Signal,
} from "@/lib/stats";
import type { Tick } from "@/lib/tape";

const STORAGE_KEY = "index-insight-v1";
const KINDS: ContractKind[] = ["rise", "fall", "even", "odd", "over", "under", "match", "differ"];

type WatchStatus = "pending" | "win" | "loss" | "flat" | "void";

type Watch = {
  id: string;
  series: number;
  symbol: string;
  marketName: string;
  kind: ContractKind;
  barrier: number | null;
  label: string;
  multiplier: number;
  entryPrice: number;
  entrySeq: number;
  entryDigit: number;
  placedAt: number;
  status: WatchStatus;
  exitPrice?: number;
  exitDigit?: number;
};

function isKind(value: unknown): value is ContractKind {
  return typeof value === "string" && (KINDS as string[]).includes(value);
}

function isWatch(value: unknown): value is Watch {
  if (!value || typeof value !== "object") return false;
  const watch = value as Watch;
  return typeof watch.id === "string" && isKind(watch.kind) && typeof watch.status === "string";
}

function settle(watch: Watch, tick: Tick): WatchStatus {
  switch (watch.kind) {
    case "rise":
      if (tick.price > watch.entryPrice) return "win";
      if (tick.price < watch.entryPrice) return "loss";
      return "flat";
    case "fall":
      if (tick.price < watch.entryPrice) return "win";
      if (tick.price > watch.entryPrice) return "loss";
      return "flat";
    case "even":
      return tick.digit % 2 === 0 ? "win" : "loss";
    case "odd":
      return tick.digit % 2 === 1 ? "win" : "loss";
    case "over":
      return tick.digit > (watch.barrier ?? 0) ? "win" : "loss";
    case "under":
      return tick.digit < (watch.barrier ?? 1) ? "win" : "loss";
    case "match":
      return tick.digit === watch.barrier ? "win" : "loss";
    case "differ":
      return tick.digit !== watch.barrier ? "win" : "loss";
  }
}

function pnl(watch: Watch, stake: number): number | null {
  if (watch.status === "win") return stake * (watch.multiplier - 1);
  if (watch.status === "loss") return -stake;
  if (watch.status === "flat") return 0;
  return null;
}

function sourceLabel(source: FeedSource): string {
  if (source === "live") return "Live";
  if (source === "paused") return "Paused";
  if (source === "sim") return "Simulated";
  return "Illustrative";
}

function sourceDot(source: FeedSource): string {
  if (source === "live") return "bg-rise";
  if (source === "paused") return "bg-fall";
  return "bg-warn";
}

function heatLevel(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "heat-0";
  const t = count / max;
  if (t > 0.75) return "heat-3";
  if (t > 0.45) return "heat-2";
  return "heat-1";
}

function runsRead(z: number): string {
  if (z <= -1.96) return "Runs are scarce, so the tape is clustering into streaks.";
  if (z >= 1.96) return "Runs are plentiful, so the tape is chopping back and forth.";
  return "The run count looks ordinary.";
}

function acRead(value: number): string {
  if (value >= 0.08) return "Positive: a mild echo of the previous value.";
  if (value <= -0.08) return "Negative: a mild flip away from the previous value.";
  return "Near zero: little echo from the previous value.";
}

function formatSignedPct(rate: number): string {
  const text = `${Math.abs(rate * 100).toFixed(1)}%`;
  if (rate > 0) return `+${text}`;
  if (rate < 0) return `−${text}`;
  return text;
}

function formatMoney(value: number): string {
  const text = Math.abs(value).toFixed(2);
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Desk() {
  const [symbol, setSymbol] = useState("1HZ100V");
  const [windowSize, setWindowSize] = useState<WindowSize>(100);
  const [kind, setKind] = useState<ContractKind>("even");
  const [barrier, setBarrier] = useState(4);
  const [stake, setStake] = useState(1);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const feed = useFeed(symbol);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as {
          symbol?: unknown;
          windowSize?: unknown;
          kind?: unknown;
          barrier?: unknown;
          stake?: unknown;
          watches?: unknown;
        };
        if (typeof data.symbol === "string" && getMarket(data.symbol).symbol === data.symbol) setSymbol(data.symbol);
        if (typeof data.windowSize === "number" && (WINDOWS as readonly number[]).includes(data.windowSize)) {
          setWindowSize(data.windowSize as WindowSize);
        }
        if (isKind(data.kind)) setKind(data.kind);
        if (typeof data.barrier === "number" && data.barrier >= 0 && data.barrier <= 9) setBarrier(data.barrier);
        if (typeof data.stake === "number" && data.stake >= 0 && data.stake <= 100000) setStake(data.stake);
        if (Array.isArray(data.watches)) setWatches(data.watches.filter(isWatch).slice(0, 40));
      }
    } catch {
      /* ignore broken local storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ symbol, windowSize, kind, barrier, stake, watches }),
    );
  }, [hydrated, symbol, windowSize, kind, barrier, stake, watches]);

  useEffect(() => {
    setWatches((prev) => {
      let changed = false;
      const next = prev.map((watch) => {
        if (watch.status !== "pending") return watch;
        if (watch.series !== feed.series) {
          changed = true;
          return { ...watch, status: "void" as const };
        }
        if (watch.symbol !== symbol) return watch;
        const exit = feed.ticks.find((tick) => tick.seq > watch.entrySeq);
        if (!exit) return watch;
        changed = true;
        return { ...watch, status: settle(watch, exit), exitPrice: exit.price, exitDigit: exit.digit };
      });
      return changed ? next : prev;
    });
  }, [feed.ticks, feed.series, symbol]);

  const view = useMemo(() => feed.ticks.slice(-windowSize), [feed.ticks, windowSize]);
  const analysis = useMemo(() => analyze(view), [view]);
  const signals = useMemo(() => rankSignals(analysis), [analysis]);
  const lines = useMemo(() => readout(analysis, feed.market, windowSize), [analysis, feed.market, windowSize]);
  const activeBarrier = clampBarrier(kind, barrier);
  const active = useMemo(
    () => describeContract(kind, needsBarrier(kind) === "none" ? null : activeBarrier, analysis),
    [kind, activeBarrier, analysis],
  );

  const last = view[view.length - 1];
  const formatted = last ? formatPrice(last.price, last.pip) : "—";
  const priceHead = formatted.slice(0, -1);
  const priceTail = formatted.slice(-1);
  const age =
    feed.source === "live" && now && last ? Math.max(0, Math.round(now / 1000 - last.epoch)) : null;

  const armed = watches.some(
    (watch) =>
      watch.status === "pending" &&
      watch.series === feed.series &&
      watch.symbol === symbol &&
      watch.kind === kind &&
      watch.barrier === active.barrier,
  );

  function load(nextKind: ContractKind, nextBarrier: number | null) {
    setKind(nextKind);
    if (nextBarrier !== null) setBarrier(clampBarrier(nextKind, nextBarrier));
    document.getElementById("contracts")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function arm() {
    if (!last || armed) return;
    const watch: Watch = {
      id: `${Date.now()}-${kind}-${active.barrier ?? "x"}`,
      series: feed.series,
      symbol,
      marketName: feed.market.name,
      kind,
      barrier: active.barrier,
      label: active.label,
      multiplier: active.multiplier,
      entryPrice: last.price,
      entrySeq: last.seq,
      entryDigit: last.digit,
      placedAt: Date.now(),
      status: "pending",
    };
    setWatches((prev) => [watch, ...prev].slice(0, 40));
  }

  const settled = watches.filter((watch) => watch.status === "win" || watch.status === "loss");
  const wins = settled.filter((watch) => watch.status === "win").length;
  const losses = settled.length - wins;
  const net = watches.reduce((sum, watch) => sum + (pnl(watch, stake) ?? 0), 0);

  return (
    <main className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
          <h1 className="shrink-0 text-lg font-medium tracking-tight">Index Insight</h1>
          <span className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm">
            <span className={`h-2 w-2 rounded-full ${sourceDot(feed.source)}`} aria-hidden="true" />
            {sourceLabel(feed.source)}
          </span>
          {feed.source !== "live" ? (
            <button
              type="button"
              onClick={feed.reconnect}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line px-3 text-sm hover:bg-inset"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Reconnect
            </button>
          ) : null}
          <nav className="flex flex-wrap gap-1" aria-label="Sections">
            {[
              ["tape", "Tape"],
              ["digits", "Digits"],
              ["contracts", "Contracts"],
              ["depth", "Depth"],
              ["journal", "Journal"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="h-11 rounded-lg px-3 text-sm text-muted hover:bg-inset hover:text-ink"
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4">
        <p className="text-sm text-muted">
          Volatility index desk for rise/fall, even/odd, over/under, and digit matches. {feed.detail}
        </p>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
            Index
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              className="h-11 rounded-lg border border-line bg-inset px-3 text-sm text-ink"
            >
              <optgroup label="1-second">
                {["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V"].map((id) => (
                  <option key={id} value={id}>
                    {getMarket(id).name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Standard, about every 2 seconds">
                {["R_10", "R_25", "R_50", "R_75", "R_100"].map((id) => (
                  <option key={id} value={id}>
                    {getMarket(id).name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Window</span>
            <div className="flex gap-2 overflow-x-auto">
              {WINDOWS.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={windowSize === size}
                  onClick={() => setWindowSize(size)}
                  className={`h-11 shrink-0 rounded-lg px-3 font-mono text-sm tabular-nums ${
                    windowSize === size ? "bg-accent text-accent-ink" : "border border-line text-ink hover:bg-inset"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section id="tape" className="section grid gap-4">
          <div className="quote-grid">
            <div className="panel flex flex-col justify-between gap-4">
              <div>
                <p className="text-sm text-muted">{feed.market.name}</p>
                <p className="mt-2 font-mono text-3xl font-medium tracking-tight tabular-nums">
                  <span>{priceHead}</span>
                  <span className="text-rise">{priceTail}</span>
                </p>
                <p className="mt-2 font-mono text-sm text-muted">
                  {feed.market.symbol}
                  {last ? ` · ${last.pip} dp` : ""}
                  {age !== null ? ` · ${age}s ago` : ""}
                </p>
              </div>
              <PriceChart ticks={view} />
            </div>
            <div className="panel flex flex-col justify-between">
              <p className="text-sm text-muted">Last digit</p>
              <p className="font-mono text-5xl font-medium tabular-nums leading-none">{last ? last.digit : "—"}</p>
              <p className="text-sm text-muted">{last ? (last.digit % 2 === 0 ? "Even" : "Odd") : "Waiting"}</p>
            </div>
            <div className="panel grid content-between gap-3">
              <div>
                <p className="text-sm text-muted">Open runs</p>
                <p className="mt-1 font-mono text-xl tabular-nums">
                  {analysis.dirStreak} {analysis.dirSide}
                </p>
                <p className="text-sm text-muted">
                  Parity run {analysis.parityStreak} {analysis.paritySide}
                </p>
              </div>
              <p className="text-sm text-muted">
                Longest rise {analysis.longestRise}, fall {analysis.longestFall}. Longest even {analysis.longestEven}, odd{" "}
                {analysis.longestOdd}.
              </p>
            </div>
          </div>

          <div className="panel">
            <p className="text-sm text-muted">Last digits, newest at the end. Even and odd are tinted apart.</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {view.slice(-36).map((tick) => (
                <span
                  key={`${tick.seq}-${tick.epoch}`}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg font-mono text-sm tabular-nums ${
                    tick.digit % 2 === 0 ? "bg-rise-dim text-rise" : "bg-fall-dim text-fall"
                  } ${last && tick.seq === last.seq ? "ring-1 ring-accent" : ""}`}
                >
                  {tick.digit}
                </span>
              ))}
            </div>
            <p className="mt-3 break-all font-mono text-sm leading-6 text-muted">
              {directionRibbon(view)}
            </p>
          </div>

          <div className="panel grid gap-2">
            <h2 className="text-lg font-medium">Read</h2>
            {lines.map((line) => (
              <p key={line} className="text-sm text-muted">
                {line}
              </p>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Summary
            title="Rise / Fall"
            primary={`${formatPct(analysis.dirN ? analysis.rises / analysis.dirN : 0)} rise`}
            secondary={`${formatPct(analysis.dirN ? analysis.falls / analysis.dirN : 0)} fall · z ${formatZ(analysis.riseZ)}`}
            note={`${zLabel(analysis.riseZ)}. Avg up ${analysis.avgUpPips.toFixed(1)} pips, avg down ${analysis.avgDownPips.toFixed(1)}.`}
            actions={[
              ["Use rise", () => load("rise", null)],
              ["Use fall", () => load("fall", null)],
            ]}
          />
          <Summary
            title="Even / Odd"
            primary={`${formatPct(analysis.n ? analysis.even / analysis.n : 0)} even`}
            secondary={`${formatPct(analysis.n ? analysis.odd / analysis.n : 0)} odd · z ${formatZ(analysis.evenZ)}`}
            note={zLabel(analysis.evenZ)}
            actions={[
              ["Use even", () => load("even", null)],
              ["Use odd", () => load("odd", null)],
            ]}
          />
          <DigitSummary analysis={analysis} onLoad={load} />
          <div className="panel flex flex-col gap-3">
            <h2 className="text-sm text-muted">Uniformity</h2>
            <p className="font-mono text-xl tabular-nums">χ² {analysis.chi2.toFixed(1)}</p>
            <p className="text-sm text-muted">
              p {analysis.chiP < 0.001 ? "< 0.001" : analysis.chiP.toFixed(3)} on 9 degrees of freedom.{" "}
              {analysis.chiP < 0.05 ? "Lopsided for this window." : "Still compatible with a fair wheel."}
            </p>
          </div>
        </section>

        <section id="digits" className="section panel">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-medium">Digit distribution</h2>
            <p className="text-sm text-muted">Bar scale starts at 0. Marker is the 10% fair share.</p>
          </div>
          <DigitBars analysis={analysis} />
        </section>

        <section id="contracts" className="section grid gap-4">
          <div className="panel grid gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-medium">Contract lab</h2>
              <p className="text-sm text-muted">
                One-tick contracts only. Arming scores the next tick on the tape you are watching. A jump to live quotes
                cancels an open arm. Indicative prices sit 3% under a fair payout. They are not Deriv quotes.
              </p>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {KINDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={kind === item}
                  onClick={() => setKind(item)}
                  className={`h-11 shrink-0 rounded-lg px-3 text-sm capitalize ${
                    kind === item ? "bg-accent text-accent-ink" : "border border-line hover:bg-inset"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {needsBarrier(kind) !== "none" ? (
              <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Barrier">
                {Array.from({ length: 10 }, (_, digit) => {
                  const mode = needsBarrier(kind);
                  const disabled = (mode === "over" && digit > 8) || (mode === "under" && digit < 1);
                  const selected = activeBarrier === digit;
                  return (
                    <button
                      key={digit}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => setBarrier(digit)}
                      className={`h-11 w-11 shrink-0 rounded-lg font-mono text-sm disabled:opacity-30 ${
                        selected ? "bg-accent text-accent-ink" : "border border-line hover:bg-inset"
                      }`}
                    >
                      {digit}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <p className="text-sm text-muted">{KIND_HELP[kind]}</p>
            <ContractStats signal={active} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={arm}
                disabled={!last || armed}
                className="h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              >
                {armed ? `${active.label} armed` : `Arm ${active.label}`}
              </button>
              <p className="text-sm text-muted">
                {armed
                  ? "Waiting for the next tick."
                  : "The arm settles once, on the following tick, then keeps a private score on this device."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SignalList
              title="Momentum lens"
              copy="Highest z-scores in this window. The hot side of the recent tape. Not a forecast."
              signals={signals.momentum}
              active={active}
              onLoad={load}
            />
            <SignalList
              title="Reversion lens"
              copy="Lowest z-scores. The cold side, if you believe the wheel should fall back toward fair. Also not a forecast."
              signals={signals.reversion}
              active={active}
              onLoad={load}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <OverUnderTable analysis={analysis} active={active} onLoad={load} />
            <MatchTable analysis={analysis} onLoad={load} />
          </div>
        </section>

        <section id="depth" className="section grid gap-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Stat
              title="Parity runs"
              value={`z ${formatZ(analysis.parityRuns.z)}`}
              note={`${analysis.parityRuns.runs} runs, expected ${analysis.parityRuns.expected.toFixed(1)}. ${runsRead(analysis.parityRuns.z)} Negative z means longer even/odd streaks.`}
            />
            <Stat
              title="Direction runs"
              value={`z ${formatZ(analysis.dirRuns.z)}`}
              note={`${analysis.dirRuns.runs} rise/fall runs, expected ${analysis.dirRuns.expected.toFixed(1)}. ${runsRead(analysis.dirRuns.z)}`}
            />
            <Stat
              title="Lag-1 echo"
              value={analysis.digitAc1.toFixed(2)}
              note={`Digit series: ${acRead(analysis.digitAc1)} Direction series ${analysis.dirAc1.toFixed(2)}: ${acRead(analysis.dirAc1)}`}
            />
          </div>
          <div className="panel">
            <h2 className="text-lg font-medium">Digit handoffs</h2>
            <p className="mt-1 text-sm text-muted">
              Rows are the previous last digit, columns the next. A sage outline marks a cell at least 1.8× its row’s even
              share, with 3 or more hits.
            </p>
            <Heatmap analysis={analysis} />
            <Trigrams analysis={analysis} />
          </div>
        </section>

        <section id="journal" className="section panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-medium">Forward score</h2>
              <p className="mt-1 text-sm text-muted">
                {wins} {wins === 1 ? "win" : "wins"}, {losses} {losses === 1 ? "loss" : "losses"}
                {settled.length ? `, hit rate ${formatPct(wins / settled.length)}` : ""}. Illustrative P/L at the stake
                below: <span className="font-mono tabular-nums">{formatMoney(net)}</span>. Saved on this device only.
              </p>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-sm text-muted">
                Stake
                <input
                  inputMode="decimal"
                  value={Number.isFinite(stake) ? String(stake) : ""}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 0 && next <= 100000) setStake(next);
                  }}
                  className="h-11 w-28 rounded-lg border border-line bg-inset px-3 font-mono text-sm text-ink"
                />
              </label>
              <button
                type="button"
                onClick={() => setWatches([])}
                className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-inset"
              >
                Clear score
              </button>
            </div>
          </div>
          {watches.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No armed ticks yet. Choose a contract and arm the next tick.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Index</th>
                    <th className="py-2 pr-3 font-medium">Contract</th>
                    <th className="py-2 pr-3 font-medium">From</th>
                    <th className="py-2 pr-3 font-medium">Next</th>
                    <th className="py-2 pr-3 font-medium">Result</th>
                    <th className="py-2 font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {watches.map((watch) => {
                    const result = pnl(watch, stake);
                    return (
                      <tr key={watch.id} className="border-t border-line">
                        <td className="py-2 pr-3 font-mono text-xs tabular-nums">{clock(watch.placedAt)}</td>
                        <td className="py-2 pr-3">{watch.marketName}</td>
                        <td className="py-2 pr-3">{watch.label}</td>
                        <td className="py-2 pr-3 font-mono tabular-nums">
                          {watch.entryDigit} · {formatPrice(watch.entryPrice, getMarket(watch.symbol).pip)}
                        </td>
                        <td className="py-2 pr-3 font-mono tabular-nums">
                          {watch.exitDigit === undefined ? "—" : `${watch.exitDigit}`}
                        </td>
                        <td className={`py-2 pr-3 capitalize ${watch.status === "win" ? "text-rise" : watch.status === "loss" ? "text-fall" : "text-muted"}`}>
                          {watch.status}
                        </td>
                        <td className={`py-2 font-mono tabular-nums ${result !== null && result > 0 ? "text-rise" : result !== null && result < 0 ? "text-fall" : "text-muted"}`}>
                          {result === null ? "—" : formatMoney(result)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="pb-8 text-sm text-muted">
          Index Insight is not affiliated with Deriv and does not place trades. When the stream connects, quotes come from
          Deriv’s public tick feed. Rise/Fall, Even/Odd, Over/Under, and Matches/Differs are read the way those one-tick
          contracts settle. Volatility indices are built so digits stay close to uniform and ticks stay close to
          independent. A hot digit in a short window is a description of the past, not a prediction. Nothing here is a
          recommendation to trade.
        </footer>
      </div>
    </main>
  );
}

function directionRibbon(ticks: Tick[]): string {
  const signs: string[] = [];
  const slice = ticks.slice(-48);
  for (let i = 1; i < slice.length; i++) {
    const delta = slice[i].price - slice[i - 1].price;
    signs.push(delta > 0 ? "+" : delta < 0 ? "−" : "·");
  }
  return signs.join(" ");
}

function Summary({
  title,
  primary,
  secondary,
  note,
  actions,
}: {
  title: string;
  primary: string;
  secondary: string;
  note: string;
  actions: Array<[string, () => void]>;
}) {
  return (
    <div className="panel flex flex-col gap-3">
      <h2 className="text-sm text-muted">{title}</h2>
      <p className="font-mono text-xl tabular-nums">{primary}</p>
      <p className="text-sm text-muted">{secondary}</p>
      <p className="text-sm text-muted">{note}</p>
      <div className="mt-auto flex flex-wrap gap-2">
        {actions.map(([label, action]) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-inset"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DigitSummary({
  analysis,
  onLoad,
}: {
  analysis: Analysis;
  onLoad: (kind: ContractKind, barrier: number | null) => void;
}) {
  let hot = 0;
  let cold = 0;
  for (let digit = 1; digit < 10; digit++) {
    if (analysis.digitCounts[digit] > analysis.digitCounts[hot]) hot = digit;
    if (analysis.digitCounts[digit] < analysis.digitCounts[cold]) cold = digit;
  }
  return (
    <div className="panel flex flex-col gap-3">
      <h2 className="text-sm text-muted">Matches</h2>
      <p className="font-mono text-xl tabular-nums">
        {hot} hot · {cold} cold
      </p>
      <p className="text-sm text-muted">
        {formatPct(analysis.n ? analysis.digitCounts[hot] / analysis.n : 0)} versus{" "}
        {formatPct(analysis.n ? analysis.digitCounts[cold] / analysis.n : 0)}. Digit {cold} absent{" "}
        {analysis.absence[cold]} ticks. Longest gap {analysis.maxDrought[cold]}.
      </p>
      <div className="mt-auto flex flex-wrap gap-2">
        <button type="button" onClick={() => onLoad("match", hot)} className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-inset">
          Match {hot}
        </button>
        <button type="button" onClick={() => onLoad("differ", hot)} className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-inset">
          Differ {hot}
        </button>
      </div>
    </div>
  );
}

function ContractStats({ signal }: { signal: Signal }) {
  const profit = signal.multiplier - 1;
  const wipe = profit > 0 ? 1 / profit : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="In this window" value={formatPct(signal.observed)} note={`Fair ${formatPct(signal.fair)} · n ${signal.n}`} />
      <Metric label="z versus fair" value={formatZ(signal.z)} note={zLabel(signal.z)} />
      <Metric
        label="Indicative return"
        value={`${signal.multiplier.toFixed(2)}×`}
        note={`One loss erases ${wipe.toFixed(1)} wins at this price.`}
      />
      <Metric
        label="Window expectancy"
        value={formatSignedPct(signal.ev)}
        note="Per stake if this window repeated. A fair wheel is −3.0% at the same price."
      />
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-inset p-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}

function SignalList({
  title,
  copy,
  signals,
  active,
  onLoad,
}: {
  title: string;
  copy: string;
  signals: Signal[];
  active: Signal;
  onLoad: (kind: ContractKind, barrier: number | null) => void;
}) {
  return (
    <div className="panel">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted">{copy}</p>
      <div className="mt-3 grid gap-2">
        {signals.map((signal) => {
          const selected = signal.kind === active.kind && signal.barrier === active.barrier && signal.label === active.label;
          return (
            <button
              key={`${title}-${signal.label}`}
              type="button"
              onClick={() => onLoad(signal.kind, signal.barrier)}
              className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-left ${
                selected ? "bg-accent text-accent-ink" : "bg-inset hover:opacity-90"
              }`}
            >
              <span className="text-sm">{signal.label}</span>
              <span className="font-mono text-sm tabular-nums">
                {formatPct(signal.observed)} · z {formatZ(signal.z)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverUnderTable({
  analysis,
  active,
  onLoad,
}: {
  analysis: Analysis;
  active: Signal;
  onLoad: (kind: ContractKind, barrier: number | null) => void;
}) {
  const rows: Signal[] = [];
  for (let barrier = 0; barrier <= 8; barrier++) rows.push(describeContract("over", barrier, analysis));
  for (let barrier = 1; barrier <= 9; barrier++) rows.push(describeContract("under", barrier, analysis));
  return (
    <div className="panel">
      <h2 className="text-lg font-medium">Over / Under</h2>
      <p className="mt-1 mb-3 text-sm text-muted">Share of last digits strictly past each barrier.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Contract</th>
              <th className="py-2 pr-3 font-medium">Share</th>
              <th className="py-2 pr-3 font-medium">Fair</th>
              <th className="py-2 pr-3 font-medium">Edge</th>
              <th className="py-2 pr-3 font-medium">z</th>
              <th className="py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <td className="py-2 pr-3">{row.label}</td>
                <td className="py-2 pr-3 font-mono tabular-nums">{formatPct(row.observed)}</td>
                <td className="py-2 pr-3 font-mono tabular-nums text-muted">{formatPct(row.fair)}</td>
                <td className="py-2 pr-3 font-mono tabular-nums">{formatSignedPct(row.edge)}</td>
                <td className="py-2 pr-3 font-mono tabular-nums">{formatZ(row.z)}</td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => onLoad(row.kind, row.barrier)}
                    className={`h-11 rounded-lg px-3 text-sm ${
                      active.label === row.label ? "bg-accent text-accent-ink" : "border border-line hover:bg-inset"
                    }`}
                  >
                    Use
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchTable({
  analysis,
  onLoad,
}: {
  analysis: Analysis;
  onLoad: (kind: ContractKind, barrier: number | null) => void;
}) {
  return (
    <div className="panel">
      <h2 className="text-lg font-medium">Matches / Differs</h2>
      <p className="mt-1 mb-3 text-sm text-muted">Fair match rate is 10%. Differ is the other 90%.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Digit</th>
              <th className="py-2 pr-3 font-medium">Share</th>
              <th className="py-2 pr-3 font-medium">Absent</th>
              <th className="py-2 pr-3 font-medium">Gap</th>
              <th className="py-2 pr-3 font-medium">Match z</th>
              <th className="py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {analysis.digitCounts.map((count, digit) => {
              const match = describeContract("match", digit, analysis);
              return (
                <tr key={digit} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono tabular-nums">{digit}</td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {formatPct(analysis.n ? count / analysis.n : 0)}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">{analysis.absence[digit]}</td>
                  <td className="py-2 pr-3 font-mono tabular-nums">{analysis.maxDrought[digit]}</td>
                  <td className="py-2 pr-3 font-mono tabular-nums">{formatZ(match.z)}</td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => onLoad("match", digit)} className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-inset">
                        Match
                      </button>
                      <button type="button" onClick={() => onLoad("differ", digit)} className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-inset">
                        Differ
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="panel">
      <h2 className="text-sm text-muted">{title}</h2>
      <p className="mt-2 font-mono text-xl tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-muted">{note}</p>
    </div>
  );
}

function Heatmap({ analysis }: { analysis: Analysis }) {
  let max = 1;
  for (const row of analysis.transitions) for (const count of row) max = Math.max(max, count);
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="heat-grid">
        <span />
        {Array.from({ length: 10 }, (_, digit) => (
          <span key={`c-${digit}`} className="text-center font-mono text-xs text-muted">
            {digit}
          </span>
        ))}
        {analysis.transitions.map((row, from) => {
          const rowSum = row.reduce((sum, count) => sum + count, 0);
          return (
            <Fragment key={`row-${from}`}>
              <span className="self-center font-mono text-xs text-muted">{from}</span>
              {row.map((count, to) => {
                const expected = rowSum / 10;
                const hot = count >= 3 && expected > 0 && count / expected >= 1.8;
                return (
                  <span
                    key={`${from}-${to}`}
                    title={`${from} then ${to}: ${count}`}
                    className={`rounded-sm py-1 text-center font-mono text-xs tabular-nums ${heatLevel(count, max)} ${hot ? "heat-hot" : ""}`}
                  >
                    {count}
                  </span>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Trigrams({ analysis }: { analysis: Analysis }) {
  if (analysis.trigrams.length === 0) {
    return <p className="mt-4 text-sm text-muted">No 3-digit sequence has printed 3 times in this window.</p>;
  }
  return (
    <div className="mt-4">
      <h3 className="text-sm text-muted">Repeated 3-digit sequences</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {analysis.trigrams.map((row) => (
          <li key={row.seq} className="flex items-center justify-between rounded-lg bg-inset px-3 py-2">
            <span className="font-mono tabular-nums tracking-widest">{row.seq.split("").join(" ")}</span>
            <span className="font-mono text-sm tabular-nums text-muted">
              {row.count}× · {row.lift.toFixed(1)}× fair
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DigitBars({ analysis }: { analysis: Analysis }) {
  const rates = analysis.digitCounts.map((count) => (analysis.n ? (count / analysis.n) * 100 : 0));
  const scale = Math.max(20, ...rates, 10);
  let hot = 0;
  let cold = 0;
  for (let digit = 1; digit < 10; digit++) {
    if (analysis.digitCounts[digit] > analysis.digitCounts[hot]) hot = digit;
    if (analysis.digitCounts[digit] < analysis.digitCounts[cold]) cold = digit;
  }
  return (
    <div className="grid gap-2">
      {rates.map((rate, digit) => {
        const tone = digit === hot ? "bg-rise" : digit === cold ? "bg-fall" : "bg-accent";
        return (
          <div key={digit} className="digit-row">
            <span className="font-mono text-sm tabular-nums">{digit}</span>
            <div className="relative h-2 rounded-full bg-inset">
              <span
                className="absolute top-0 bottom-0 w-px bg-faint"
                style={{ left: `${(10 / scale) * 100}%` }}
                aria-hidden="true"
              />
              <span className={`meter block h-2 rounded-full ${tone}`} style={{ width: `${(rate / scale) * 100}%` }} />
            </div>
            <span className="text-right font-mono text-sm tabular-nums">{rate.toFixed(1)}%</span>
            <span className="text-right font-mono text-xs tabular-nums text-muted">{analysis.digitCounts[digit]}</span>
          </div>
        );
      })}
    </div>
  );
}
