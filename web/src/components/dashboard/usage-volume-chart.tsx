"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  TooltipProps,
} from "recharts";
import { type TimeRange } from "@/lib/api/hooks";

// Chart data point interface
interface ChartDataPoint {
  date: string;
  label: string;
  fullDate: string;
  requests: number;
  errors: number;
}

// Custom tooltip component
function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload as ChartDataPoint | undefined;
  if (!data) return null;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-popover-foreground">{data.fullDate}</p>
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-popover-foreground">
          {data.requests.toLocaleString()}
        </span>{" "}
        requests
      </p>
    </div>
  );
}

// Helper function to aggregate hourly data to daily with full date range
function aggregateHourlyToDaily(
  hourlyData: { hour: string; requests: number; errors: number }[],
  timeRange: TimeRange
): ChartDataPoint[] {
  // For 24h, show hourly data; otherwise show daily
  if (timeRange === "24h") {
    return aggregateHourlyFor24h(hourlyData);
  }

  // Determine number of days based on time range
  const daysMap: Record<TimeRange, number> = {
    "24h": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };
  const numDays = daysMap[timeRange] || 7;

  // Generate date range using LOCAL time (what user perceives as "today")
  const now = new Date();
  const allDates: string[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - i
    );
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    allDates.push(`${year}-${month}-${day}`);
  }

  // Aggregate hourly data by LOCAL date (convert UTC timestamps to local)
  const dailyMap = new Map<string, { requests: number; errors: number }>();
  for (const item of hourlyData) {
    // API returns RFC3339 format like "2026-01-07T00:00:00Z"
    // new Date() parses it as UTC, but getFullYear/Month/Date return LOCAL values
    const utcDate = new Date(item.hour);
    const year = utcDate.getFullYear();
    const month = String(utcDate.getMonth() + 1).padStart(2, "0");
    const day = String(utcDate.getDate()).padStart(2, "0");
    const date = `${year}-${month}-${day}`;

    const existing = dailyMap.get(date) ?? { requests: 0, errors: 0 };
    dailyMap.set(date, {
      requests: existing.requests + item.requests,
      errors: existing.errors + item.errors,
    });
  }

  // Create result with all dates, filling missing with zeros
  return allDates.map((date) => {
    const data = dailyMap.get(date) ?? { requests: 0, errors: 0 };
    const dateObj = new Date(date + "T12:00:00"); // Noon to avoid DST edge cases

    // Format label based on range
    let label: string;
    if (numDays <= 7) {
      label = dateObj.toLocaleDateString("en-US", { weekday: "short" });
    } else {
      label = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const fullDate = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    return {
      date,
      label,
      fullDate,
      requests: data.requests,
      errors: data.errors,
    };
  });
}

// Helper for 24h view - shows hourly buckets
function aggregateHourlyFor24h(
  hourlyData: { hour: string; requests: number; errors: number }[]
): ChartDataPoint[] {
  // Generate 24 hours ending at current LOCAL hour
  const now = new Date();
  const currentHour = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours()
  ).getTime();

  const allHours: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const hourMs = currentHour - (i * 60 * 60 * 1000);
    const hourDate = new Date(hourMs);
    // Format as LOCAL hour key (YYYY-MM-DDTHH)
    const year = hourDate.getFullYear();
    const month = String(hourDate.getMonth() + 1).padStart(2, "0");
    const day = String(hourDate.getDate()).padStart(2, "0");
    const hour = String(hourDate.getHours()).padStart(2, "0");
    allHours.push(`${year}-${month}-${day}T${hour}`);
  }

  // Map hourly data (convert UTC timestamps to local hour keys)
  const hourlyMap = new Map<string, { requests: number; errors: number }>();
  for (const item of hourlyData) {
    // API returns RFC3339 format like "2026-01-07T00:00:00Z"
    // new Date() parses it as UTC, but getFullYear/Month/Date/Hours return LOCAL values
    const utcDate = new Date(item.hour);
    const year = utcDate.getFullYear();
    const month = String(utcDate.getMonth() + 1).padStart(2, "0");
    const day = String(utcDate.getDate()).padStart(2, "0");
    const hour = String(utcDate.getHours()).padStart(2, "0");
    const hourKey = `${year}-${month}-${day}T${hour}`;

    const existing = hourlyMap.get(hourKey) ?? { requests: 0, errors: 0 };
    hourlyMap.set(hourKey, {
      requests: existing.requests + item.requests,
      errors: existing.errors + item.errors,
    });
  }

  // Create result with all hours
  return allHours.map((hourKey) => {
    const data = hourlyMap.get(hourKey) ?? { requests: 0, errors: 0 };
    const [datePart, hourPart] = hourKey.split("T");
    const hourDate = new Date(`${datePart}T${hourPart}:00:00`);

    // Label: show hour in local time (12am, 1pm, etc.)
    const label = hourDate.toLocaleTimeString("en-US", { hour: "numeric" });

    const fullDate = hourDate.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
    });

    return {
      date: hourKey,
      label,
      fullDate,
      requests: data.requests,
      errors: data.errors,
    };
  });
}

// Props interface
interface UsageVolumeChartProps {
  hourlyData: { hour: string; requests: number; errors: number }[] | undefined;
  timeRange: TimeRange;
}

export function UsageVolumeChart({ hourlyData, timeRange }: UsageVolumeChartProps) {
  // Aggregate hourly data to daily for the chart with full date range
  const chartData = useMemo(() => {
    return aggregateHourlyToDaily(hourlyData ?? [], timeRange);
  }, [hourlyData, timeRange]);

  const chartStats = useMemo(() => {
    if (chartData.length === 0) {
      return { totalRequests: 0, peak: 0, average: 0, hasData: false };
    }
    const nonZeroDays = chartData.filter(d => d.requests > 0);
    const totalRequests = chartData.reduce((sum, d) => sum + d.requests, 0);
    const peak = Math.max(...chartData.map(d => d.requests), 0);
    const average = nonZeroDays.length > 0
      ? Math.round(totalRequests / nonZeroDays.length)
      : 0;
    return { totalRequests, peak, average, hasData: totalRequests > 0 };
  }, [chartData]);

  return (
    <div className="space-y-4">
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="requestGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#374151"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)}
              width={45}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="requests"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#requestGradient)"
              dot={chartData.length <= 14 ? {
                fill: "#3b82f6",
                strokeWidth: 2,
                stroke: "#1f2937",
                r: 4,
              } : false}
              activeDot={{
                fill: "#3b82f6",
                strokeWidth: 2,
                stroke: "#1f2937",
                r: 6,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {chartStats.hasData ? (
        <div className="flex justify-between text-sm text-muted-foreground pt-4 border-t">
          <span>Peak: <span className="font-medium text-foreground">{chartStats.peak.toLocaleString()}</span> requests</span>
          <span>Average: <span className="font-medium text-foreground">{chartStats.average.toLocaleString()}</span> requests/day</span>
        </div>
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground pt-4 border-t">
          <Activity className="h-4 w-4 mr-2" />
          No requests recorded in this period
        </div>
      )}
    </div>
  );
}
