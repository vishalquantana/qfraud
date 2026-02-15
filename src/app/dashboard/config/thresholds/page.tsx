"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

// ─── Types ──────────────────────────────────────────────

interface ThresholdConfig {
  id?: string;
  autoApproveBelow: number;
  autoEscalateAbove: number;
  siuReferralOnCritical: boolean;
  updatedAt?: string;
}

interface LobOverride {
  id: string;
  lineOfBusiness: string;
  autoApproveBelow: number;
  autoEscalateAbove: number;
  siuReferralOnCritical: boolean;
  updatedAt: string;
}

interface PreviewData {
  proposedThresholds: {
    autoApproveBelow: number;
    autoEscalateAbove: number;
    siuReferralOnCritical: boolean;
  };
  period: { from: string; to: string };
  totalSubmissions: number;
  changedCount: number;
  currentDistribution: Record<string, number>;
  proposedDistribution: Record<string, number>;
  submissions: Array<{
    submissionId: string;
    insuredName: string;
    lineOfBusiness: string | null;
    riskScore: number | null;
    currentStatus: string;
    proposedStatus: string;
    changed: boolean;
  }>;
}

interface ScoreBucket {
  range: string;
  count: number;
  min: number;
  max: number;
}

// ─── Constants ──────────────────────────────────────────

const LOB_OPTIONS = [
  "Commercial Property",
  "General Liability",
  "Workers Compensation",
  "Commercial Auto",
  "Professional Liability",
  "Umbrella/Excess",
];

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "#22c55e",
  UNDER_REVIEW: "#eab308",
  DECLINED: "#ef4444",
  REFERRED_TO_SIU: "#a855f7",
  PROCESSING: "#3b82f6",
  INFO_NEEDED: "#f97316",
};

const STATUS_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  UNDER_REVIEW: "Under Review",
  DECLINED: "Declined",
  REFERRED_TO_SIU: "Referred to SIU",
  PROCESSING: "Processing",
  INFO_NEEDED: "Info Needed",
};

// ─── Component ──────────────────────────────────────────

