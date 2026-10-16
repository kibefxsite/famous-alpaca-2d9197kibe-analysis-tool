import { formatPct, formatZ, zLabel, type Market } from "@/lib/markets";
import type { Tick } from "@/lib/tape";

export type ContractKind = "rise" | "fall" | "even" | "odd" | "over" | "under" | "match" | "differ";

export type RunStat = { runs: number; expected: number; z: number };

export type Analysis = {
  n: number;
  digitCounts: number[];
  even: number;
  odd: number;
  evenZ: number;
  rises: number;
  falls: number;
  flats: number;
  dirN: number;
  riseZ: number;
  longestRise: number;
  longestFall: number;
  longestEven: number;
  longestOdd: number;
  dirStreak: number;
  dirSide: "rise" | "fall" | "flat";
  parityStreak: number;
  paritySide: "even" | "odd";
  absence: number[];
  maxDrought: number[];
  chi2: number;
  chiP: number;
  digitAc1: number;
  dirAc1: number;
  parityRuns: RunStat;
  dirRuns: RunStat;
  transitions: number[][];
  trigrams: { seq: string; count: number; lift: number }[];
  microN: number;
  microCounts: number[];
  microEven: number;
  microRises: number;
  microFalls: number;
  avgUpPips: number;
  avgDownPips: number;
};

export type Signal = {
  kind: ContractKind;
  barrier: number | null;
  label: string;
  fair: number;
  observed: number;
  edge: number;
  z: number;
  multiplier: number;
  ev: number;
  fairEv: number;
  n: number;
};

const HAIRCUT = 0.03;

export function indicativeMultiplier(probability: number): number {
  if (probability <= 0) return 0;
  return Math.round((1 / probability) * (1 - HAIRCUT) * 100) / 100;
}

export function contractLabel(kind: ContractKind, barrier: number | null): string {
  switch (kind) {
    case "rise":
      return "Rise";
    case "fall":
      return "Fall";
    case "even":
      return "Even";
    case "odd":
      return "Odd";
    case "over":
      return `Over ${barrier ?? 0}`;
    case "under":
      return `Under ${barrier ?? 1}`;
    case "match":
      return `Match ${barrier ?? 0}`;
    case "differ":
      return `Differ ${barrier ?? 0}`;
  }
}

export function fairProb(kind: ContractKind, barrier: number | null): number {
  switch (kind) {
    case "rise":
    case "fall":
    case "even":
    case "odd":
      return 0.5;
    case "match":
      return 0.1;
    case "differ":
      return 0.9;
    case "over":
      return Math.max(0, 9 - (barrier ?? 0)) / 10;
    case "under":
      return Math.max(0, barrier ?? 1) / 10;
  }
}

export function needsBarrier(kind: ContractKind): "none" | "over" | "under" | "digit" {
  if (kind === "over") return "over";
  if (kind === "under") return "under";
  if (kind === "match" || kind === "differ") return "digit";
  return "none";
}

export function clampBarrier(kind: ContractKind, barrier: number): number {
  const mode = needsBarrier(kind);
  if (mode === "over") return Math.min(8, Math.max(0, barrier));
  if (mode === "under") return Math.min(9, Math.max(1, barrier));
  if (mode === "digit") return Math.min(9, Math.max(0, barrier));
  return barrier;
}

function logGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = c[0];
  const shifted = z - 1;
  for (let i = 1; i < g + 2; i++) x += c[i] / (shifted + i);
  const t = shifted + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaPSeries(s: number, x: number): number {
  let term = 1 / s;
  let sum = term;
  for (let n = 1; n < 200; n++) {
    term *= x / (s + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

function gammaQContinued(s: number, x: number): number {
  const fpmin = 1e-30;
  let b = x + 1 - s;
  let c = 1 / fpmin;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = b + an / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

function gammaQ(s: number, x: number): number {
  if (x <= 0) return 1;
  if (x < s + 1) return Math.min(1, Math.max(0, 1 - gammaPSeries(s, x)));
  return Math.min(1, Math.max(0, gammaQContinued(s, x)));
}

export function chiSquareSF(x: number, df: number): number {
  if (x <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

function propZ(hits: number, n: number, p0: number): number {
  if (n <= 0) return 0;
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  if (se === 0) return 0;
  return (hits / n - p0) / se;
}

function ac1(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  let mean = 0;
  for (const value of values) mean += value;
  mean /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    den += d * d;
    if (i > 0) num += d * (values[i - 1] - mean);
  }
  return den === 0 ? 0 : num / den;
}

function runsTest(flags: boolean[]): RunStat {
  const n1 = flags.reduce((sum, flag) => sum + (flag ? 1 : 0), 0);
  const n2 = flags.length - n1;
  const n = flags.length;
  if (n1 === 0 || n2 === 0 || n < 2) return { runs: n > 0 ? 1 : 0, expected: 0, z: 0 };
  let runs = 1;
  for (let i = 1; i < n; i++) if (flags[i] !== flags[i - 1]) runs += 1;
  const expected = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const sd = Math.sqrt(Math.max(variance, 0));
  return { runs, expected, z: sd === 0 ? 0 : (runs - expected) / sd };
}

function overHits(counts: number[], barrier: number): number {
  let hits = 0;
  for (let digit = barrier + 1; digit <= 9; digit++) hits += counts[digit] ?? 0;
  return hits;
}

function underHits(counts: number[], barrier: number): number {
  let hits = 0;
  for (let digit = 0; digit < barrier; digit++) hits += counts[digit] ?? 0;
  return hits;
}

function argMax(counts: number[]): number {
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
  return best;
}

export function analyze(ticks: Tick[]): Analysis {
  const n = ticks.length;
  const digitCounts = Array.from({ length: 10 }, () => 0);
  let even = 0;
  let rises = 0;
  let falls = 0;
  let flats = 0;
  let longestRise = 0;
  let longestFall = 0;
  let longestEven = 0;
  let longestOdd = 0;
  let riseRun = 0;
  let fallRun = 0;
  let evenRun = 0;
  let oddRun = 0;
  let upSum = 0;
  let upN = 0;
  let downSum = 0;
  let downN = 0;
  const transitions = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
  const tri = new Map<string, number>();
  const dirs: Array<"rise" | "fall" | "flat"> = [];

  for (let i = 0; i < n; i++) {
    const digit = ticks[i].digit;
    digitCounts[digit] += 1;
    if (digit % 2 === 0) {
      even += 1;
      evenRun += 1;
      oddRun = 0;
      longestEven = Math.max(longestEven, evenRun);
    } else {
      oddRun += 1;
      evenRun = 0;
      longestOdd = Math.max(longestOdd, oddRun);
    }
    if (i > 0) {
      const prev = ticks[i - 1];
      transitions[prev.digit][digit] += 1;
      const delta = ticks[i].price - prev.price;
      const pipScale = 10 ** (ticks[i].pip || prev.pip || 0);
      if (delta > 0) {
        rises += 1;
        riseRun += 1;
        fallRun = 0;
        longestRise = Math.max(longestRise, riseRun);
        upSum += delta * pipScale;
        upN += 1;
        dirs.push("rise");
      } else if (delta < 0) {
        falls += 1;
        fallRun += 1;
        riseRun = 0;
        longestFall = Math.max(longestFall, fallRun);
        downSum += -delta * pipScale;
        downN += 1;
        dirs.push("fall");
      } else {
        flats += 1;
        riseRun = 0;
        fallRun = 0;
        dirs.push("flat");
      }
    }
    if (i >= 2) {
      const key = `${ticks[i - 2].digit}${ticks[i - 1].digit}${digit}`;
      tri.set(key, (tri.get(key) ?? 0) + 1);
    }
  }

  const odd = n - even;
  const dirN = rises + falls;
  let dirStreak = 0;
  let dirSide: Analysis["dirSide"] = "flat";
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (i === dirs.length - 1) dirSide = dirs[i];
    if (dirs[i] !== dirSide) break;
    dirStreak += 1;
  }
  const lastDigitValue = n > 0 ? ticks[n - 1].digit : 0;
  const paritySide: Analysis["paritySide"] = lastDigitValue % 2 === 0 ? "even" : "odd";
  let parityStreak = 0;
  for (let i = n - 1; i >= 0; i--) {
    const side = ticks[i].digit % 2 === 0 ? "even" : "odd";
    if (side !== paritySide) break;
    parityStreak += 1;
  }

  const absence = Array.from({ length: 10 }, () => n);
  const maxDrought = Array.from({ length: 10 }, () => 0);
  const lastSeen = Array.from({ length: 10 }, () => -1);
  for (let i = 0; i < n; i++) {
    const digit = ticks[i].digit;
    const gap = lastSeen[digit] === -1 ? i : i - lastSeen[digit] - 1;
    maxDrought[digit] = Math.max(maxDrought[digit], gap);
    lastSeen[digit] = i;
  }
  for (let digit = 0; digit < 10; digit++) {
    const tail = lastSeen[digit] === -1 ? n : n - 1 - lastSeen[digit];
    absence[digit] = tail;
    maxDrought[digit] = Math.max(maxDrought[digit], tail);
  }

  let chi2 = 0;
  const expected = n / 10;
  if (expected > 0) {
    for (const count of digitCounts) chi2 += (count - expected) ** 2 / expected;
  }

  const microN = Math.min(25, n);
  const microCounts = Array.from({ length: 10 }, () => 0);
  let microEven = 0;
  let microRises = 0;
  let microFalls = 0;
  const micro = ticks.slice(-microN);
  for (let i = 0; i < micro.length; i++) {
    microCounts[micro[i].digit] += 1;
    if (micro[i].digit % 2 === 0) microEven += 1;
    if (i > 0) {
      const delta = micro[i].price - micro[i - 1].price;
      if (delta > 0) microRises += 1;
      else if (delta < 0) microFalls += 1;
    }
  }

  const trigrams = [...tri.entries()]
    .map(([seq, count]) => {
      const trials = Math.max(n - 2, 0);
      const mean = trials / 1000;
      return { seq, count, lift: mean > 0 ? count / mean : 0 };
    })
    .filter((row) => row.count >= 3)
    .sort((a, b) => b.lift - a.lift || b.count - a.count)
    .slice(0, 5);

  const dirFlags = dirs.filter((dir) => dir !== "flat").map((dir) => dir === "rise");

  return {
    n,
    digitCounts,
    even,
    odd,
    evenZ: propZ(even, n, 0.5),
    rises,
    falls,
    flats,
    dirN,
    riseZ: propZ(rises, dirN, 0.5),
    longestRise,
    longestFall,
    longestEven,
    longestOdd,
    dirStreak,
    dirSide,
    parityStreak,
    paritySide,
    absence,
    maxDrought,
    chi2,
    chiP: n > 0 ? chiSquareSF(chi2, 9) : 1,
    digitAc1: ac1(ticks.map((tick) => tick.digit)),
    dirAc1: ac1(dirFlags.map((flag) => (flag ? 1 : -1))),
    parityRuns: runsTest(ticks.map((tick) => tick.digit % 2 === 0)),
    dirRuns: runsTest(dirFlags),
    transitions,
    trigrams,
    microN,
    microCounts,
    microEven,
    microRises,
    microFalls,
    avgUpPips: upN ? upSum / upN : 0,
    avgDownPips: downN ? downSum / downN : 0,
  };
}

export function contractSample(kind: ContractKind, barrier: number | null, analysis: Analysis): { hits: number; n: number } {
  switch (kind) {
    case "rise":
      return { hits: analysis.rises, n: analysis.dirN };
    case "fall":
      return { hits: analysis.falls, n: analysis.dirN };
    case "even":
      return { hits: analysis.even, n: analysis.n };
    case "odd":
      return { hits: analysis.odd, n: analysis.n };
    case "over":
      return { hits: overHits(analysis.digitCounts, barrier ?? 0), n: analysis.n };
    case "under":
      return { hits: underHits(analysis.digitCounts, barrier ?? 1), n: analysis.n };
    case "match":
      return { hits: analysis.digitCounts[barrier ?? 0] ?? 0, n: analysis.n };
    case "differ": {
      const digit = barrier ?? 0;
      return { hits: analysis.n - (analysis.digitCounts[digit] ?? 0), n: analysis.n };
    }
  }
}

export function describeContract(kind: ContractKind, barrier: number | null, analysis: Analysis): Signal {
  const fair = fairProb(kind, clampBarrier(kind, barrier ?? 0));
  const sample = contractSample(kind, barrier, analysis);
  const observed = sample.n ? sample.hits / sample.n : 0;
  const z = propZ(sample.hits, sample.n, fair);
  const multiplier = indicativeMultiplier(fair);
  return {
    kind,
    barrier: needsBarrier(kind) === "none" ? null : clampBarrier(kind, barrier ?? 0),
    label: contractLabel(kind, needsBarrier(kind) === "none" ? null : clampBarrier(kind, barrier ?? 0)),
    fair,
    observed,
    edge: observed - fair,
    z,
    multiplier,
    ev: observed * multiplier - 1,
    fairEv: fair * multiplier - 1,
    n: sample.n,
  };
}

export function rankSignals(analysis: Analysis): { momentum: Signal[]; reversion: Signal[] } {
  const list: Signal[] = [];
  const push = (kind: ContractKind, barrier: number | null) => {
    const signal = describeContract(kind, barrier, analysis);
    if (signal.n >= 20 && signal.fair > 0) list.push(signal);
  };
  push("rise", null);
  push("fall", null);
  push("even", null);
  push("odd", null);
  for (let barrier = 0; barrier <= 8; barrier++) push("over", barrier);
  for (let barrier = 1; barrier <= 9; barrier++) push("under", barrier);
  for (let digit = 0; digit <= 9; digit++) {
    push("match", digit);
    push("differ", digit);
  }
  const momentum = [...list].sort((a, b) => b.z - a.z).slice(0, 4);
  const reversion = [...list].sort((a, b) => a.z - b.z).slice(0, 4);
  return { momentum, reversion };
}

export function readout(analysis: Analysis, market: Market, window: number): string[] {
  if (analysis.n === 0) return ["No ticks in this window yet."];
  const lines: string[] = [];
  const evenRate = analysis.even / analysis.n;
  const paritySide = evenRate >= 0.5 ? "Even" : "Odd";
  const parityRate = Math.max(evenRate, 1 - evenRate);
  const parityZ = evenRate >= 0.5 ? analysis.evenZ : -analysis.evenZ;
  lines.push(
    `${market.name}, last ${analysis.n} ticks of a ${window}-tick window. ${paritySide} is ${formatPct(parityRate)} of last digits, z ${formatZ(parityZ)}. ${zLabel(parityZ)}.`,
  );
  const hot = argMax(analysis.digitCounts);
  let cold = 0;
  for (let digit = 1; digit < 10; digit++) {
    if (analysis.digitCounts[digit] < analysis.digitCounts[cold]) cold = digit;
  }
  lines.push(
    `Digit ${hot} leads at ${formatPct(analysis.digitCounts[hot] / analysis.n)}. Digit ${cold} is quietest at ${formatPct(analysis.digitCounts[cold] / analysis.n)} and last printed ${analysis.absence[cold]} tick${analysis.absence[cold] === 1 ? "" : "s"} ago.`,
  );
  if (analysis.dirN > 0) {
    const side = analysis.dirSide === "flat" ? "flat" : analysis.dirSide;
    lines.push(
      `Rise ${formatPct(analysis.rises / analysis.dirN)}, fall ${formatPct(analysis.falls / analysis.dirN)} across ${analysis.dirN} moves, z ${formatZ(analysis.riseZ)}. Longest rise ${analysis.longestRise}, longest fall ${analysis.longestFall}. The live run is ${analysis.dirStreak} ${side}.`,
    );
  }
  const pText = analysis.chiP < 0.001 ? "< 0.001" : analysis.chiP.toFixed(3);
  lines.push(
    analysis.chiP < 0.05
      ? `The digit wheel looks lopsided in this window: chi-square ${analysis.chi2.toFixed(1)} on 9 degrees of freedom, p ${pText}. A short sample does this by chance. It is not a schedule for the next tick.`
      : `The digit wheel still looks ordinary: chi-square ${analysis.chi2.toFixed(1)} on 9 degrees of freedom, p ${pText}. This window does not reject a fair 0–9 draw.`,
  );
  if (analysis.n > 25 && analysis.microN > 0) {
    const microHot = argMax(analysis.microCounts);
    if (microHot !== hot) {
      lines.push(
        `The last ${analysis.microN} ticks prefer digit ${microHot} (${formatPct(analysis.microCounts[microHot] / analysis.microN)}), not the leader of the full window.`,
      );
    } else {
      lines.push(`The last ${analysis.microN} ticks agree with the full window: digit ${microHot} still leads the short tape.`);
    }
  }
  return lines;
}

export const KIND_HELP: Record<ContractKind, string> = {
  rise: "Wins if the next tick prints strictly above the current spot.",
  fall: "Wins if the next tick prints strictly below the current spot.",
  even: "Wins if the next last digit is 0, 2, 4, 6, or 8.",
  odd: "Wins if the next last digit is 1, 3, 5, 7, or 9.",
  over: "Wins if the next last digit is strictly above the barrier. The barrier itself loses.",
  under: "Wins if the next last digit is strictly below the barrier. The barrier itself loses.",
  match: "Wins only if the next last digit is exactly the one you pick. A fair wheel hits 10% of the time.",
  differ: "Wins if the next last digit is anything except your pick. A fair wheel hits 90% of the time.",
};
