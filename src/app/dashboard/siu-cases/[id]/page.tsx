"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

// ─── Types ──────────────────────────────────────────────

interface SIUCaseDetail {
  id: string;
  tenantId: string;
  submissionId: string;
  status: string;
  resolution: string | null;
  notes: NoteEntry[];
  evidence: EvidenceEntry[];
  createdAt: string;
  updatedAt: string;
  submission: {
    id: string;
    insuredName: string;
    lineOfBusiness: string | null;
    riskScore: number | null;
    severity: string | null;
    status: string;
    createdAt: string;
    submitter: { id: string; name: string | null; email: string } | null;
  };
  assignedTo: { id: string; name: string | null; email: string };
  indicators: Indicator[];
  indicatorCount: number;
}

interface NoteEntry {
  userId: string;
  text: string;
  timestamp: string;
}

interface EvidenceEntry {
  type: string;
  url: string;
  description: string;
  timestamp: string;
}

interface Indicator {
  id: string;
  category: string;
  indicatorName: string;
  description: string;
  severity: string;
  evidence: Record<string, unknown> | null;
  confidence: number;
  recommendedAction: string | null;
  isOverridden: boolean;
  overriddenById: string | null;
  overrideJustification: string | null;
  createdAt: string;
}

// ─── Constants ──────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  EVIDENCE_GATHERED: "Evidence Gathered",
  CONFIRMED_FRAUD: "Confirmed Fraud",
  FALSE_POSITIVE: "False Positive",
  INCONCLUSIVE: "Inconclusive",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
  INVESTIGATING:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
  EVIDENCE_GATHERED:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400",
  CONFIRMED_FRAUD:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
  FALSE_POSITIVE:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400",
  INCONCLUSIVE:
    "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
};

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
};

const CATEGORY_LABELS: Record<string, string> = {
  CROSS_DOC: "Cross-Document",
  FORENSIC: "Forensics",
  STATISTICAL: "Statistical",
  TEMPORAL: "Temporal",
  RATIO: "Financial Ratio",
  ENTITY_INTEL: "Entity Intel",
  VISUAL_AI: "Visual AI",
  NLP: "NLP",
  API_VERIFY: "API Verify",
  RULES: "Rules",
};

// SLA timers based on severity (hours)
const SLA_HOURS: Record<string, number> = {
  CRITICAL: 24,
  HIGH: 48,
  MEDIUM: 120, // 5 days
  LOW: 240, // 10 days
};

// Statuses that can transition to other statuses
const TRANSITION_STATUSES: Record<string, string[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["EVIDENCE_GATHERED", "FALSE_POSITIVE", "INCONCLUSIVE"],
  EVIDENCE_GATHERED: ["CONFIRMED_FRAUD", "FALSE_POSITIVE", "INCONCLUSIVE"],
};

// Terminal statuses cannot transition further
const TERMINAL_STATUSES = ["CONFIRMED_FRAUD", "FALSE_POSITIVE", "INCONCLUSIVE"];

// ─── Helpers ────────────────────────────────────────────

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/_/g, " ");
}

function getSlaStatus(
  createdAt: string,
  severity: string | null
): { label: string; color: string; overdue: boolean } {
  const hours = SLA_HOURS[severity ?? "LOW"] ?? 240;
  const created = new Date(createdAt).getTime();
  const deadline = created + hours * 3600 * 1000;
  const now = Date.now();
  const remaining = deadline - now;

  if (remaining <= 0) {
    return { label: "Overdue", color: "text-red-600 dark:text-red-400", overdue: true };
  }

  const hoursLeft = Math.floor(remaining / (3600 * 1000));
  if (hoursLeft < 24) {
    return {
      label: `${hoursLeft}h remaining`,
      color: "text-amber-600 dark:text-amber-400",
      overdue: false,
    };
  }

  const daysLeft = Math.floor(hoursLeft / 24);
  return {
    label: `${daysLeft}d ${hoursLeft % 24}h remaining`,
    color: "text-green-600 dark:text-green-400",
    overdue: false,
  };
}

// ─── Main Component ────────────────────────────────────

