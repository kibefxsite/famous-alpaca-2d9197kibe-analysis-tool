import { lastDigit, type Market } from "@/lib/markets";

export type Tick = {
  price: number;
  epoch: number;
  digit: number;
  pip: number;
  seq: number;
};

function hashSymbol(symbol: string): number {
  let hash = 2166136261;
  for (let i = 0; i < symbol.length; i++) {
    hash ^= symbol.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

export function makeTick(price: number, epoch: number, pip: number, seq: number): Tick {
  return {
    price,
    epoch,
    pip,
    seq,
    digit: lastDigit(price, pip),
  };
}

export function stepPrice(prev: number, market: Market, rand: () => number): number {
  const base = Math.max(prev, market.startPrice * 0.0001);
  const pull = Math.log(market.startPrice / base) * 0.02;
  let next = base * Math.exp(market.sigma * gaussian(rand) + pull);
  if (!Number.isFinite(next) || next <= 0) next = market.startPrice;
  return next;
}

/** Deterministic illustrative tape. Same symbol always yields the same path. */
export function makeTape(market: Market, count: number): Tick[] {
  const rand = mulberry32(hashSymbol(market.symbol) ^ 0x9e3779b9);
  const ticks: Tick[] = [];
  let price = market.startPrice;
  let epoch = 1_700_000_000;
  for (let i = 0; i < count; i++) {
    price = stepPrice(price, market, rand);
    epoch += market.intervalMs / 1000;
    ticks.push(makeTick(price, epoch, market.pip, i + 1));
  }
  return ticks;
}

export function appendStep(ticks: Tick[], market: Market): Tick[] {
  const last = ticks[ticks.length - 1];
  const price = stepPrice(last?.price ?? market.startPrice, market, Math.random);
  const epoch = Math.floor(Date.now() / 1000);
  const seq = (last?.seq ?? 0) + 1;
  const next = makeTick(price, epoch, last?.pip ?? market.pip, seq);
  const merged = [...ticks, next];
  return merged.length > 1500 ? merged.slice(-1500) : merged;
}
