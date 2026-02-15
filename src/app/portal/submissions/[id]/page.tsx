"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────

interface DocumentInfo {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  documentType: string;
  classificationConfidence: number | null;
  status: string;
  createdAt: string;
}

interface Submitter {
  id: string;
  name: string | null;
  email: string;
}

interface AssignedUnderwriter {
  id: string;
  name: string | null;
  email: string;
}

interface SubmissionDetail {
  id: string;
  insuredName: string;
  lineOfBusiness: string | null;
  status: string;
  riskScore: number | null;
  severity: string | null;
  channel: string;
  createdAt: string;
  updatedAt: string;
  documents: DocumentInfo[];
  submitter: Submitter | null;
  assignedUnderwriter: AssignedUnderwriter | null;
  _count: { fraudIndicators: number };
}

interface AuditLogEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { name: string | null; email: string } | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  PROCESSING: {
    label: "Processing",
    color: "text-blue-700",
    bgColor: "bg-blue-50 border-blue-200",
  },
  UNDER_REVIEW: {
    label: "Under Review",
    color: "text-yellow-700",
    bgColor: "bg-yellow-50 border-yellow-200",
  },
  APPROVED: {
    label: "Approved",
    color: "text-green-700",
    bgColor: "bg-green-50 border-green-200",
  },
  DECLINED: {
    label: "Declined",
    color: "text-red-700",
    bgColor: "bg-red-50 border-red-200",
  },
  INFO_NEEDED: {
    label: "Information Needed",
    color: "text-orange-700",
    bgColor: "bg-orange-50 border-orange-200",
  },
  REFERRED_TO_SIU: {
    label: "Under Review",
    color: "text-yellow-700",
    bgColor: "bg-yellow-50 border-yellow-200",
  },
};

const DOCUMENT_TYPES: Record<string, string> = {
  ACORD_125: "ACORD 125",
  ACORD_130: "ACORD 130",
  ACORD_140: "ACORD 140",
  LOSS_RUN: "Loss Run",
  FINANCIAL_STATEMENT: "Financial Statement",
  COI: "Certificate of Insurance",
  ENTITY_DOC: "Entity Document",
  INSPECTION_PHOTO: "Inspection Photo",
  MVR: "Motor Vehicle Report",
  SOV: "Schedule of Values",
  SURPLUS_LINES: "Surplus Lines",
  PROFESSIONAL_LICENSE: "Professional License",
  ENVIRONMENTAL_REPORT: "Environmental Report",
  PAYROLL_TAX: "Payroll / Tax Document",
  BROKER_SUBMISSION: "Broker Submission",
  FLEET_SCHEDULE: "Fleet Schedule",
  UNKNOWN: "Unknown",
};

const DOC_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  UPLOADED: { label: "Uploaded", color: "bg-slate-100 text-slate-500" },
  CLASSIFYING: { label: "Classifying", color: "bg-blue-50 text-blue-600" },
  EXTRACTING: { label: "Analyzing", color: "bg-blue-50 text-blue-600" },
  ANALYZED: { label: "Analyzed", color: "bg-green-50 text-green-600" },
  ERROR: { label: "Error", color: "bg-red-50 text-red-600" },
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  SUBMISSION_CREATED: "Submission created",
  DOCUMENT_UPLOADED: "Documents uploaded",
  PROCESSING_STARTED: "Processing started",
  PROCESSING_COMPLETED: "Processing completed",
  FRAUD_FLAG_RAISED: "Fraud flag raised",
  SUBMISSION_APPROVED: "Submission approved",
  SUBMISSION_DECLINED: "Submission declined",
  SUBMISSION_ESCALATED: "Submission escalated for review",
  SIU_REFERRAL: "Referred for investigation",
  SCORE_OVERRIDE: "Risk score overridden",
};

// ─── Helpers ────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

// ─── Main Component ─────────────────────────────────────

