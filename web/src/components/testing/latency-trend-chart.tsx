"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";

interface TestHistoryEntry {
  id: string;
  health_status: string;
  tested_at: string;
  latency_ms: number;
}

interface LatencyTrendChartProps {
  history: TestHistoryEntry[];
  maxItems?: number;
  height?: number;
  className?: string;
}

export function LatencyTrendChart({
  history,
  maxItems = 20,
  height = 120,
  className,
}: LatencyTrendChartProps) {
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];

    // Take most recent and reverse for chronological order
    return history
      .slice(0, maxItems)
      .reverse()
      .map((entry, idx) => ({
        index: idx,
        latency: entry.latency_ms,
        status: entry.health_status,
        date: new Date(entry.tested_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        time: new Date(entry.tested_at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      }));
  }, [history, maxItems]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return { avg: 0, min: 0, max: 0 };
    const latencies = chartData.map(d => d.latency);
    return {
      avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      min: Math.min(...latencies),
      max: Math.max(...latencies),
    };
  }, [chartData]);

  if (!history || history.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-[120px] text-muted-foreground text-sm", className)}>
        No latency data available
      </div>
    );
  }

  const getGradientColor = () => {
    if (stats.avg < 200) return { start: "#10b981", end: "#10b98120" }; // emerald
    if (stats.avg < 500) return { start: "#f59e0b", end: "#f59e0b20" }; // amber
    return { start: "#ef4444", end: "#ef444420" }; // red
  };

  const gradientColor = getGradientColor();

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Latency Trend</span>
        <div className="flex items-center gap-3">
          <span>Avg: <span className={cn(
            "font-medium",
            stats.avg < 200 ? "text-emerald-600 dark:text-emerald-400" :
            stats.avg < 500 ? "text-amber-600 dark:text-amber-400" :
            "text-red-600 dark:text-red-400"
          )}>{stats.avg}ms</span></span>
          <span>Min: <span className="font-medium text-foreground">{stats.min}ms</span></span>
          <span>Max: <span className="font-medium text-foreground">{stats.max}ms</span></span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={gradientColor.start} stopOpacity={0.3} />
              <stop offset="95%" stopColor={gradientColor.end} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="index"
            tick={false}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: '#888' }}
            tickFormatter={(value) => `${value}ms`}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload[0]) return null;
              const data = payload[0].payload;
              return (
                <div className="bg-popover border rounded-lg shadow-lg p-2 text-xs">
                  <div className="font-medium">{data.date} at {data.time}</div>
                  <div className={cn(
                    "font-mono",
                    data.latency < 200 ? "text-emerald-600" :
                    data.latency < 500 ? "text-amber-600" :
                    "text-red-600"
                  )}>
                    {data.latency}ms
                  </div>
                  <div className={cn(
                    "capitalize",
                    data.status === "healthy" ? "text-emerald-600" : "text-red-600"
                  )}>
                    {data.status}
                  </div>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={200}
            stroke="#10b981"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <ReferenceLine
            y={500}
            stroke="#f59e0b"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="latency"
            stroke={gradientColor.start}
            strokeWidth={2}
            fill="url(#latencyGradient)"
            dot={(props) => {
              const { cx, cy, payload } = props;
              const color = payload.status === "healthy" ? "#10b981" : "#ef4444";
              return (
                <circle
                  key={payload.index}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={color}
                  stroke="white"
                  strokeWidth={1}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-6 h-0.5 bg-emerald-500 border-dashed" style={{ borderTop: "1px dashed #10b981" }} />
          <span>&lt;200ms (fast)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-0.5" style={{ borderTop: "1px dashed #f59e0b" }} />
          <span>&lt;500ms (ok)</span>
        </div>
      </div>
    </div>
  );
}
