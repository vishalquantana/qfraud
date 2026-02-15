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
  BarChart,
  Bar,
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

interface BrokerStats {
  brokerId: string;
  brokerName: string;
  brokerEmail: string;
  totalSubmissions: number;
  cleanCount: number;
  flaggedCount: number;
  criticalCount: number;
  cleanRate: number;
  flaggedRate: number;
  qualityScore: number;
}

interface BrokerDetail {
  submissions: Array<{
    id: string;
    insuredName: string;
    lineOfBusiness: string | null;
    status: string;
    severity: string | null;
    riskScore: number | null;
    createdAt: string;
  }>;
  flagTypes: Array<{
    category: string;
    severity: string;
    count: number;
  }>;
  trend: Array<{
    month: string;
    total: number;
    clean: number;
    flagged: number;
  }>;
}

interface ComplianceData {
  period: { from: string; to: string };
  antifraudPlan: {
    indicatorChecklist: Array<{ category: string; implemented: boolean }>;
    implementedCount: number;
    totalCategories: number;
    auditTrailCompleteness: number;
    reportingRate: number;
    fraudWarningCompliance: number;
  };
  dataRetention: {
    retentionYears: number;
    totalRecords: number;
    oldestRecord: string | null;
    newestRecord: string | null;
    recordsBeyondRetention: number;
    ageDistribution: Record<string, number>;
  };
  estimatedSavings: {
    criticalFlaggedCount: number;
    declinedCount: number;
    avgFraudLossAmount: number;
    totalEstimatedSavings: number;
  };
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

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "brokers", label: "Broker Quality" },
  { id: "compliance", label: "Compliance" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── CSV Export Helper ──────────────────────────────────

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Component ──────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [range, setRange] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [brokerData, setBrokerData] = useState<BrokerStats[] | null>(null);
  const [brokerDetail, setBrokerDetail] = useState<BrokerDetail | null>(null);
  const [selectedBroker, setSelectedBroker] = useState<BrokerStats | null>(
    null
  );
  const [complianceData, setComplianceData] = useState<ComplianceData | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });

      if (activeTab === "overview") {
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
      } else if (activeTab === "brokers") {
        const res = await fetch(`/api/analytics/brokers?${params}`);
        if (!res.ok) throw new Error("Failed to fetch broker data");
        const json = await res.json();
        setBrokerData(json.data.leaderboard);
        setSelectedBroker(null);
        setBrokerDetail(null);
      } else if (activeTab === "compliance") {
        const res = await fetch(`/api/analytics/compliance?${params}`);
        if (!res.ok) throw new Error("Failed to fetch compliance data");
        const json = await res.json();
        setComplianceData(json.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [range, activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch broker detail when a broker is selected
  const fetchBrokerDetail = useCallback(
    async (broker: BrokerStats) => {
      setSelectedBroker(broker);
      setBrokerDetail(null);
      try {
        const params = new URLSearchParams({
          range,
          brokerId: broker.brokerId,
        });
        const res = await fetch(`/api/analytics/brokers?${params}`);
        if (!res.ok) throw new Error("Failed to fetch broker detail");
        const json = await res.json();
        setBrokerDetail(json.data);
      } catch {
        setBrokerDetail(null);
      }
    },
    [range]
  );

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

      {/* ─── Tabs ──────────────────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-primary-600 text-primary-600 dark:text-primary-400"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {tab.label}
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

      {/* ─── Overview Tab ────────────────────────────────── */}
      {activeTab === "overview" && summary && !loading && (
        <OverviewTab
          summary={summary}
          trends={trends}
          severityPieData={severityPieData}
          formatDuration={formatDuration}
        />
      )}

      {/* ─── Broker Quality Tab ──────────────────────────── */}
      {activeTab === "brokers" && !loading && (
        <BrokerQualityTab
          brokerData={brokerData}
          selectedBroker={selectedBroker}
          brokerDetail={brokerDetail}
          onSelectBroker={fetchBrokerDetail}
          onBack={() => {
            setSelectedBroker(null);
            setBrokerDetail(null);
          }}
        />
      )}

      {/* ─── Compliance Tab ──────────────────────────────── */}
      {activeTab === "compliance" && complianceData && !loading && (
        <ComplianceTab data={complianceData} />
      )}
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────

function OverviewTab({
  summary,
  trends,
  severityPieData,
  formatDuration,
}: {
  summary: SummaryData;
  trends: TrendsData | null;
  severityPieData: Array<{ name: string; value: number; severity: string }>;
  formatDuration: (ms: number) => string;
}) {
  return (
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

      {/* Trend Line Chart */}
      {trends && trends.trends.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Submission Trends
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {trends.granularity === "daily" ? "Daily" : "Weekly"} submission
                volume with flagged vs clean breakdown.
              </p>
            </div>
            <ExportButton
              onClick={() =>
                downloadCSV(
                  "submission-trends.csv",
                  ["Date", "Total", "Flagged", "Clean"],
                  trends.trends.map((t) => [
                    t.date,
                    t.total.toString(),
                    t.flagged.toString(),
                    t.clean.toString(),
                  ])
                )
              }
            />
          </div>
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
                  labelFormatter={(label) => formatDate(String(label))}
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

      {/* Severity Pie + Top Indicators */}
      <div className="grid gap-6 lg:grid-cols-2">
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

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Top Fraud Indicators
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Most frequently triggered indicators.
              </p>
            </div>
            {summary.topIndicators.length > 0 && (
              <ExportButton
                onClick={() =>
                  downloadCSV(
                    "top-indicators.csv",
                    ["Indicator", "Category", "Severity", "Count"],
                    summary.topIndicators.map((ind) => [
                      ind.indicatorName,
                      CATEGORY_LABELS[ind.category] ?? ind.category,
                      SEVERITY_LABELS[ind.severity] ?? ind.severity,
                      ind.count.toString(),
                    ])
                  )
                }
              />
            )}
          </div>

          {summary.topIndicators.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400 dark:text-slate-500">
              No fraud indicators in this period.
            </p>
          ) : (
            <div className="mt-4">
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
                      <tr key={idx} className="bg-white dark:bg-slate-800">
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
  );
}

// ─── Broker Quality Tab ─────────────────────────────────

function BrokerQualityTab({
  brokerData,
  selectedBroker,
  brokerDetail,
  onSelectBroker,
  onBack,
}: {
  brokerData: BrokerStats[] | null;
  selectedBroker: BrokerStats | null;
  brokerDetail: BrokerDetail | null;
  onSelectBroker: (broker: BrokerStats) => void;
  onBack: () => void;
}) {
  // Drill-down view for a single broker
  if (selectedBroker) {
    return (
      <div className="space-y-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Leaderboard
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {selectedBroker.brokerName}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selectedBroker.brokerEmail}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {selectedBroker.qualityScore}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Quality Score
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Total Submissions
              </p>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">
                {selectedBroker.totalSubmissions}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Clean Rate
              </p>
              <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                {selectedBroker.cleanRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Flagged Rate
              </p>
              <p className="text-lg font-semibold text-orange-600 dark:text-orange-400">
                {selectedBroker.flaggedRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Critical Flags
              </p>
              <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                {selectedBroker.criticalCount}
              </p>
            </div>
          </div>
        </div>

        {!brokerDetail && (
          <div className="flex items-center gap-3 py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            <span className="text-slate-500 dark:text-slate-400">
              Loading broker details...
            </span>
          </div>
        )}

        {brokerDetail && (
          <>
            {/* Trend Chart */}
            {brokerDetail.trend.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Submission Trend
                </h3>
                <div className="mt-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={brokerDetail.trend}>
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: "currentColor" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "currentColor" }}
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
                      />
                      <Bar
                        dataKey="clean"
                        stackId="a"
                        fill="#22c55e"
                        name="Clean"
                      />
                      <Bar
                        dataKey="flagged"
                        stackId="a"
                        fill="#ef4444"
                        name="Flagged"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Common Flag Types */}
            {brokerDetail.flagTypes.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Common Flag Types
                </h3>
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                      <tr>
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
                      {brokerDetail.flagTypes.map((ft, idx) => (
                        <tr key={idx} className="bg-white dark:bg-slate-800">
                          <td className="px-3 py-2 text-slate-900 dark:text-white">
                            {CATEGORY_LABELS[ft.category] ?? ft.category}
                          </td>
                          <td className="px-3 py-2">
                            <SeverityBadge severity={ft.severity} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-white">
                            {ft.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Submission History */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Submission History
                </h3>
                {brokerDetail.submissions.length > 0 && (
                  <ExportButton
                    onClick={() =>
                      downloadCSV(
                        `broker-${selectedBroker.brokerName.replace(/\s+/g, "-")}-submissions.csv`,
                        [
                          "Date",
                          "Insured Name",
                          "LOB",
                          "Status",
                          "Severity",
                          "Risk Score",
                        ],
                        brokerDetail.submissions.map((s) => [
                          new Date(s.createdAt).toLocaleDateString(),
                          s.insuredName,
                          s.lineOfBusiness ?? "",
                          s.status,
                          s.severity ?? "N/A",
                          s.riskScore?.toString() ?? "N/A",
                        ])
                      )
                    }
                  />
                )}
              </div>
              {brokerDetail.submissions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">
                  No submissions in this period.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          Insured
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          LOB
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                          Severity
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                          Score
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {brokerDetail.submissions.map((sub) => (
                        <tr
                          key={sub.id}
                          className="bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/50"
                        >
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-400">
                            {new Date(sub.createdAt).toLocaleDateString()}
                          </td>
                          <td className="max-w-[180px] truncate px-3 py-2 font-medium text-slate-900 dark:text-white">
                            {sub.insuredName}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {sub.lineOfBusiness ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={sub.status} />
                          </td>
                          <td className="px-3 py-2">
                            {sub.severity ? (
                              <SeverityBadge severity={sub.severity} />
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900 dark:text-white">
                            {sub.riskScore ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Leaderboard view
  if (!brokerData) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Broker Quality Leaderboard
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Broker performance ranked by submission quality score.
            </p>
          </div>
          {brokerData.length > 0 && (
            <ExportButton
              onClick={() =>
                downloadCSV(
                  "broker-leaderboard.csv",
                  [
                    "Broker Name",
                    "Email",
                    "Total Submissions",
                    "Clean Rate %",
                    "Flagged Rate %",
                    "Critical Flags",
                    "Quality Score",
                  ],
                  brokerData.map((b) => [
                    b.brokerName,
                    b.brokerEmail,
                    b.totalSubmissions.toString(),
                    b.cleanRate.toString(),
                    b.flaggedRate.toString(),
                    b.criticalCount.toString(),
                    b.qualityScore.toString(),
                  ])
                )
              }
            />
          )}
        </div>

        {brokerData.length === 0 ? (
          <p className="mt-6 text-sm text-slate-400 dark:text-slate-500">
            No broker submissions in this period.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                    Broker
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                    Submissions
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                    Clean %
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                    Flagged %
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                    Critical
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">
                    Quality Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {brokerData.map((broker) => (
                  <tr
                    key={broker.brokerId}
                    onClick={() => onSelectBroker(broker)}
                    className="cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/50"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {broker.brokerName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {broker.brokerEmail}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-900 dark:text-white">
                      {broker.totalSubmissions}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-600 dark:text-green-400">
                      {broker.cleanRate}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-orange-600 dark:text-orange-400">
                      {broker.flaggedRate}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-600 dark:text-red-400">
                      {broker.criticalCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <QualityScoreBadge score={broker.qualityScore} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compliance Tab ─────────────────────────────────────

function ComplianceTab({ data }: { data: ComplianceData }) {
  const { antifraudPlan, dataRetention, estimatedSavings } = data;

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Estimated Savings Card */}
      <div className="rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6 shadow-sm dark:border-green-800 dark:from-green-900/20 dark:to-emerald-900/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Estimated Losses Avoided
            </p>
            <p className="mt-1 text-3xl font-bold text-green-800 dark:text-green-300">
              {formatCurrency(estimatedSavings.totalEstimatedSavings)}
            </p>
            <p className="mt-1 text-sm text-green-600 dark:text-green-500">
              Based on {estimatedSavings.criticalFlaggedCount} critical flagged
              submissions x {formatCurrency(estimatedSavings.avgFraudLossAmount)}{" "}
              avg fraud loss
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-green-600 dark:text-green-500">
              <span className="font-semibold">
                {estimatedSavings.declinedCount}
              </span>{" "}
              declined
            </div>
            <div className="text-sm text-green-600 dark:text-green-500">
              <span className="font-semibold">
                {estimatedSavings.criticalFlaggedCount}
              </span>{" "}
              critical flags
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Antifraud Plan Checklist */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Antifraud Plan
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Detection indicator coverage and compliance status.
              </p>
            </div>
            <ExportButton
              onClick={() =>
                downloadCSV(
                  "antifraud-plan.csv",
                  ["Category", "Implemented"],
                  antifraudPlan.indicatorChecklist.map((item) => [
                    CATEGORY_LABELS[item.category] ?? item.category,
                    item.implemented ? "Yes" : "No",
                  ])
                )
              }
            />
          </div>

          {/* Indicator Coverage */}
          <div className="mt-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">
                Indicators Implemented
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {antifraudPlan.implementedCount}/{antifraudPlan.totalCategories}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-primary-600 transition-all"
                style={{
                  width: `${(antifraudPlan.implementedCount / antifraudPlan.totalCategories) * 100}%`,
                }}
              />
            </div>
            <div className="mt-3 space-y-1.5">
              {antifraudPlan.indicatorChecklist.map((item) => (
                <div
                  key={item.category}
                  className="flex items-center gap-2 text-sm"
                >
                  {item.implemented ? (
                    <svg
                      className="h-4 w-4 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4 text-slate-300 dark:text-slate-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <circle cx="12" cy="12" r="9" strokeWidth={2} />
                    </svg>
                  )}
                  <span
                    className={
                      item.implemented
                        ? "text-slate-900 dark:text-white"
                        : "text-slate-400 dark:text-slate-500"
                    }
                  >
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Compliance Metrics */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Compliance Metrics
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Audit trail, reporting, and fraud warning compliance.
          </p>

          <div className="mt-4 space-y-4">
            <ComplianceMeter
              label="Audit Trail Completeness"
              value={antifraudPlan.auditTrailCompleteness}
            />
            <ComplianceMeter
              label="SIU Case Reporting"
              value={antifraudPlan.reportingRate}
            />
            <ComplianceMeter
              label="Fraud Warning Compliance"
              value={antifraudPlan.fraudWarningCompliance}
            />
          </div>
        </div>
      </div>

      {/* Data Retention Status */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Data Retention Status
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Retention policy: {dataRetention.retentionYears} years. Records
          beyond retention will be flagged for purge.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Total Records
            </p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              {dataRetention.totalRecords.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Oldest Record
            </p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              {dataRetention.oldestRecord
                ? new Date(dataRetention.oldestRecord).toLocaleDateString()
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Newest Record
            </p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              {dataRetention.newestRecord
                ? new Date(dataRetention.newestRecord).toLocaleDateString()
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Beyond Retention
            </p>
            <p
              className={`text-lg font-semibold ${dataRetention.recordsBeyondRetention > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
            >
              {dataRetention.recordsBeyondRetention.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Age Distribution */}
        {Object.keys(dataRetention.ageDistribution).length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Records by Year
            </h3>
            <div className="mt-2 flex gap-2">
              {Object.entries(dataRetention.ageDistribution)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([year, count]) => (
                  <div
                    key={year}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {year}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {count}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PROCESSING:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
    UNDER_REVIEW:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400",
    APPROVED:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400",
    DECLINED:
      "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
    INFO_NEEDED:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400",
    REFERRED_TO_SIU:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400",
  };

  const labels: Record<string, string> = {
    PROCESSING: "Processing",
    UNDER_REVIEW: "Under Review",
    APPROVED: "Approved",
    DECLINED: "Declined",
    INFO_NEEDED: "Info Needed",
    REFERRED_TO_SIU: "Referred to SIU",
  };

  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function QualityScoreBadge({ score }: { score: number }) {
  let color: string;
  if (score >= 80) color = "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400";
  else if (score >= 60) color = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400";
  else if (score >= 40) color = "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400";
  else color = "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400";

  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${color}`}
    >
      {score}
    </span>
  );
}

function ComplianceMeter({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  let barColor: string;
  if (value >= 80) barColor = "bg-green-500";
  else if (value >= 50) barColor = "bg-yellow-500";
  else barColor = "bg-red-500";

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="font-semibold text-slate-900 dark:text-white">
          {value}%
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      Export CSV
    </button>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