export default function SubmissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const submissionId = params.id as string;

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSubmission = useCallback(async () => {
    try {
      const res = await fetch(`/api/submissions/${submissionId}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load submission.");
        return;
      }
      const data = await res.json();
      setSubmission(data.data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/audit-logs?submissionId=${submissionId}&limit=50`
      );
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.data ?? []);
      }
    } catch {
      // Audit logs are optional — don't show error for this
    }
  }, [submissionId]);

  useEffect(() => {
    fetchSubmission();
    fetchAuditLogs();
  }, [fetchSubmission, fetchAuditLogs]);

  // Auto-refresh while processing
  useEffect(() => {
    if (submission?.status !== "PROCESSING") return;
    const interval = setInterval(() => {
      fetchSubmission();
    }, 5000);
    return () => clearInterval(interval);
  }, [submission?.status, fetchSubmission]);

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl py-8">
        <div className="flex items-center gap-3">
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
            style={{
              borderColor: "var(--portal-primary)",
              borderTopColor: "transparent",
            }}
          />
          <span className="text-sm text-slate-500">Loading submission...</span>
        </div>
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="mx-auto max-w-4xl py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Submission not found."}
        </div>
        <Link
          href="/portal/submissions"
          className="mt-4 inline-block text-sm font-medium hover:underline"
          style={{ color: "var(--portal-primary)" }}
        >
          Back to My Submissions
        </Link>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[submission.status] ?? {
    label: submission.status,
    color: "text-slate-700",
    bgColor: "bg-slate-50 border-slate-200",
  };

  return (
    <div className="mx-auto max-w-4xl py-8">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Link
          href="/portal/submissions"
          className="text-slate-400 hover:text-slate-600"
        >
          My Submissions
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-500">{submission.insuredName}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--portal-primary)" }}
          >
            {submission.insuredName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Submitted {formatDate(submission.createdAt)}
            {submission.lineOfBusiness &&
              ` \u00B7 ${submission.lineOfBusiness}`}
          </p>
        </div>
      </div>

      {/* Status banner */}
      <div
        className={`mb-6 rounded-xl border p-4 ${statusCfg.bgColor}`}
      >
        <div className="flex items-center gap-3">
          <StatusIcon status={submission.status} />
          <div>
            <p className={`text-sm font-semibold ${statusCfg.color}`}>
              {statusCfg.label}
            </p>
            <p className="text-xs text-slate-600">
              {statusMessage(submission.status)}
            </p>
          </div>
        </div>

        {/* Info needed message from underwriter */}
        {submission.status === "INFO_NEEDED" && (
          <InfoNeededDetails auditLogs={auditLogs} />
        )}
      </div>

      {/* Submission info */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Submission Details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoRow label="Insured Name" value={submission.insuredName} />
          <InfoRow
            label="Line of Business"
            value={submission.lineOfBusiness ?? "Not specified"}
          />
          <InfoRow label="Channel" value={channelLabel(submission.channel)} />
          <InfoRow
            label="Documents"
            value={`${submission.documents.length} file${submission.documents.length !== 1 ? "s" : ""}`}
          />
          <InfoRow label="Submitted" value={formatDateTime(submission.createdAt)} />
          <InfoRow
            label="Last Updated"
            value={formatDateTime(submission.updatedAt)}
          />
          <InfoRow
            label="Assigned Underwriter"
            value={
              submission.assignedUnderwriter?.name ??
              submission.assignedUnderwriter?.email ??
              "Not yet assigned"
            }
          />
        </div>
      </div>

      {/* Documents list */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
          <p className="mt-1 text-sm text-slate-500">
            {submission.documents.length} document
            {submission.documents.length !== 1 ? "s" : ""} attached to this
            submission.
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {submission.documents.map((doc) => {
            const docStatus = DOC_STATUS_CONFIG[doc.status] ?? {
              label: doc.status,
              color: "bg-slate-100 text-slate-500",
            };
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 px-6 py-3"
              >
                <FileIcon fileName={doc.fileName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">
                    {doc.fileName}
                  </p>
                  <p className="text-xs text-slate-400">
                    {DOCUMENT_TYPES[doc.documentType] ?? doc.documentType}{" "}
                    &middot; {formatBytes(doc.fileSize)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${docStatus.color}`}
                >
                  {docStatus.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Status timeline */}
      {auditLogs.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Status Timeline
            </h2>
          </div>

          <div className="px-6 py-4">
            <ol className="relative border-l border-slate-200 ml-3">
              {auditLogs.map((log) => {
                const label =
                  AUDIT_ACTION_LABELS[log.action] ?? log.action;
                return (
                  <li key={log.id} className="mb-6 ml-6 last:mb-0">
                    <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full border border-white bg-slate-300" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {label}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(log.createdAt)}
                        {log.user &&
                          ` \u00B7 ${log.user.name ?? log.user.email}`}
                      </p>
                      <AuditLogDetails details={log.details} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {/* Back button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/portal/submissions")}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Back to My Submissions
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function AuditLogDetails({
  details,
}: {
  details: Record<string, unknown> | null;
}) {
  if (!details || typeof details !== "object") return null;

  const justification = details.justification;
  const infoNeeded = details.infoNeededDetails;

  return (
    <>
      {justification ? (
        <p className="mt-1 text-xs text-slate-500 italic">
          &ldquo;{String(justification)}&rdquo;
        </p>
      ) : null}
      {infoNeeded ? (
        <p className="mt-1 text-xs text-slate-500 italic">
          Request: &ldquo;{String(infoNeeded)}&rdquo;
        </p>
      ) : null}
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function FileIcon({ fileName }: { fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const colorMap: Record<string, string> = {
    pdf: "text-red-500 bg-red-50",
    xlsx: "text-green-600 bg-green-50",
    docx: "text-blue-500 bg-blue-50",
    jpg: "text-purple-500 bg-purple-50",
    jpeg: "text-purple-500 bg-purple-50",
    png: "text-purple-500 bg-purple-50",
    tiff: "text-purple-500 bg-purple-50",
    tif: "text-purple-500 bg-purple-50",
  };
  const classes = colorMap[ext] ?? "text-slate-500 bg-slate-50";
  return (
    <span
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold uppercase ${classes}`}
    >
      {ext.slice(0, 4)}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "PROCESSING":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
          <svg
            className="h-4 w-4 animate-spin text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      );
    case "APPROVED":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-4 w-4 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
      );
    case "DECLINED":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
          <svg
            className="h-4 w-4 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
      );
    case "INFO_NEEDED":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
          <svg
            className="h-4 w-4 text-orange-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
      );
    default:
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100">
          <svg
            className="h-4 w-4 text-yellow-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      );
  }
}

function statusMessage(status: string): string {
  switch (status) {
    case "PROCESSING":
      return "Your submission is being analyzed. This may take a few minutes.";
    case "UNDER_REVIEW":
      return "Your submission is currently being reviewed by an underwriter.";
    case "APPROVED":
      return "Your submission has been approved.";
    case "DECLINED":
      return "Your submission has been declined. See details below.";
    case "INFO_NEEDED":
      return "Additional information is required. Please review the request below.";
    case "REFERRED_TO_SIU":
      return "Your submission is currently being reviewed by an underwriter.";
    default:
      return "Status update pending.";
  }
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "PORTAL":
      return "Submission Portal";
    case "EMAIL":
      return "Email Intake";
    case "API":
      return "API";
    default:
      return channel;
  }
}

function InfoNeededDetails({
  auditLogs,
}: {
  auditLogs: AuditLogEntry[];
}) {
  // Find the most recent escalation / info-needed audit log
  const infoLog = auditLogs.find(
    (log) =>
      log.action === "SUBMISSION_ESCALATED" &&
      log.details &&
      typeof log.details === "object" &&
      "infoNeededDetails" in log.details &&
      log.details.infoNeededDetails
  );

  if (!infoLog) return null;

  const details = String(
    (infoLog.details as Record<string, unknown>).infoNeededDetails
  );

  return (
    <div className="mt-3 rounded-lg border border-orange-200 bg-white p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-orange-600">
        Request from Underwriter
      </p>
      <p className="text-sm text-slate-700">{details}</p>
      {infoLog.user && (
        <p className="mt-1 text-xs text-slate-500">
          {infoLog.user.name ?? infoLog.user.email} &middot;{" "}
          {formatDateTime(infoLog.createdAt)}
        </p>
      )}
    </div>
  );
}
