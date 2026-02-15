"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
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
  indicators: Array<Indicator>;
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

interface Indicator {
  id: string;
  category: string;
  categoryLabel: string;
  indicatorName: string;
  description: string;
  severity: string;
  evidence: Record<string, unknown> | null;
  confidence: number;
  recommendedAction: string | null;
  isOverridden: boolean;
  overriddenBy: { id: string; name: string | null } | null;
  overrideJustification: string | null;
  document: {
    id: string;
    fileName: string;
    documentType: string;
  } | null;
  createdAt: string;
}

interface SubmissionDocument {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string | null;
  documentType: string;
  classificationConfidence: number | null;
  extractedData: Record<string, unknown> | null;
  status: string;
  createdAt: string;
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

const DOC_TYPE_LABELS: Record<string, string> = {
  ACORD_125: "ACORD 125",
  ACORD_130: "ACORD 130",
  ACORD_140: "ACORD 140",
  LOSS_RUN: "Loss Run",
  FINANCIAL_STATEMENT: "Financial Statement",
  COI: "Certificate of Insurance",
  ENTITY_DOC: "Entity Document",
  INSPECTION_PHOTO: "Inspection Photo",
  MVR: "Motor Vehicle Report",
  SOV: "Statement of Values",
  SURPLUS_LINES: "Surplus Lines",
  PROFESSIONAL_LICENSE: "Professional License",
  ENVIRONMENTAL_REPORT: "Environmental Report",
  PAYROLL_TAX: "Payroll/Tax Document",
  BROKER_SUBMISSION: "Broker Submission",
  FLEET_SCHEDULE: "Fleet Schedule",
  UNKNOWN: "Unknown",
};

// ─── Helpers ────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/_/g, " ");
}

// ─── Risk Score Gauge (Large) ───────────────────────────

function LargeRiskGauge({
  score,
  severity,
}: {
  score: number;
  severity: string;
}) {
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
    name: d.label
      .replace(" Validation", "")
      .replace(" Analysis", "")
      .replace(" Anomaly", ""),
    points: d.points,
    count: d.count,
    category: d.category,
  }));

  return (
    <ResponsiveContainer width="100%" height={data.length * 48 + 24}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 0, right: 16, top: 4, bottom: 4 }}
      >
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
  );
}

// ─── Indicator Card (with False Positive) ───────────────

