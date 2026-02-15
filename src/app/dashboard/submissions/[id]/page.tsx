"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ─── Types ──────────────────────────────────────────────

interface RiskReport {
  submission: {
    id: string;
    insuredName: string;
    lineOfBusiness: string | null;
    status: string;
    channel: string;
    createdAt: string;
    submitter: { id: string; name: string | null; email: string } | null;
    assignedUnderwriter: {
      id: string;
      name: string | null;
      email: string;
    } | null;
  };
  riskScore: number;
  severity: string;
  categoryBreakdown: Array<{
    category: string;
    label: string;
    count: number;
    points: number;
  }>;
  indicatorCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  indicators: Array<{
    id: string;
    category: string;
    categoryLabel: string;
    indicatorName: string;
    description: string;
    severity: string;
    evidence: Record<string, unknown> | null;
    confidence: number;
    recommendedAction: string | null;
    document: {
      id: string;
      fileName: string;
      documentType: string;
    } | null;
    createdAt: string;
  }>;
  explainability: string;
  priorSubmissions: Array<{
    id: string;
    insuredName: string;
    status: string;
    riskScore: number | null;
    severity: string | null;
    createdAt: string;
  }>;
}

// ─── Config ─────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  string,
  { label: string; color: string; dot: string; bg: string }
> = {
  CRITICAL: {
    label: "Critical",
    color: "text-red-700 dark:text-red-400",
    dot: "bg-red-500",
    bg: "bg-red-100 dark:bg-red-900/50",
  },
  HIGH: {
    label: "High",
    color: "text-orange-700 dark:text-orange-400",
    dot: "bg-orange-500",
    bg: "bg-orange-100 dark:bg-orange-900/50",
  },
  MEDIUM: {
    label: "Medium",
    color: "text-yellow-700 dark:text-yellow-400",
    dot: "bg-yellow-500",
    bg: "bg-yellow-100 dark:bg-yellow-900/50",
  },
  LOW: {
    label: "Low",
    color: "text-slate-600 dark:text-slate-400",
    dot: "bg-slate-400",
    bg: "bg-slate-100 dark:bg-slate-700",
  },
  CLEAN: {
    label: "Clean",
    color: "text-green-700 dark:text-green-400",
    dot: "bg-green-500",
    bg: "bg-green-100 dark:bg-green-900/50",
  },
};

const STATUS_LABELS: Record<string, string> = {
  PROCESSING: "Processing",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  DECLINED: "Declined",
  INFO_NEEDED: "Info Needed",
  REFERRED_TO_SIU: "Referred to SIU",
};

const CATEGORY_COLORS: Record<string, string> = {
  CROSS_DOC: "#3b82f6",
  FORENSIC: "#ef4444",
  STATISTICAL: "#f59e0b",
  TEMPORAL: "#8b5cf6",
  RATIO: "#06b6d4",
  ENTITY_INTEL: "#10b981",
  VISUAL_AI: "#ec4899",
  NLP: "#6366f1",
  API_VERIFY: "#14b8a6",
  RULES: "#64748b",
};

const CATEGORY_FILTER_OPTIONS = [
  { value: "", label: "All Categories" },
  { value: "CROSS_DOC", label: "Cross-Document" },
  { value: "FORENSIC", label: "Forensics" },
  { value: "STATISTICAL", label: "Statistical" },
  { value: "TEMPORAL", label: "Temporal" },
  { value: "RATIO", label: "Financial Ratio" },
  { value: "ENTITY_INTEL", label: "Entity Intel" },
  { value: "VISUAL_AI", label: "Visual AI" },
  { value: "NLP", label: "NLP" },
  { value: "API_VERIFY", label: "API Verify" },
  { value: "RULES", label: "Rules" },
];

// ─── Helpers ────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Risk Score Gauge (Large) ───────────────────────────

