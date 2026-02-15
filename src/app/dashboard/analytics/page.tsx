"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ─── Types ──────────────────────────────────────────────

interface SummaryData {
  period: { from: string; to: string };
  totalSubmissions: number;
  flaggedRate: number;
  autoApprovedRate: number;
  declinedRate: number;
  siuReferralRate: number;
  avgProcessingTimeMs: number;
  statusCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  topIndicators: Array<{
    indicatorName: string;
    severity: string;
    category: string;
    count: number;
  }>;
}

interface TrendPoint {
  date: string;
  total: number;
  flagged: number;
  clean: number;
}

interface TrendsData {
  period: { from: string; to: string };
  granularity: string;
  trends: TrendPoint[];
}

// ─── Constants ──────────────────────────────────────────

const DATE_RANGES = [
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "YTD", value: "ytd" },
] as const;

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#94a3b8",
  CLEAN: "#22c55e",
};

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  CLEAN: "Clean",
};

const CATEGORY_LABELS: Record<string, string> = {
  CROSS_DOC: "Cross-Document",
  FORENSIC: "Forensic",
  STATISTICAL: "Statistical",
  TEMPORAL: "Temporal",
  RATIO: "Financial Ratio",
  ENTITY_INTEL: "Entity Intel",
  VISUAL_AI: "Visual AI",
  NLP: "NLP",
  API_VERIFY: "API Verification",
  RULES: "Rules",
};

// ─── Component ──────────────────────────────────────────

export default function AnalyticsPage() {
  const [range, setRange] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });
      const [summaryRes, trendsRes] = await Promise.all([
        fetch(`/api/analytics/summary?${params}`),
        fetch(`/api/analytics/trends?${params}`),
      ]);

      if (!summaryRes.ok || !trendsRes.ok) {
        throw new Error("Failed to fetch analytics data");
      }

      const [summaryJson, trendsJson] = await Promise.all([
        summaryRes.json(),
        trendsRes.json(),
      ]);

      setSummary(summaryJson.data);
      setTrends(trendsJson.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Format processing time
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return "<1s";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMin = minutes % 60;
    if (hours < 24) return `${hours}h ${remainingMin}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

  // Severity pie chart data
  const severityPieData =
    summary?.severityCounts
      ? Object.entries(summary.severityCounts)
          .filter(([, count]) => count > 0)
          .map(([severity, count]) => ({
            name: SEVERITY_LABELS[severity] ?? severity,
            value: count,
            severity,
          }))
      : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Portfolio Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Submission volume, fraud rates, and processing metrics.
          </p>
        </div>

        {/* Date range selector */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          {DATE_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                range === r.value
                  ? "bg-primary-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Error ───────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ─── Loading ─────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-3 py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          <span className="text-slate-500 dark:text-slate-400">
            Loading analytics...
          </span>
        </div>
      )}

      {/* ─── KPI Cards ───────────────────────────────────── */}
      {summary && !loading && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <KPICard
              label="Total Submissions"
              value={summary.totalSubmissions.toString()}
              color="text-slate-900 dark:text-white"
            />
            <KPICard
              label="Flagged Rate"
              value={`${summary.flaggedRate}%`}
              color="text-orange-600 dark:text-orange-400"
              subtitle={`${Math.round((summary.flaggedRate / 100) * summary.totalSubmissions)} flagged`}
            />
            <KPICard
              label="Auto-Approved"
              value={`${summary.autoApprovedRate}%`}
              color="text-green-600 dark:text-green-400"
              subtitle={`${summary.statusCounts.APPROVED ?? 0} approved`}
            />
            <KPICard
              label="Declined Rate"
              value={`${summary.declinedRate}%`}
              color="text-red-600 dark:text-red-400"
              subtitle={`${summary.statusCounts.DECLINED ?? 0} declined`}
            />
            <KPICard
              label="SIU Referral"
              value={`${summary.siuReferralRate}%`}
              color="text-purple-600 dark:text-purple-400"
              subtitle={`${summary.statusCounts.REFERRED_TO_SIU ?? 0} referred`}
            />
            <KPICard
              label="Avg Processing"
              value={formatDuration(summary.avgProcessingTimeMs)}
              color="text-blue-600 dark:text-blue-400"
            />
          </div>

          {/* ─── Trend Line Chart ────────────────────────── */}
          {trends && trends.trends.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Submission Trends
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {trends.granularity === "daily" ? "Daily" : "Weekly"} submission
                volume with flagged vs clean breakdown.
              </p>
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={trends.trends}
                    margin={{ left: 0, right: 16, top: 8, bottom: 4 }}
                  >
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      className="text-slate-500 dark:text-slate-400"
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: string) => formatDate(v)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      className="text-slate-500 dark:text-slate-400"
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--tooltip-bg, #fff)",
                        border: "1px solid var(--tooltip-border, #e2e8f0)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(label) =>
                        formatDate(String(label))
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      name="Total"
                    />
                    <Line
                      type="monotone"
                      dataKey="flagged"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      name="Flagged"
                    />
                    <Line
                      type="monotone"
                      dataKey="clean"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      name="Clean"
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-3 flex items-center justify-center gap-6 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <div className="h-0.5 w-4 rounded bg-blue-500" />
                    Total
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-0.5 w-4 rounded bg-red-500" />
                    Flagged
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-0.5 w-4 rounded bg-green-500" />
                    Clean
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Severity Pie + Top Indicators ───────────── */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Severity Distribution Pie Chart */}
            {severityPieData.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Severity Distribution
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Breakdown by risk severity level.
                </p>
                <div className="mt-4">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={severityPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {severityPieData.map((entry) => (
                          <Cell
                            key={entry.severity}
                            fill={SEVERITY_COLORS[entry.severity] ?? "#94a3b8"}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--tooltip-bg, #fff)",
                          border: "1px solid var(--tooltip-border, #e2e8f0)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value: number | undefined) => [
                          `${value ?? 0} submissions`,
                          "",
                        ]}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        formatter={(value: string) => (
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {value}
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Top Fraud Indicators */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Top Fraud Indicators
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Most frequently triggered indicators.
              </p>

              {summary.topIndicators.length === 0 ? (
                <p className="mt-6 text-sm text-slate-400 dark:text-slate-500">
                  No fraud indicators in this period.
                </p>
              ) : (
                <div className="mt-4 space-y-0">
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Indicator
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Category
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Severity
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                            Count
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {summary.topIndicators.map((ind, idx) => (
                          <tr
                            key={idx}
                            className="bg-white dark:bg-slate-800"
                          >
                            <td className="max-w-[200px] truncate px-3 py-2 font-medium text-slate-900 dark:text-white">
                              {ind.indicatorName}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                              {CATEGORY_LABELS[ind.category] ?? ind.category}
                            </td>
                            <td className="px-3 py-2">
                              <SeverityBadge severity={ind.severity} />
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-white">
                              {ind.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── KPI Card component ─────────────────────────────────

function KPICard({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: string;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─── Severity Badge component ───────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    CRITICAL:
      "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
    HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400",
    MEDIUM:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400",
    LOW: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
  };

  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles[severity] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}
    >
      {SEVERITY_LABELS[severity] ?? severity}
    </span>
  );
}

// ─── Date formatter ─────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