export default function SIUCaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.id as string;

  const [caseData, setCaseData] = useState<SIUCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState<
    "indicators" | "evidence" | "timeline" | "notes"
  >("indicators");

  // Status update modal
  const [statusModal, setStatusModal] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);

  // Add note
  const [noteText, setNoteText] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);

  // Add evidence
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evidenceType, setEvidenceType] = useState("document");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  // Indicator filter
  const [indicatorFilter, setIndicatorFilter] = useState<"all" | "active" | "overridden">("all");

  // ─── Fetch case detail ────────────────────────────────

  const fetchCase = useCallback(async () => {
    try {
      const res = await fetch(`/api/siu-cases/${caseId}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load case");
        return;
      }
      const json = await res.json();
      setCaseData(json.data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchCase();
  }, [fetchCase]);

  // ─── Status Update Handler ────────────────────────────

  async function handleStatusUpdate(newStatus: string) {
    const needsResolution =
      newStatus === "CONFIRMED_FRAUD" || newStatus === "FALSE_POSITIVE";
    if (needsResolution && !resolutionText.trim()) return;

    setStatusLoading(true);
    try {
      const body: Record<string, string> = { status: newStatus };
      if (resolutionText.trim()) body.resolution = resolutionText.trim();

      const res = await fetch(`/api/siu-cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setStatusModal(null);
        setResolutionText("");
        setLoading(true);
        fetchCase();
      }
    } finally {
      setStatusLoading(false);
    }
  }

  // ─── Add Note Handler ─────────────────────────────────

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setNoteLoading(true);
    try {
      const res = await fetch(`/api/siu-cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText.trim() }),
      });
      if (res.ok) {
        setNoteText("");
        setLoading(true);
        fetchCase();
      }
    } finally {
      setNoteLoading(false);
    }
  }

  // ─── Add Evidence Handler ─────────────────────────────

  async function handleAddEvidence() {
    if (!evidenceDescription.trim()) return;
    setEvidenceLoading(true);
    try {
      const res = await fetch(`/api/siu-cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidence: {
            type: evidenceType,
            url: evidenceUrl || "",
            description: evidenceDescription.trim(),
          },
        }),
      });
      if (res.ok) {
        setShowEvidenceModal(false);
        setEvidenceType("document");
        setEvidenceUrl("");
        setEvidenceDescription("");
        setLoading(true);
        fetchCase();
      }
    } finally {
      setEvidenceLoading(false);
    }
  }

  // ─── Loading State ────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400" />
      </div>
    );
  }

  // ─── Error State ──────────────────────────────────────

  if (error || !caseData) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/30">
          <p className="text-red-700 dark:text-red-400">
            {error || "Case not found."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard/siu-cases")}
            className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Back to SIU Cases
          </button>
        </div>
      </div>
    );
  }

  const isTerminal = TERMINAL_STATUSES.includes(caseData.status);
  const availableTransitions = TRANSITION_STATUSES[caseData.status] ?? [];
  const sla = getSlaStatus(caseData.createdAt, caseData.submission.severity);
  // Build timeline from notes, evidence, and status changes
  const timelineEntries = buildTimeline(caseData);

  // Filter indicators
  const filteredIndicators =
    indicatorFilter === "all"
      ? caseData.indicators
      : indicatorFilter === "active"
        ? caseData.indicators.filter((i) => !i.isOverridden)
        : caseData.indicators.filter((i) => i.isOverridden);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ─── Breadcrumb & Header ─────────────────────────── */}
      <div>
        <nav className="mb-2 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={() => router.push("/dashboard/siu-cases")}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            SIU Cases
          </button>
          <span>/</span>
          <span className="text-slate-700 dark:text-slate-200">
            Case Detail
          </span>
        </nav>

        {/* Case Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {caseData.submission.insuredName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[caseData.status] ?? "bg-slate-100 text-slate-600"}`}
              >
                {STATUS_LABELS[caseData.status] ?? caseData.status}
              </span>
              {caseData.submission.lineOfBusiness && (
                <span>{caseData.submission.lineOfBusiness}</span>
              )}
              <span>
                Assigned to{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {caseData.assignedTo.name ?? caseData.assignedTo.email}
                </span>
              </span>
            </div>

            {/* SLA Timer */}
            {!isTerminal && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  SLA:
                </span>
                <span className={`font-medium ${sla.color}`}>
                  {sla.overdue ? "Overdue" : sla.label}
                </span>
                {sla.overdue && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/50 dark:text-red-400">
                    Action Required
                  </span>
                )}
              </div>
            )}

            {/* Submission link */}
            <div className="mt-2 flex items-center gap-3 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                Submission:
              </span>
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/dashboard/submissions/${caseData.submission.id}`
                  )
                }
                className="font-mono text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {caseData.submission.id.slice(0, 8)}...
              </button>
              {caseData.submission.riskScore !== null && (
                <span className="text-slate-500 dark:text-slate-400">
                  Risk Score:{" "}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {caseData.submission.riskScore}
                  </span>
                </span>
              )}
              {caseData.submission.severity && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CONFIG[caseData.submission.severity]?.bg ?? ""} ${SEVERITY_CONFIG[caseData.submission.severity]?.color ?? ""}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${SEVERITY_CONFIG[caseData.submission.severity]?.dot ?? ""}`}
                  />
                  {SEVERITY_CONFIG[caseData.submission.severity]?.label ?? caseData.submission.severity}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard/siu-cases")}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Back to Cases
          </button>
        </div>
      </div>

      {/* ─── Resolution Banner ────────────────────────────── */}
      {caseData.resolution && (
        <div
          className={`rounded-xl border p-4 ${
            caseData.status === "CONFIRMED_FRAUD"
              ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
              : caseData.status === "FALSE_POSITIVE"
                ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
          }`}
        >
          <h3
            className={`text-sm font-semibold ${
              caseData.status === "CONFIRMED_FRAUD"
                ? "text-red-700 dark:text-red-400"
                : caseData.status === "FALSE_POSITIVE"
                  ? "text-green-700 dark:text-green-400"
                  : "text-slate-700 dark:text-slate-300"
            }`}
          >
            Resolution — {STATUS_LABELS[caseData.status]}
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            {caseData.resolution}
          </p>
        </div>
      )}

      {/* ─── Tab Navigation ──────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="-mb-px flex gap-6">
          {(
            [
              { key: "indicators", label: "Fraud Indicators", count: caseData.indicatorCount },
              { key: "evidence", label: "Evidence", count: caseData.evidence.length },
              { key: "timeline", label: "Timeline", count: timelineEntries.length },
              { key: "notes", label: "Notes", count: caseData.notes.length },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ─── Indicators Tab ──────────────────────────────── */}
      {activeTab === "indicators" && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex items-center gap-3">
            <select
              value={indicatorFilter}
              onChange={(e) =>
                setIndicatorFilter(
                  e.target.value as "all" | "active" | "overridden"
                )
              }
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            >
              <option value="all">All Indicators ({caseData.indicators.length})</option>
              <option value="active">
                Active ({caseData.indicators.filter((i) => !i.isOverridden).length})
              </option>
              <option value="overridden">
                Overridden ({caseData.indicators.filter((i) => i.isOverridden).length})
              </option>
            </select>
          </div>

          {filteredIndicators.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No indicators match the current filter.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIndicators.map((indicator) => (
                <IndicatorCard key={indicator.id} indicator={indicator} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Evidence Tab ────────────────────────────────── */}
      {activeTab === "evidence" && (
        <div className="space-y-4">
          {/* Upload new evidence button */}
          {!isTerminal && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowEvidenceModal(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              >
                Upload New Evidence
              </button>
            </div>
          )}

          {caseData.evidence.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
              <svg
                className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
              <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
                No evidence collected yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {caseData.evidence.map((ev, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <EvidenceTypeIcon type={ev.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                          {ev.type}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {formatDateTime(ev.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                        {ev.description}
                      </p>
                      {ev.url && (
                        <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                          {ev.url}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Timeline Tab ────────────────────────────────── */}
      {activeTab === "timeline" && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {timelineEntries.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No activity yet.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {timelineEntries.map((entry, idx) => (
                <div key={idx} className="flex gap-4 px-5 py-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-3 w-3 rounded-full ${
                        entry.type === "created"
                          ? "bg-blue-500"
                          : entry.type === "status"
                            ? "bg-purple-500"
                            : entry.type === "note"
                              ? "bg-amber-500"
                              : entry.type === "evidence"
                                ? "bg-green-500"
                                : "bg-slate-400"
                      }`}
                    />
                    {idx < timelineEntries.length - 1 && (
                      <div className="mt-1 w-px flex-1 bg-slate-200 dark:bg-slate-700" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {entry.title}
                      </span>
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {formatDateTime(entry.timestamp)}
                      </span>
                    </div>
                    {entry.description && (
                      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                        {entry.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Notes Tab ───────────────────────────────────── */}
      {activeTab === "notes" && (
        <div className="space-y-4">
          {/* Add note form */}
          {!isTerminal && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Add Investigation Note
              </label>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Markdown supported for formatting.
              </p>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Enter your investigation notes..."
                rows={4}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || noteLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {noteLoading ? "Saving..." : "Add Note"}
                </button>
              </div>
            </div>
          )}

          {caseData.notes.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No investigation notes yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...caseData.notes].reverse().map((note, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {note.userId === "system" ? "System" : note.userId}
                    </span>
                    <span>&middot;</span>
                    <span>{formatDateTime(note.timestamp)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                    {note.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Status Update Buttons ───────────────────────── */}
      {!isTerminal && availableTransitions.length > 0 && (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Update case status:
            </span>
            <div className="flex flex-wrap gap-2">
              {availableTransitions.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusModal(status)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm ${getStatusButtonColor(status)}`}
                >
                  {STATUS_LABELS[status] ?? status}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Status Update Modal ─────────────────────────── */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Update Status: {STATUS_LABELS[statusModal] ?? statusModal}
            </h3>

            {(statusModal === "CONFIRMED_FRAUD" ||
              statusModal === "FALSE_POSITIVE") && (
              <>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {statusModal === "CONFIRMED_FRAUD"
                    ? "Confirm this case as fraud. A resolution summary is required. This will mark all indicators as confirmed."
                    : "Mark this case as a false positive. A resolution summary is required. This will override all fraud indicators."}
                </p>
                <textarea
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="Resolution summary (required)"
                  rows={4}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </>
            )}

            {statusModal === "INCONCLUSIVE" && (
              <>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Mark this investigation as inconclusive. You may optionally
                  provide a resolution summary.
                </p>
                <textarea
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  placeholder="Resolution summary (optional)"
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </>
            )}

            {statusModal !== "CONFIRMED_FRAUD" &&
              statusModal !== "FALSE_POSITIVE" &&
              statusModal !== "INCONCLUSIVE" && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Are you sure you want to change the case status to{" "}
                  <span className="font-medium">{STATUS_LABELS[statusModal]}</span>?
                </p>
              )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setStatusModal(null);
                  setResolutionText("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleStatusUpdate(statusModal)}
                disabled={
                  ((statusModal === "CONFIRMED_FRAUD" ||
                    statusModal === "FALSE_POSITIVE") &&
                    !resolutionText.trim()) ||
                  statusLoading
                }
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${getStatusButtonColor(statusModal)}`}
              >
                {statusLoading ? "Updating..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Evidence Modal ──────────────────────────── */}
      {showEvidenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Upload New Evidence
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Add evidence to support the investigation.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Evidence Type
                </label>
                <select
                  value={evidenceType}
                  onChange={(e) => setEvidenceType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <option value="document">Document</option>
                  <option value="screenshot">Screenshot</option>
                  <option value="external_verification">
                    External Verification
                  </option>
                  <option value="database_record">Database Record</option>
                  <option value="report">Report</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  URL / Reference (optional)
                </label>
                <input
                  type="text"
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                  placeholder="https://... or file reference"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Description (required)
                </label>
                <textarea
                  value={evidenceDescription}
                  onChange={(e) => setEvidenceDescription(e.target.value)}
                  placeholder="Describe this evidence..."
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowEvidenceModal(false);
                  setEvidenceType("document");
                  setEvidenceUrl("");
                  setEvidenceDescription("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddEvidence}
                disabled={!evidenceDescription.trim() || evidenceLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {evidenceLoading ? "Saving..." : "Add Evidence"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function IndicatorCard({ indicator }: { indicator: Indicator }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[indicator.severity];

  return (
    <div
      className={`rounded-xl border p-4 ${
        indicator.isOverridden
          ? "border-slate-300 bg-slate-50 opacity-60 dark:border-slate-600 dark:bg-slate-800/50"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1">
          {sev && (
            <span
              className={`block h-3 w-3 rounded-full ${sev.dot}`}
              title={sev.label}
            />
          )}
        </div>
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
              {CATEGORY_LABELS[indicator.category] ?? indicator.category}
            </span>
            {indicator.isOverridden && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                Overridden
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {indicator.description}
          </p>

          {indicator.overrideJustification && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Override reason: &quot;{indicator.overrideJustification}&quot;
            </p>
          )}

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

          {indicator.evidence &&
            Object.keys(indicator.evidence).length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {expanded ? "Hide Evidence" : "Show Evidence"}
                </button>
                {expanded && (
                  <div className="mt-2 rounded-md bg-slate-50 p-3 dark:bg-slate-900">
                    <dl className="space-y-1.5">
                      {Object.entries(indicator.evidence).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-xs">
                          <dt className="shrink-0 font-medium text-slate-500 dark:text-slate-400">
                            {humanizeKey(key)}:
                          </dt>
                          <dd className="text-slate-700 dark:text-slate-300">
                            {typeof value === "object" && value !== null
                              ? JSON.stringify(value, null, 2)
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function EvidenceTypeIcon({ type }: { type: string }) {
  const iconClass = "h-8 w-8 rounded-lg p-1.5";
  switch (type) {
    case "document":
      return (
        <div className={`${iconClass} bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400`}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
      );
    case "screenshot":
      return (
        <div className={`${iconClass} bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400`}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
        </div>
      );
    case "external_verification":
      return (
        <div className={`${iconClass} bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400`}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        </div>
      );
    default:
      return (
        <div className={`${iconClass} bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400`}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
        </div>
      );
  }
}

// ─── Timeline Builder ───────────────────────────────────

interface TimelineEntry {
  type: "created" | "status" | "note" | "evidence" | "resolution";
  title: string;
  description: string;
  timestamp: string;
}

function buildTimeline(caseData: SIUCaseDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Case created
  entries.push({
    type: "created",
    title: "Case Created",
    description: `SIU case opened for ${caseData.submission.insuredName}. Assigned to ${caseData.assignedTo.name ?? caseData.assignedTo.email}.`,
    timestamp: caseData.createdAt,
  });

  // Notes
  for (const note of caseData.notes) {
    entries.push({
      type: "note",
      title: "Note Added",
      description: note.text.length > 100
        ? note.text.slice(0, 100) + "..."
        : note.text,
      timestamp: note.timestamp,
    });
  }

  // Evidence
  for (const ev of caseData.evidence) {
    entries.push({
      type: "evidence",
      title: `Evidence Uploaded: ${ev.type}`,
      description: ev.description,
      timestamp: ev.timestamp,
    });
  }

  // Resolution (if present)
  if (caseData.resolution) {
    entries.push({
      type: "resolution",
      title: `Case Resolved: ${STATUS_LABELS[caseData.status] ?? caseData.status}`,
      description: caseData.resolution,
      timestamp: caseData.updatedAt,
    });
  }

  // Sort by timestamp descending (most recent first)
  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return entries;
}

// ─── Helper: Status button colors ───────────────────────

function getStatusButtonColor(status: string): string {
  switch (status) {
    case "INVESTIGATING":
      return "bg-amber-600 hover:bg-amber-700";
    case "EVIDENCE_GATHERED":
      return "bg-purple-600 hover:bg-purple-700";
    case "CONFIRMED_FRAUD":
      return "bg-red-600 hover:bg-red-700";
    case "FALSE_POSITIVE":
      return "bg-green-600 hover:bg-green-700";
    case "INCONCLUSIVE":
      return "bg-slate-600 hover:bg-slate-700";
    default:
      return "bg-blue-600 hover:bg-blue-700";
  }
}