export default function ThresholdConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Global thresholds
  const [globalConfig, setGlobalConfig] = useState<ThresholdConfig>({
    autoApproveBelow: 20,
    autoEscalateAbove: 70,
    siuReferralOnCritical: true,
  });
  const [savedGlobal, setSavedGlobal] = useState<ThresholdConfig>({
    autoApproveBelow: 20,
    autoEscalateAbove: 70,
    siuReferralOnCritical: true,
  });

  // Per-LOB overrides
  const [overrides, setOverrides] = useState<LobOverride[]>([]);
  const [addingOverride, setAddingOverride] = useState(false);
  const [newOverrideLob, setNewOverrideLob] = useState("");
  const [newOverrideApprove, setNewOverrideApprove] = useState(20);
  const [newOverrideEscalate, setNewOverrideEscalate] = useState(70);
  const [newOverrideSiu, setNewOverrideSiu] = useState(true);
  const [deletingOverride, setDeletingOverride] = useState<string | null>(null);

  // Preview mode
  const [previewMode, setPreviewMode] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Score distribution
  const [scoreDistribution, setScoreDistribution] = useState<ScoreBucket[]>([]);

  // Save confirmation
  const [showConfirm, setShowConfirm] = useState(false);

  const hasChanges =
    globalConfig.autoApproveBelow !== savedGlobal.autoApproveBelow ||
    globalConfig.autoEscalateAbove !== savedGlobal.autoEscalateAbove ||
    globalConfig.siuReferralOnCritical !== savedGlobal.siuReferralOnCritical;

  // ─── Fetch config ───────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config/thresholds");
      if (!res.ok) throw new Error("Failed to load thresholds");
      const json = await res.json();
      const { global: g, overrides: o } = json.data;
      setGlobalConfig(g);
      setSavedGlobal(g);
      setOverrides(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Fetch score distribution ───────────────────────────

  const fetchScoreDistribution = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/submissions?limit=500&page=1"
      );
      if (!res.ok) return;
      const json = await res.json();
      const submissions: Array<{ riskScore: number | null }> =
        json.data ?? [];

      // Build histogram buckets (0-10, 10-20, ..., 90-100)
      const buckets: ScoreBucket[] = [];
      for (let i = 0; i < 100; i += 10) {
        buckets.push({
          range: `${i}-${i + 10}`,
          count: 0,
          min: i,
          max: i + 10,
        });
      }
      for (const sub of submissions) {
        const score = sub.riskScore ?? 0;
        const idx = Math.min(Math.floor(score / 10), 9);
        buckets[idx].count++;
      }
      setScoreDistribution(buckets);
    } catch {
      // Non-critical, skip
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchScoreDistribution();
  }, [fetchConfig, fetchScoreDistribution]);

  // ─── Preview ────────────────────────────────────────────

  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({
        autoApproveBelow: globalConfig.autoApproveBelow.toString(),
        autoEscalateAbove: globalConfig.autoEscalateAbove.toString(),
        siuReferralOnCritical: globalConfig.siuReferralOnCritical.toString(),
      });
      const res = await fetch(
        `/api/config/thresholds/preview?${params}`
      );
      if (!res.ok) throw new Error("Failed to fetch preview");
      const json = await res.json();
      setPreviewData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [globalConfig]);

  useEffect(() => {
    if (previewMode) {
      fetchPreview();
    } else {
      setPreviewData(null);
    }
  }, [previewMode, fetchPreview]);

  // ─── Save global thresholds ─────────────────────────────

  const saveGlobal = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/config/thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoApproveBelow: globalConfig.autoApproveBelow,
          autoEscalateAbove: globalConfig.autoEscalateAbove,
          siuReferralOnCritical: globalConfig.siuReferralOnCritical,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to save");
      }
      const json = await res.json();
      setSavedGlobal(json.data);
      setGlobalConfig(json.data);
      setSuccess("Global thresholds saved successfully");
      setShowConfirm(false);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ─── Add LOB override ──────────────────────────────────

  const addOverride = async () => {
    if (!newOverrideLob) return;
    if (newOverrideApprove >= newOverrideEscalate) {
      setError("Auto-approve threshold must be less than escalation threshold");
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/config/thresholds/${encodeURIComponent(newOverrideLob)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            autoApproveBelow: newOverrideApprove,
            autoEscalateAbove: newOverrideEscalate,
            siuReferralOnCritical: newOverrideSiu,
          }),
        }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to add override");
      }
      await fetchConfig();
      setAddingOverride(false);
      setNewOverrideLob("");
      setNewOverrideApprove(20);
      setNewOverrideEscalate(70);
      setNewOverrideSiu(true);
      setSuccess("Line of business override added");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    }
  };

  // ─── Delete LOB override ───────────────────────────────

  const deleteOverride = async (lob: string) => {
    setDeletingOverride(lob);
    setError(null);
    try {
      const res = await fetch(
        `/api/config/thresholds/${encodeURIComponent(lob)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to delete override");
      }
      await fetchConfig();
      setSuccess(`Override for "${lob}" removed`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeletingOverride(null);
    }
  };

  // ─── Score bucket color based on thresholds ─────────────

  const getBucketColor = (bucket: ScoreBucket) => {
    if (bucket.max <= globalConfig.autoApproveBelow) return "#22c55e";
    if (bucket.min >= globalConfig.autoEscalateAbove) return "#ef4444";
    return "#eab308";
  };

  // Available LOBs for new override (exclude already used)
  const usedLobs = new Set(overrides.map((o) => o.lineOfBusiness));
  const availableLobs = LOB_OPTIONS.filter((l) => !usedLobs.has(l));

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="flex items-center gap-3" aria-busy="true">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          <span className="text-slate-500 dark:text-slate-400">
            Loading thresholds...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Threshold Configuration
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure auto-approve and escalation thresholds for fraud detection
            routing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={previewMode}
              onChange={(e) => setPreviewMode(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:border-slate-600"
            />
            Preview Mode
          </label>
          {hasChanges && (
            <button
              onClick={() => setShowConfirm(true)}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>
      </div>

      {/* ─── Alerts ──────────────────────────────────────── */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {success && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          {success}
        </div>
      )}

      {/* ─── Global Thresholds ───────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Global Thresholds
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          These thresholds apply to all submissions unless overridden by a line
          of business configuration.
        </p>

        <div className="mt-6 space-y-8">
          {/* Auto-Approve Below slider */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Auto-Approve Below
              </label>
              <span className="rounded-md bg-green-100 px-2.5 py-0.5 text-sm font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-400">
                {globalConfig.autoApproveBelow}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Submissions with a risk score below this value (and no MEDIUM+
              indicators) will be automatically approved.
            </p>
            <input
              type="range"
              min={0}
              max={100}
              value={globalConfig.autoApproveBelow}
              onChange={(e) =>
                setGlobalConfig((prev) => ({
                  ...prev,
                  autoApproveBelow: parseInt(e.target.value, 10),
                }))
              }
              aria-label="Auto-approve threshold"
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-green-600 dark:bg-slate-600"
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>

          {/* Auto-Escalate Above slider */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Auto-Escalate Above
              </label>
              <span className="rounded-md bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-400">
                {globalConfig.autoEscalateAbove}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Submissions with a risk score above this value (or any CRITICAL
              indicator) will be escalated to a senior underwriter.
            </p>
            <input
              type="range"
              min={0}
              max={100}
              value={globalConfig.autoEscalateAbove}
              onChange={(e) =>
                setGlobalConfig((prev) => ({
                  ...prev,
                  autoEscalateAbove: parseInt(e.target.value, 10),
                }))
              }
              aria-label="Auto-escalate threshold"
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-red-600 dark:bg-slate-600"
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>

          {/* SIU Referral Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-600">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                SIU Referral on Critical
              </label>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Automatically refer submissions to SIU when a forged/fabricated
                document indicator is detected.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={globalConfig.siuReferralOnCritical}
              onClick={() =>
                setGlobalConfig((prev) => ({
                  ...prev,
                  siuReferralOnCritical: !prev.siuReferralOnCritical,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                globalConfig.siuReferralOnCritical
                  ? "bg-primary-600"
                  : "bg-slate-300 dark:bg-slate-600"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                  globalConfig.siuReferralOnCritical
                    ? "translate-x-5"
                    : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Threshold validation warning */}
          {globalConfig.autoApproveBelow >= globalConfig.autoEscalateAbove && (
            <div role="alert" className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
              Auto-approve threshold must be less than escalation threshold.
            </div>
          )}
        </div>
      </div>

      {/* ─── Score Distribution Chart ────────────────────── */}
      {scoreDistribution.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Score Distribution
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Distribution of submission risk scores with current threshold
            lines.
          </p>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={scoreDistribution}
                margin={{ left: 0, right: 16, top: 8, bottom: 4 }}
              >
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 11, fill: "currentColor" }}
                  className="text-slate-500 dark:text-slate-400"
                  axisLine={false}
                  tickLine={false}
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
                  formatter={(value: number | undefined) => [
                    `${value ?? 0} submissions`,
                    "Count",
                  ]}
                  cursor={{ fill: "rgba(148, 163, 184, 0.1)" }}
                />
                <ReferenceLine
                  x={`${Math.floor(globalConfig.autoApproveBelow / 10) * 10}-${Math.floor(globalConfig.autoApproveBelow / 10) * 10 + 10}`}
                  stroke="#22c55e"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  label={{
                    value: `Approve: ${globalConfig.autoApproveBelow}`,
                    position: "top",
                    fill: "#22c55e",
                    fontSize: 11,
                  }}
                />
                <ReferenceLine
                  x={`${Math.floor(globalConfig.autoEscalateAbove / 10) * 10}-${Math.floor(globalConfig.autoEscalateAbove / 10) * 10 + 10}`}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  label={{
                    value: `Escalate: ${globalConfig.autoEscalateAbove}`,
                    position: "top",
                    fill: "#ef4444",
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={32}>
                  {scoreDistribution.map((bucket) => (
                    <Cell
                      key={bucket.range}
                      fill={getBucketColor(bucket)}
                      opacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex items-center justify-center gap-6 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-green-500" />
                Auto-Approve
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-yellow-500" />
                Standard Review
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-sm bg-red-500" />
                Escalated
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Preview Mode ────────────────────────────────── */}
      {previewMode && (
        <div className="rounded-xl border-2 border-dashed border-primary-300 bg-primary-50/50 p-6 dark:border-primary-700 dark:bg-primary-900/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Preview: Routing Impact
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                How would the last 30 days of submissions be routed with the
                proposed thresholds?
              </p>
            </div>
            {previewLoading && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            )}
          </div>

          {previewData && !previewLoading && (
            <div className="mt-4 space-y-4">
              {/* Impact summary */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Total Submissions
                  </p>
                  <p className="text-xl font-bold text-slate-900 dark:text-white">
                    {previewData.totalSubmissions}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Would Change
                  </p>
                  <p className="text-xl font-bold text-orange-600">
                    {previewData.changedCount}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Proposed Approved
                  </p>
                  <p className="text-xl font-bold text-green-600">
                    {previewData.proposedDistribution.APPROVED ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Proposed Escalated
                  </p>
                  <p className="text-xl font-bold text-red-600">
                    {previewData.proposedDistribution.UNDER_REVIEW ?? 0}
                  </p>
                </div>
              </div>

              {/* Distribution comparison */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Current Distribution
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(previewData.currentDistribution)
                      .filter(([, count]) => count > 0)
                      .map(([status, count]) => (
                        <div
                          key={status}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor:
                                  STATUS_COLORS[status] ?? "#64748b",
                              }}
                            />
                            <span className="text-sm text-slate-600 dark:text-slate-400">
                              {STATUS_LABELS[status] ?? status}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white">
                            {count}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Proposed Distribution
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(previewData.proposedDistribution)
                      .filter(([, count]) => count > 0)
                      .map(([status, count]) => (
                        <div
                          key={status}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor:
                                  STATUS_COLORS[status] ?? "#64748b",
                              }}
                            />
                            <span className="text-sm text-slate-600 dark:text-slate-400">
                              {STATUS_LABELS[status] ?? status}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-slate-900 dark:text-white">
                            {count}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Changed submissions list */}
              {previewData.changedCount > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Affected Submissions
                  </h3>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Insured
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Score
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Current
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">
                            Proposed
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {previewData.submissions
                          .filter((s) => s.changed)
                          .map((sub) => (
                            <tr
                              key={sub.submissionId}
                              className="bg-white dark:bg-slate-800"
                            >
                              <td className="px-3 py-2 text-slate-900 dark:text-white">
                                {sub.insuredName}
                              </td>
                              <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                                {sub.riskScore ?? "-"}
                              </td>
                              <td className="px-3 py-2">
                                <StatusBadge status={sub.currentStatus} />
                              </td>
                              <td className="px-3 py-2">
                                <StatusBadge status={sub.proposedStatus} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Per-LOB Overrides ────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Line of Business Overrides
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Override global thresholds for specific lines of business.
            </p>
          </div>
          {availableLobs.length > 0 && !addingOverride && (
            <button
              onClick={() => setAddingOverride(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              + Add Override
            </button>
          )}
        </div>

        {/* Existing overrides table */}
        {overrides.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-600 dark:text-slate-400">
                    Line of Business
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-600 dark:text-slate-400">
                    Auto-Approve Below
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-600 dark:text-slate-400">
                    Escalate Above
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-slate-600 dark:text-slate-400">
                    SIU Referral
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-slate-600 dark:text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {overrides.map((o) => (
                  <tr
                    key={o.id}
                    className="bg-white dark:bg-slate-800"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {o.lineOfBusiness}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-400">
                        {o.autoApproveBelow}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-400">
                        {o.autoEscalateAbove}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {o.siuReferralOnCritical ? (
                        <span className="text-green-600 dark:text-green-400">
                          On
                        </span>
                      ) : (
                        <span className="text-slate-400">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteOverride(o.lineOfBusiness)}
                        disabled={deletingOverride === o.lineOfBusiness}
                        className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {deletingOverride === o.lineOfBusiness
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {overrides.length === 0 && !addingOverride && (
          <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">
            No line of business overrides configured. Global thresholds apply to
            all submissions.
          </p>
        )}

        {/* Add override form */}
        {addingOverride && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-900/50">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              New Override
            </h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Line of Business
                </label>
                <select
                  value={newOverrideLob}
                  onChange={(e) => setNewOverrideLob(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Select...</option>
                  {availableLobs.map((lob) => (
                    <option key={lob} value={lob}>
                      {lob}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Auto-Approve Below
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newOverrideApprove}
                    onChange={(e) =>
                      setNewOverrideApprove(parseInt(e.target.value, 10) || 0)
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Escalate Above
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newOverrideEscalate}
                    onChange={(e) =>
                      setNewOverrideEscalate(parseInt(e.target.value, 10) || 0)
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newOverrideSiu}
                  onChange={(e) => setNewOverrideSiu(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:border-slate-600"
                />
                <label className="text-sm text-slate-600 dark:text-slate-400">
                  SIU Referral on Critical
                </label>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={addOverride}
                disabled={!newOverrideLob}
                className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                Add Override
              </button>
              <button
                onClick={() => {
                  setAddingOverride(false);
                  setNewOverrideLob("");
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Save Confirmation Dialog ────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div role="dialog" aria-modal="true" aria-label="Confirm threshold changes" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Confirm Threshold Changes
            </h3>
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                You are about to update the global threshold configuration.
                These changes will affect how future submissions are
                automatically routed.
              </p>

              {/* Impact summary */}
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                <div className="space-y-2 text-sm">
                  {savedGlobal.autoApproveBelow !==
                    globalConfig.autoApproveBelow && (
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Auto-Approve Below</span>
                      <span>
                        <span className="text-slate-400">
                          {savedGlobal.autoApproveBelow}
                        </span>
                        {" → "}
                        <span className="font-medium text-green-600 dark:text-green-400">
                          {globalConfig.autoApproveBelow}
                        </span>
                      </span>
                    </div>
                  )}
                  {savedGlobal.autoEscalateAbove !==
                    globalConfig.autoEscalateAbove && (
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Auto-Escalate Above</span>
                      <span>
                        <span className="text-slate-400">
                          {savedGlobal.autoEscalateAbove}
                        </span>
                        {" → "}
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {globalConfig.autoEscalateAbove}
                        </span>
                      </span>
                    </div>
                  )}
                  {savedGlobal.siuReferralOnCritical !==
                    globalConfig.siuReferralOnCritical && (
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>SIU Referral on Critical</span>
                      <span>
                        <span className="text-slate-400">
                          {savedGlobal.siuReferralOnCritical ? "On" : "Off"}
                        </span>
                        {" → "}
                        <span className="font-medium text-primary-600 dark:text-primary-400">
                          {globalConfig.siuReferralOnCritical ? "On" : "Off"}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                All changes will be recorded in the audit trail.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={saveGlobal}
                disabled={
                  saving ||
                  globalConfig.autoApproveBelow >=
                    globalConfig.autoEscalateAbove
                }
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status Badge component ──────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    APPROVED:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400",
    UNDER_REVIEW:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400",
    DECLINED:
      "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
    REFERRED_TO_SIU:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400",
    PROCESSING:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
    INFO_NEEDED:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400",
  };

  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
