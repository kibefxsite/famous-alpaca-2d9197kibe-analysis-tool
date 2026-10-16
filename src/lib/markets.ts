export type MarketGroup = "1-second" | "Standard";

export type Market = {
  symbol: string;
  name: string;
  group: MarketGroup;
  pip: number;
  intervalMs: number;
  startPrice: number;
  sigma: number;
};

export const MARKETS: Market[] = [
  { symbol: "1HZ10V", name: "Volatility 10 (1s)", group: "1-second", pip: 2, intervalMs: 1000, startPrice: 8654.32, sigma: 0.00018 },
  { symbol: "1HZ25V", name: "Volatility 25 (1s)", group: "1-second", pip: 2, intervalMs: 1000, startPrice: 32418.55, sigma: 0.00042 },
  { symbol: "1HZ50V", name: "Volatility 50 (1s)", group: "1-second", pip: 2, intervalMs: 1000, startPrice: 128440.18, sigma: 0.0008 },
  { symbol: "1HZ75V", name: "Volatility 75 (1s)", group: "1-second", pip: 2, intervalMs: 1000, startPrice: 246812.4, sigma: 0.00115 },
  { symbol: "1HZ100V", name: "Volatility 100 (1s)", group: "1-second", pip: 2, intervalMs: 1000, startPrice: 1842.37, sigma: 0.00155 },
  { symbol: "R_10", name: "Volatility 10 Index", group: "Standard", pip: 3, intervalMs: 2000, startPrice: 6842.418, sigma: 0.00016 },
  { symbol: "R_25", name: "Volatility 25 Index", group: "Standard", pip: 3, intervalMs: 2000, startPrice: 2451.836, sigma: 0.00038 },
  { symbol: "R_50", name: "Volatility 50 Index", group: "Standard", pip: 4, intervalMs: 2000, startPrice: 142.5834, sigma: 0.00072 },
  { symbol: "R_75", name: "Volatility 75 Index", group: "Standard", pip: 4, intervalMs: 2000, startPrice: 98.2216, sigma: 0.00105 },
  { symbol: "R_100", name: "Volatility 100 Index", group: "Standard", pip: 2, intervalMs: 2000, startPrice: 1254.82, sigma: 0.0014 },
];

export const WINDOWS = [25, 50, 100, 250, 500, 1000] as const;
export type WindowSize = (typeof WINDOWS)[number];

const BY_SYMBOL = new Map(MARKETS.map((market) => [market.symbol, market]));

export function getMarket(symbol: string): Market {
  return BY_SYMBOL.get(symbol) ?? MARKETS[4];
}

export function lastDigit(price: number, pip: number): number {
  if (!Number.isFinite(price)) return 0;
  const text = price.toFixed(Math.max(0, pip));
  const ch = text[text.length - 1] ?? "0";
  const digit = Number(ch);
  return Number.isInteger(digit) ? digit : 0;
}

export function formatPrice(price: number, pip: number): string {
  if (!Number.isFinite(price)) return "—";
  const fixed = price.toFixed(Math.max(0, pip));
  const [whole, frac] = fixed.split(".");
  const signed = whole.startsWith("-");
  const digits = signed ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${signed ? "-" : ""}${grouped}`;
  return frac !== undefined ? `${body}.${frac}` : body;
}

export function formatPct(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatZ(z: number): string {
  if (!Number.isFinite(z)) return "0.00";
  const abs = Math.abs(z).toFixed(2);
  if (z > 0) return `+${abs}`;
  if (z < 0) return `-${abs}`;
  return "0.00";
}

export function zTone(z: number): "noise" | "lean" | "wide" {
  const abs = Math.abs(z);
  if (abs >= 1.96) return "wide";
  if (abs >= 1.28) return "lean";
  return "noise";
}

export function zLabel(z: number): string {
  const tone = zTone(z);
  if (tone === "wide") return "Stands out";
  if (tone === "lean") return "Mild lean";
  return "Ordinary noise";
}