function LargeRiskGauge({ score, severity }: { score: number; severity: string }) {
  const strokeColor =
    score >= 85
      ? "#dc2626"
      : score >= 60
        ? "#f97316"
        : score >= 35
          ? "#eab308"
          : "#22c55e";

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const sev = SEVERITY_CONFIG[severity];

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex h-36 w-36 items-center justify-center">
        <svg className="h-36 w-36 -rotate-90" viewBox="0 0 128 128">
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-slate-200 dark:text-slate-700"
          />
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-3xl font-bold text-slate-900 dark:text-white">
            {score}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            / 100
          </span>
        </div>
      </div>
      {sev && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${sev.bg} ${sev.color}`}
        >
          <span className={`h-2 w-2 rounded-full ${sev.dot}`} />
          {sev.label} Risk
        </span>
      )}
    </div>
  );
}

// ─── Category Breakdown Bar Chart ───────────────────────

function CategoryBreakdownChart({
  data,
}: {
  data: RiskReport["categoryBreakdown"];
}) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
        No indicators detected
      </p>
    );
  }

  const chartData = data.map((d) => ({
    name: d.label.replace(" Validation", "").replace(" Analysis", "").replace(" Anomaly", ""),
    points: d.points,
    count: d.count,
    category: d.category,
  }));

  return (
    <ResponsiveContainer width="100%" height={data.length * 48 + 24}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={{ fontSize: 12, fill: "currentColor" }}
          className="text-slate-600 dark:text-slate-400"
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--tooltip-bg, #fff)",
            border: "1px solid var(--tooltip-border, #e2e8f0)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value: number | undefined) => [
            `${value ?? 0} pts`,
            "Score Impact",
          ]}
          cursor={{ fill: "rgba(148, 163, 184, 0.1)" }}
        />
        <Bar dataKey="points" radius={[0, 6, 6, 0]} barSize={24}>
          {chartData.map((entry) => (
            <Cell
              key={entry.category}
              fill={CATEGORY_COLORS[entry.category] ?? "#64748b"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Indicator Card ─────────────────────────────────────

function IndicatorCard({
  indicator,
}: {
  indicator: RiskReport["indicators"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[indicator.severity];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        {/* Severity indicator */}
        <div className="mt-1 flex flex-col items-center gap-1">
          {sev && (
            <span className={`h-3 w-3 rounded-full ${sev.dot}`} title={sev.label} />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              {indicator.indicatorName}
            </h4>
            {sev && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sev.bg} ${sev.color}`}
              >
                {sev.label}
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
              {indicator.categoryLabel}
            </span>
          </div>

          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {indicator.description}
          </p>

          {/* Document reference */}
          {indicator.document && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Source:{" "}
              <span className="font-medium">
                {indicator.document.fileName}
              </span>{" "}
              ({indicator.document.documentType.replace(/_/g, " ")})
            </p>
          )}

          {/* Confidence and action */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              Confidence:{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {Math.round(indicator.confidence * 100)}%
              </span>
            </span>
            {indicator.recommendedAction && (
              <span className="text-slate-500 dark:text-slate-400">
                Recommended:{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {indicator.recommendedAction}
                </span>
              </span>
            )}
          </div>

          {/* Evidence toggle */}
          {indicator.evidence && Object.keys(indicator.evidence).length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {expanded ? "Hide Evidence" : "Show Evidence"}
            </button>
          )}

          {/* Evidence panel */}
          {expanded && indicator.evidence && (
            <div className="mt-2 rounded-md bg-slate-50 p-3 dark:bg-slate-900">
              <EvidenceDisplay evidence={indicator.evidence} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Evidence Display ───────────────────────────────────

function EvidenceDisplay({
  evidence,
}: {
  evidence: Record<string, unknown>;
}) {
  return (
    <dl className="space-y-1.5">
      {Object.entries(evidence).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <dt className="shrink-0 font-medium text-slate-500 dark:text-slate-400">
            {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}:
          </dt>
          <dd className="text-slate-700 dark:text-slate-300">
            {typeof value === "object" && value !== null
              ? JSON.stringify(value, null, 2)
              : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Main Page Component ────────────────────────────────

export default function SubmissionRiskReportPage() {
  const params = useParams();
  const router = useRouter();
  const submissionId = params.id as string;

  const [report, setReport] = useState<RiskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter state for indicators
  const [categoryFilter, setCategoryFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [sortBy, setSortBy] = useState<"severity" | "category" | "confidence">(
    "severity"
  );

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/submissions/${submissionId}/risk-report`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load risk report.");
        return;
      }
      const data = await res.json();
      setReport(data.data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // ─── Loading State ──────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400" />
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────
  if (error || !report) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/30">
          <p className="text-red-700 dark:text-red-400">
            {error || "Risk report not found."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard/triage")}
            className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Back to Triage Board
          </button>
        </div>
      </div>
    );
  }

  // ─── Filter and Sort Indicators ─────────────────────
  const severityOrder: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  let filteredIndicators = report.indicators;
  if (categoryFilter) {
    filteredIndicators = filteredIndicators.filter(
      (i) => i.category === categoryFilter
    );
  }
  if (severityFilter) {
    filteredIndicators = filteredIndicators.filter(
      (i) => i.severity === severityFilter
    );
  }

  filteredIndicators = [...filteredIndicators].sort((a, b) => {
    if (sortBy === "severity") {
      return (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9);
    }
    if (sortBy === "category") {
      return a.categoryLabel.localeCompare(b.categoryLabel);
    }
    return b.confidence - a.confidence;
  });

  const { submission, riskScore, severity, categoryBreakdown, indicatorCounts } =
    report;
  const sevConfig = SEVERITY_CONFIG[severity];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ─── Breadcrumb & Header ─────────────────────────── */}
      <div>
        <nav className="mb-2 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={() => router.push("/dashboard/triage")}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            Triage Board
          </button>
          <span>/</span>
          <span className="text-slate-700 dark:text-slate-200">
            Risk Report
          </span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {submission.insuredName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              {submission.lineOfBusiness && (
                <span>{submission.lineOfBusiness}</span>
              )}
              <span>{formatDate(submission.createdAt)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {STATUS_LABELS[submission.status] ?? submission.status}
              </span>
              <span className="text-xs">
                via {submission.channel.toLowerCase()}
              </span>
            </div>
            {submission.submitter && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Broker: {submission.submitter.name ?? submission.submitter.email}
              </p>
            )}
            {submission.assignedUnderwriter && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Assigned to:{" "}
                {submission.assignedUnderwriter.name ??
                  submission.assignedUnderwriter.email}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard/triage")}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Back to Triage
          </button>
        </div>
      </div>

      {/* ─── Risk Score Section ──────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* Gauge */}
          <LargeRiskGauge score={riskScore} severity={severity} />

          {/* Indicator counts */}
          <div className="flex-1">
            <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
              Risk Summary
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <CountCard
                label="Critical"
                count={indicatorCounts.critical}
                color="text-red-600 dark:text-red-400"
                bg="bg-red-50 dark:bg-red-900/30"
              />
              <CountCard
                label="High"
                count={indicatorCounts.high}
                color="text-orange-600 dark:text-orange-400"
                bg="bg-orange-50 dark:bg-orange-900/30"
              />
              <CountCard
                label="Medium"
                count={indicatorCounts.medium}
                color="text-yellow-600 dark:text-yellow-400"
                bg="bg-yellow-50 dark:bg-yellow-900/30"
              />
              <CountCard
                label="Low"
                count={indicatorCounts.low}
                color="text-slate-600 dark:text-slate-400"
                bg="bg-slate-50 dark:bg-slate-700/50"
              />
              <CountCard
                label="Total"
                count={indicatorCounts.total}
                color="text-blue-600 dark:text-blue-400"
                bg="bg-blue-50 dark:bg-blue-900/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Category Breakdown Bar Chart ────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
          Score Breakdown by Category
        </h2>
        <CategoryBreakdownChart data={categoryBreakdown} />
      </div>

      {/* ─── Explainability Section ──────────────────────── */}
      {report.explainability && (
        <div
          className={`rounded-xl border p-5 ${
            severity === "CRITICAL"
              ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
              : severity === "HIGH"
                ? "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
                : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
          }`}
        >
          <h2
            className={`mb-2 text-sm font-semibold ${
              sevConfig?.color ?? "text-blue-700 dark:text-blue-400"
            }`}
          >
            Risk Assessment Summary
          </h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {report.explainability}
          </p>
        </div>
      )}

      {/* ─── Fraud Indicators List ───────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Fraud Indicators ({filteredIndicators.length})
          </h2>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            >
              <option value="">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            >
              {CATEGORY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "severity" | "category" | "confidence")
              }
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            >
              <option value="severity">Sort by Severity</option>
              <option value="category">Sort by Category</option>
              <option value="confidence">Sort by Confidence</option>
            </select>
          </div>
        </div>

        {filteredIndicators.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
            {report.indicators.length === 0
              ? "No fraud indicators detected for this submission."
              : "No indicators match the current filters."}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredIndicators.map((indicator) => (
              <IndicatorCard key={indicator.id} indicator={indicator} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Prior Submissions (Historical Context) ──────── */}
      {report.priorSubmissions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Prior Submissions from Same Entity
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">
                    Date
                  </th>
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">
                    Insured
                  </th>
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">
                    Status
                  </th>
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">
                    Risk Score
                  </th>
                  <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">
                    Severity
                  </th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {report.priorSubmissions.map((prior) => {
                  const priorSev = prior.severity
                    ? SEVERITY_CONFIG[prior.severity]
                    : null;
                  return (
                    <tr key={prior.id} className="group">
                      <td className="py-2 text-slate-700 dark:text-slate-300">
                        {formatDate(prior.createdAt)}
                      </td>
                      <td className="py-2 text-slate-700 dark:text-slate-300">
                        {prior.insuredName}
                      </td>
                      <td className="py-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {STATUS_LABELS[prior.status] ?? prior.status}
                        </span>
                      </td>
                      <td className="py-2 font-semibold text-slate-700 dark:text-slate-300">
                        {prior.riskScore ?? "—"}
                      </td>
                      <td className="py-2">
                        {priorSev && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${priorSev.bg} ${priorSev.color}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${priorSev.dot}`}
                            />
                            {priorSev.label}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(`/dashboard/submissions/${prior.id}`)
                          }
                          className="text-xs font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-blue-400"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Count Card Sub-component ───────────────────────────

function CountCard({
  label,
  count,
  color,
  bg,
}: {
  label: string;
  count: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-lg p-3 text-center ${bg}`}>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
