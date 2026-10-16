import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { formatPrice } from "@/lib/markets";
import type { Tick } from "@/lib/tape";

export function PriceChart({ ticks }: { ticks: Tick[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const pip = ticks[ticks.length - 1]?.pip ?? 2;
  const data = ticks.slice(-120).map((tick) => ({ price: tick.price }));

  if (!mounted) return <div className="h-28 rounded-lg bg-inset" />;

  return (
    <div className="h-28">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="price"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-line)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const value = payload[0]?.value;
              const price = typeof value === "number" ? value : Number(value);
              if (!Number.isFinite(price)) return null;
              return (
                <div className="rounded-lg border border-line bg-panel px-2 py-1 font-mono text-xs text-ink">
                  {formatPrice(price, pip)}
                </div>
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
