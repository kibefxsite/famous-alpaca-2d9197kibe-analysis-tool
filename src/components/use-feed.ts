import { useEffect, useState } from "react";
import { getMarket, type Market } from "@/lib/markets";
import { appendStep, makeTape, makeTick, type Tick } from "@/lib/tape";

export type FeedSource = "sample" | "live" | "sim" | "paused";

const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

type HistoryMessage = {
  msg_type?: string;
  error?: { message?: string };
  pip_size?: number;
  history?: { prices?: unknown[]; times?: unknown[] };
  tick?: { quote?: unknown; epoch?: unknown; pip_size?: number; symbol?: string };
};

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function useFeed(symbol: string) {
  const market = getMarket(symbol);
  const [ticks, setTicks] = useState<Tick[]>(() => makeTape(market, 1000));
  const [source, setSource] = useState<FeedSource>("sample");
  const [series, setSeries] = useState(1);
  const [detail, setDetail] = useState("Illustrative tape, updating while the live stream connects.");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const active: Market = getMarket(symbol);
    let cancelled = false;
    let ws: WebSocket | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let sawLive = false;

    setTicks(makeTape(active, 1000));
    setSource("sample");
    setSeries((value) => value + 1);
    setDetail("Illustrative tape, updating while the live stream connects.");

    const sim = setInterval(() => {
      if (cancelled || sawLive) return;
      setTicks((prev) => appendStep(prev, active));
    }, active.intervalMs);

    const fail = (reason: string) => {
      if (cancelled || sawLive) return;
      setSource("sim");
      setDetail(reason);
    };

    try {
      ws = new WebSocket(WS_URL);
    } catch {
      fail("The live Deriv tick stream is blocked in this browser. The simulated tape keeps the same digit math running.");
      return () => {
        cancelled = true;
        clearInterval(sim);
      };
    }

    openTimer = setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        try {
          ws?.close();
        } catch {
          /* already closing */
        }
        fail("The live Deriv tick stream did not answer. The simulated tape keeps the same digit math running.");
      }
    }, 5000);

    ws.onopen = () => {
      if (openTimer) clearTimeout(openTimer);
      if (cancelled) {
        ws?.close();
        return;
      }
      ws?.send(
        JSON.stringify({
          ticks_history: active.symbol,
          adjust_start_time: 1,
          count: 1000,
          end: "latest",
          start: 1,
          style: "ticks",
          subscribe: 1,
        }),
      );
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      let message: HistoryMessage;
      try {
        message = JSON.parse(String(event.data)) as HistoryMessage;
      } catch {
        return;
      }
      if (message.error) {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        fail("This index did not return a public tick stream. The simulated tape is running in its place.");
        return;
      }
      if (message.msg_type === "history" && message.history?.prices && message.history.times) {
        const pip = message.pip_size ?? active.pip;
        const built: Tick[] = [];
        const prices = message.history.prices;
        const times = message.history.times;
        const size = Math.min(prices.length, times.length);
        for (let i = 0; i < size; i++) {
          const price = asNumber(prices[i]);
          const epoch = asNumber(times[i]);
          if (price === null || epoch === null) continue;
          built.push(makeTick(price, epoch, pip, built.length + 1));
        }
        if (built.length === 0) {
          fail("The tick history came back empty. The simulated tape is running in its place.");
          return;
        }
        sawLive = true;
        clearInterval(sim);
        setSeries((value) => value + 1);
        setTicks(built);
        setSource("live");
        setDetail("Live ticks from the public Deriv stream. No login. The feed can pause if the stream is busy.");
        return;
      }
      if (message.msg_type === "tick" && message.tick && sawLive) {
        if (message.tick.symbol && message.tick.symbol !== active.symbol) return;
        const price = asNumber(message.tick.quote);
        const epoch = asNumber(message.tick.epoch);
        if (price === null || epoch === null) return;
        const pip = message.tick.pip_size ?? active.pip;
        setTicks((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.epoch === epoch) return prev;
          const seq = (last?.seq ?? 0) + 1;
          const merged = [...prev, makeTick(price, epoch, pip, seq)];
          return merged.length > 1500 ? merged.slice(-1500) : merged;
        });
      }
    };

    ws.onerror = () => {
      fail("The live Deriv tick stream is not reachable from this browser. The simulated tape keeps the same digit math running.");
    };

    ws.onclose = () => {
      if (cancelled) return;
      if (sawLive) {
        setSource("paused");
        setDetail("The live feed stopped. Reconnect to try again. The last quotes stay on the desk.");
        return;
      }
      fail("The live Deriv tick stream closed before any quotes arrived. The simulated tape is running.");
    };

    return () => {
      cancelled = true;
      if (openTimer) clearTimeout(openTimer);
      clearInterval(sim);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      }
    };
  }, [symbol, attempt]);

  return {
    ticks,
    source,
    series,
    detail,
    market,
    reconnect: () => setAttempt((value) => value + 1),
  };
}