function IndicatorCard({
  indicator,
  submissionId,
  onOverrideToggled,
}: {
  indicator: Indicator;
  submissionId: string;
  onOverrideToggled: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showFpModal, setShowFpModal] = useState(false);
  const [fpJustification, setFpJustification] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const sev = SEVERITY_CONFIG[indicator.severity];

  async function handleFalsePositive() {
    if (!fpJustification.trim()) return;
    setFpLoading(true);
    try {
      const res = await fetch(
        `/api/submissions/${submissionId}/indicators/${indicator.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ justification: fpJustification }),
        }
      );
      if (res.ok) {
        setShowFpModal(false);
        setFpJustification("");
        onOverrideToggled();
      }
    } finally {
      setFpLoading(false);
    }
  }

  return (
    <div
      className={`rounded-lg border p-4 ${
        indicator.isOverridden
          ? "border-slate-300 bg-slate-50 opacity-60 dark:border-slate-600 dark:bg-slate-800/50"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Severity indicator */}
        <div className="mt-1 flex flex-col items-center gap-1">
          {sev && (
            <span
              className={`h-3 w-3 rounded-full ${sev.dot}`}
              title={sev.label}
            />
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
            {indicator.isOverridden && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                False Positive
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {indicator.description}
          </p>

          {/* Override info */}
          {indicator.isOverridden && indicator.overriddenBy && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Marked by {indicator.overriddenBy.name ?? "Unknown"}
              {indicator.overrideJustification && (
                <>: &quot;{indicator.overrideJustification}&quot;</>
              )}
            </p>
          )}

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

          {/* Actions row */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Evidence toggle */}
            {indicator.evidence &&
              Object.keys(indicator.evidence).length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {expanded ? "Hide Evidence" : "Show Evidence"}
                </button>
              )}

            {/* False positive button */}
            <button
              type="button"
              onClick={() => setShowFpModal(true)}
              className={`text-xs font-medium ${
                indicator.isOverridden
                  ? "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {indicator.isOverridden
                ? "Undo False Positive"
                : "Mark as False Positive"}
            </button>
          </div>

          {/* Evidence panel */}
          {expanded && indicator.evidence && (
            <div className="mt-2 rounded-md bg-slate-50 p-3 dark:bg-slate-900">
              <EvidenceDisplay evidence={indicator.evidence} />
            </div>
          )}
        </div>
      </div>

      {/* False Positive Modal */}
      {showFpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800" role="dialog" aria-modal="true" aria-label={indicator.isOverridden ? "Undo false positive" : "Mark as false positive"}>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {indicator.isOverridden
                ? "Undo False Positive"
                : "Mark as False Positive"}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {indicator.isOverridden
                ? "Provide a reason for reinstating this indicator."
                : "This indicator will be excluded from the risk score."}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              {indicator.indicatorName}
            </p>
            <textarea
              value={fpJustification}
              onChange={(e) => setFpJustification(e.target.value)}
              placeholder="Justification (required)"
              rows={3}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowFpModal(false);
                  setFpJustification("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFalsePositive}
                disabled={!fpJustification.trim() || fpLoading}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {fpLoading ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document Viewer Tab ─────────────────────────────────

function DocumentViewerTab({
  documents,
}: {
  documents: SubmissionDocument[];
}) {
  const [selectedDocId, setSelectedDocId] = useState<string>(
    documents[0]?.id ?? ""
  );

  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  const isPdf = selectedDoc?.fileType === "application/pdf";
  const isImage = selectedDoc?.fileType?.startsWith("image/");

  // Filter out metadata keys from extracted data
  const extractedFields = selectedDoc?.extractedData
    ? Object.entries(selectedDoc.extractedData).filter(
        ([key]) => key !== "_metadata"
      )
    : [];

  // Get flagged fields from indicators (we detect based on extractedData _metadata)
  const metadata = selectedDoc?.extractedData?._metadata as
    | Record<string, { confidence: number }>
    | undefined;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* Document selector */}
      <div className="border-b border-slate-200 p-4 dark:border-slate-700">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Select Document
        </label>
        <select
          value={selectedDocId}
          onChange={(e) => setSelectedDocId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        >
          {documents.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.fileName} — {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}{" "}
              ({formatFileSize(doc.fileSize)})
            </option>
          ))}
        </select>
      </div>

      {/* Side-by-side layout */}
      {selectedDoc && (
        <div className="flex flex-col lg:flex-row">
          {/* Left panel: Document viewer */}
          <div className="flex-1 border-b border-slate-200 p-4 lg:border-b-0 lg:border-r dark:border-slate-700">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
              Source Document
            </h3>
            {isPdf && selectedDoc.s3Key ? (
              <div className="flex h-[500px] items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                    {selectedDoc.fileName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                    PDF Document — {formatFileSize(selectedDoc.fileSize)}
                  </p>
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    PDF viewing requires S3 pre-signed URL support
                  </p>
                </div>
              </div>
            ) : isImage && selectedDoc.s3Key ? (
              <div className="flex h-[500px] items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                    />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                    {selectedDoc.fileName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                    Image — {formatFileSize(selectedDoc.fileSize)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-[500px] items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                  <svg
                    className="mx-auto h-12 w-12 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                    {selectedDoc.fileName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                    {DOC_TYPE_LABELS[selectedDoc.documentType] ??
                      selectedDoc.documentType}{" "}
                    — {formatFileSize(selectedDoc.fileSize)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Extracted data */}
          <div className="flex-1 p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
              Extracted Data
            </h3>
            {extractedFields.length === 0 ? (
              <div className="flex h-[500px] items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-900">
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  {selectedDoc.status === "ANALYZED"
                    ? "No extracted data available for this document type."
                    : selectedDoc.status === "ERROR"
                      ? "Extraction failed for this document."
                      : "Document has not been processed yet."}
                </p>
              </div>
            ) : (
              <div className="max-h-[500px] space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                {extractedFields.map(([key, value]) => {
                  const fieldMeta = metadata?.[key];
                  const isLowConfidence =
                    fieldMeta && fieldMeta.confidence < 0.5;

                  return (
                    <div
                      key={key}
                      className={`rounded-md border px-3 py-2 ${
                        isLowConfidence
                          ? "border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20"
                          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                      }`}
                    >
                      <dt className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {humanizeKey(key)}
                        {fieldMeta && (
                          <span
                            className={`text-xs ${
                              fieldMeta.confidence >= 0.8
                                ? "text-green-600 dark:text-green-400"
                                : fieldMeta.confidence >= 0.5
                                  ? "text-yellow-600 dark:text-yellow-400"
                                  : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            ({Math.round(fieldMeta.confidence * 100)}%)
                          </span>
                        )}
                      </dt>
                      <dd className="mt-0.5 text-sm text-slate-900 dark:text-slate-200">
                        {typeof value === "object" && value !== null
                          ? Array.isArray(value)
                            ? value.length === 0
                              ? "—"
                              : value.map((item, i) => (
                                  <div
                                    key={i}
                                    className="mt-1 rounded bg-slate-100 p-2 text-xs dark:bg-slate-700"
                                  >
                                    {typeof item === "object" && item !== null
                                      ? Object.entries(
                                          item as Record<string, unknown>
                                        ).map(([k, v]) => (
                                          <div key={k}>
                                            <span className="font-medium">
                                              {humanizeKey(k)}:
                                            </span>{" "}
                                            {String(v ?? "—")}
                                          </div>
                                        ))
                                      : String(item)}
                                  </div>
                                ))
                            : JSON.stringify(value, null, 2)
                          : String(value ?? "—")}
                      </dd>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {documents.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No documents in this submission.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Action Modal ────────────────────────────────────────

function ActionModal({
  action,
  onClose,
  onConfirm,
  loading,
}: {
  action: string;
  onClose: () => void;
  onConfirm: (justification: string, details?: string) => void;
  loading: boolean;
}) {
  const [justification, setJustification] = useState("");
  const [details, setDetails] = useState("");

  const needsJustification = action === "decline";
  const needsDetails = action === "request-info";
  const title =
    action === "approve"
      ? "Approve Submission"
      : action === "decline"
        ? "Decline Submission"
        : action === "request-info"
          ? "Request More Information"
          : "Refer to SIU";

  const actionColor =
    action === "approve"
      ? "bg-green-600 hover:bg-green-700"
      : action === "decline"
        ? "bg-red-600 hover:bg-red-700"
        : action === "request-info"
          ? "bg-orange-600 hover:bg-orange-700"
          : "bg-purple-600 hover:bg-purple-700";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>

        {needsJustification && (
          <>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              A justification is required to decline this submission.
            </p>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Reason for declining (required)"
              rows={3}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            />
          </>
        )}

        {needsDetails && (
          <>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Describe what additional information is needed from the broker.
            </p>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Details of information needed"
              rows={3}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
            />
          </>
        )}

        {!needsJustification && !needsDetails && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Are you sure you want to {action.replace("-", " ")} this submission?
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(justification, details)}
            disabled={
              (needsJustification && !justification.trim()) || loading
            }
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${actionColor}`}
          >
            {loading ? "Processing..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Score Override Modal ────────────────────────────────

function ScoreOverrideModal({
  currentScore,
  submissionId,
  onClose,
  onOverridden,
}: {
  currentScore: number;
  submissionId: string;
  onClose: () => void;
  onOverridden: () => void;
}) {
  const [score, setScore] = useState(String(currentScore));
  const [justification, setJustification] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleOverride() {
    const numScore = parseInt(score, 10);
    if (isNaN(numScore) || numScore < 0 || numScore > 100) {
      setError("Score must be a number between 0 and 100");
      return;
    }
    if (!justification.trim()) {
      setError("Justification is required");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/submissions/${submissionId}/override-score`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: numScore, justification }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to override score");
        return;
      }
      onOverridden();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800" role="dialog" aria-modal="true" aria-label="Override risk score">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          Override Risk Score
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Current score: <span className="font-semibold">{currentScore}</span>.
          Enter a new score and provide justification.
        </p>

        <div className="mt-3">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            New Score (0-100)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          />
        </div>

        <div className="mt-3">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Justification (required)
          </label>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Reason for overriding the risk score"
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
          />
        </div>

        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleOverride}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Override Score"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────

export default function SubmissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const submissionId = params.id as string;

  const [report, setReport] = useState<RiskReport | null>(null);
  const [documents, setDocuments] = useState<SubmissionDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState<"risk" | "documents">("risk");

  // Filter state for indicators
  const [categoryFilter, setCategoryFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [sortBy, setSortBy] = useState<"severity" | "category" | "confidence">(
    "severity"
  );

  // Action modals
  const [actionModal, setActionModal] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showScoreOverride, setShowScoreOverride] = useState(false);

  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const canOverrideScore =
    userRole === "ADMIN" || userRole === "SENIOR_UNDERWRITER";

  const fetchData = useCallback(async () => {
    try {
      const [reportRes, submissionRes] = await Promise.all([
        fetch(`/api/submissions/${submissionId}/risk-report`),
        fetch(`/api/submissions/${submissionId}`),
      ]);

      if (!reportRes.ok) {
        const data = await reportRes.json();
        setError(data.error || "Failed to load risk report.");
        return;
      }

      const reportData = await reportRes.json();
      setReport(reportData.data);

      if (submissionRes.ok) {
        const subData = await submissionRes.json();
        setDocuments(subData.data?.documents ?? []);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Action Handlers ──────────────────────────────────

  async function handleAction(
    action: string,
    justification: string,
    details?: string
  ) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          justification: justification || undefined,
          infoNeededDetails: details || undefined,
        }),
      });
      if (res.ok) {
        setActionModal(null);
        // Refresh data
        setLoading(true);
        fetchData();
      }
    } finally {
      setActionLoading(false);
    }
  }

  // ─── Loading State ──────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center" aria-busy="true">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400" />
      </div>
    );
  }

  // ─── Error State ────────────────────────────────────
  if (error || !report) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/30" role="alert">
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
      return (
        (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
      );
    }
    if (sortBy === "category") {
      return a.categoryLabel.localeCompare(b.categoryLabel);
    }
    return b.confidence - a.confidence;
  });

  const {
    submission,
    riskScore,
    severity,
    categoryBreakdown,
    indicatorCounts,
  } = report;
  const sevConfig = SEVERITY_CONFIG[severity];

  // Can take actions on non-terminal statuses
  const canTakeAction =
    submission.status !== "APPROVED" &&
    submission.status !== "DECLINED";

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
            Submission Detail
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
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300" aria-label={`Status: ${STATUS_LABELS[submission.status] ?? submission.status}`}>
                {STATUS_LABELS[submission.status] ?? submission.status}
              </span>
              <span className="text-xs">
                via {submission.channel.toLowerCase()}
              </span>
            </div>
            {submission.submitter && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Broker:{" "}
                {submission.submitter.name ?? submission.submitter.email}
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

      {/* ─── Tab Navigation ──────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="-mb-px flex gap-6" role="tablist" aria-label="Submission details">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "risk"}
            onClick={() => setActiveTab("risk")}
            className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "risk"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            Risk Report
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "documents"}
            onClick={() => setActiveTab("documents")}
            className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
              activeTab === "documents"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            Documents ({documents.length})
          </button>
        </nav>
      </div>

      {/* ─── Risk Report Tab ─────────────────────────────── */}
      {activeTab === "risk" && (
        <>
          {/* Risk Score Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <LargeRiskGauge score={riskScore} severity={severity} />
              <div className="flex-1">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Risk Summary
                  </h2>
                  {canOverrideScore && (
                    <button
                      type="button"
                      onClick={() => setShowScoreOverride(true)}
                      className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30"
                    >
                      Override Score
                    </button>
                  )}
                </div>
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

          {/* Category Breakdown Bar Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
              Score Breakdown by Category
            </h2>
            <CategoryBreakdownChart data={categoryBreakdown} />
          </div>

          {/* Explainability Section */}
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

          {/* Fraud Indicators List */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Fraud Indicators ({filteredIndicators.length})
              </h2>

              <div className="flex flex-wrap gap-2">
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  aria-label="Filter by severity"
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
                  aria-label="Filter by category"
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
                    setSortBy(
                      e.target.value as "severity" | "category" | "confidence"
                    )
                  }
                  aria-label="Sort indicators"
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
                  <IndicatorCard
                    key={indicator.id}
                    indicator={indicator}
                    submissionId={submissionId}
                    onOverrideToggled={() => {
                      setLoading(true);
                      fetchData();
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Prior Submissions */}
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
                                router.push(
                                  `/dashboard/submissions/${prior.id}`
                                )
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
        </>
      )}

      {/* ─── Documents Tab ───────────────────────────────── */}
      {activeTab === "documents" && (
        <DocumentViewerTab documents={documents} />
      )}

      {/* ─── Action Bar ──────────────────────────────────── */}
      {canTakeAction && (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setActionModal("approve")}
              className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-green-700"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setActionModal("request-info")}
              className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-orange-600"
            >
              Request More Info
            </button>
            <button
              type="button"
              onClick={() => setActionModal("decline")}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => setActionModal("refer-to-siu")}
              className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-purple-700"
            >
              Refer to SIU
            </button>
          </div>
        </div>
      )}

      {/* ─── Modals ──────────────────────────────────────── */}
      {actionModal && (
        <ActionModal
          action={actionModal}
          onClose={() => setActionModal(null)}
          onConfirm={(justification, details) =>
            handleAction(actionModal, justification, details)
          }
          loading={actionLoading}
        />
      )}

      {showScoreOverride && (
        <ScoreOverrideModal
          currentScore={riskScore}
          submissionId={submissionId}
          onClose={() => setShowScoreOverride(false)}
          onOverridden={() => {
            setLoading(true);
            fetchData();
          }}
        />
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
