"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

// ─── Types ──────────────────────────────────────────────

interface DocumentInfo {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  documentType: string;
  classificationConfidence: number | null;
  status: string;
}

interface SubmissionData {
  id: string;
  insuredName: string;
  lineOfBusiness: string | null;
  status: string;
  documents: DocumentInfo[];
}

interface ValidationItem {
  level: "error" | "warning" | "info";
  documentId: string;
  documentName: string;
  field: string;
  issue: string;
  howToFix: string;
}

const DOCUMENT_TYPES: Record<string, string> = {
  ACORD_125: "ACORD 125 - Commercial Insurance",
  ACORD_130: "ACORD 130 - Workers' Comp",
  ACORD_140: "ACORD 140 - Property",
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

const ACCEPTED_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tiff", ".tif"],
};

const ACCEPTED_MIME_TYPES = Object.keys(ACCEPTED_EXTENSIONS);

// ─── Helpers ────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

function confidenceLabel(confidence: number | null): {
  text: string;
  color: string;
} {
  if (confidence === null) return { text: "N/A", color: "bg-slate-100 text-slate-500" };
  if (confidence >= 0.9) return { text: "High", color: "bg-green-50 text-green-700" };
  if (confidence >= 0.7) return { text: "Medium", color: "bg-yellow-50 text-yellow-700" };
  return { text: "Low", color: "bg-red-50 text-red-700" };
}

function generateValidations(documents: DocumentInfo[]): ValidationItem[] {
  const items: ValidationItem[] = [];

  for (const doc of documents) {
    // Flag unknown document types
    if (doc.documentType === "UNKNOWN") {
      items.push({
        level: "error",
        documentId: doc.id,
        documentName: doc.fileName,
        field: "Document Type",
        issue: "Could not determine document type automatically.",
        howToFix: "Select the correct document type from the dropdown, or re-upload with a clearer document.",
      });
    }

    // Flag low-confidence classifications
    if (
      doc.documentType !== "UNKNOWN" &&
      doc.classificationConfidence !== null &&
      doc.classificationConfidence < 0.7
    ) {
      items.push({
        level: "warning",
        documentId: doc.id,
        documentName: doc.fileName,
        field: "Classification Confidence",
        issue: `Document was classified as "${DOCUMENT_TYPES[doc.documentType] ?? doc.documentType}" with low confidence (${Math.round((doc.classificationConfidence ?? 0) * 100)}%).`,
        howToFix: "Verify the document type is correct. If not, select the correct type from the dropdown.",
      });
    }

    // Flag error status documents
    if (doc.status === "ERROR") {
      items.push({
        level: "error",
        documentId: doc.id,
        documentName: doc.fileName,
        field: "Processing Error",
        issue: "This document encountered an error during processing.",
        howToFix: "Try re-uploading the document. Ensure it is not corrupted or password-protected.",
      });
    }

    // Info: documents still classifying/extracting
    if (doc.status === "CLASSIFYING" || doc.status === "EXTRACTING") {
      items.push({
        level: "info",
        documentId: doc.id,
        documentName: doc.fileName,
        field: "Processing Status",
        issue: `Document is currently being ${doc.status === "CLASSIFYING" ? "classified" : "analyzed"}.`,
        howToFix: "Please wait for processing to complete, then refresh the page.",
      });
    }
  }

  // Check for missing common document types
  const types = new Set(documents.map((d) => d.documentType));
  if (!types.has("ACORD_125") && documents.length > 0) {
    items.push({
      level: "info",
      documentId: "",
      documentName: "",
      field: "Missing Document",
      issue: "No ACORD 125 (Commercial Insurance Application) was detected.",
      howToFix: "If applicable, upload the ACORD 125 form or correct the classification of an existing document.",
    });
  }

  return items;
}

// ─── Main Component ─────────────────────────────────────

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const submissionId = params.id as string;

  const [submission, setSubmission] = useState<SubmissionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [updatingDocId, setUpdatingDocId] = useState<string | null>(null);
  const [reuploadingDocId, setReuploadingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    fetchSubmission();
  }, [fetchSubmission]);

  async function handleTypeChange(docId: string, newType: string) {
    setUpdatingDocId(docId);
    try {
      const res = await fetch(
        `/api/submissions/${submissionId}/documents/${docId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentType: newType }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setSubmission((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            documents: prev.documents.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    documentType: data.data.documentType,
                    classificationConfidence: data.data.classificationConfidence,
                  }
                : d
            ),
          };
        });
      }
    } catch {
      // Silently fail - user can retry
    } finally {
      setUpdatingDocId(null);
    }
  }

  function triggerReupload(docId: string) {
    setReuploadingDocId(docId);
    fileInputRef.current?.click();
  }

  async function handleReupload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !reuploadingDocId) {
      setReuploadingDocId(null);
      return;
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setError("Invalid file type. Accepted: PDF, XLSX, DOCX, JPG, PNG, TIFF.");
      setReuploadingDocId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `/api/submissions/${submissionId}/documents/${reuploadingDocId}`,
        {
          method: "PUT",
          body: formData,
        }
      );

      if (res.ok) {
        // Refresh submission data
        await fetchSubmission();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to re-upload document.");
      }
    } catch {
      setError("Network error during re-upload. Please try again.");
    } finally {
      setReuploadingDocId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConfirmSubmit() {
    setConfirming(true);
    setError("");

    try {
      // Trigger the processing pipeline by calling confirm endpoint
      const res = await fetch(
        `/api/submissions/${submissionId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to confirm submission.");
        setConfirming(false);
        return;
      }

      // Redirect to submission detail
      router.push(`/portal/submissions/${submissionId}`);
    } catch {
      setError("Network error. Please try again.");
      setConfirming(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl py-8">
        <div className="flex items-center gap-3">
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--portal-primary)", borderTopColor: "transparent" }}
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
      </div>
    );
  }

  const validationItems = generateValidations(submission.documents);
  const errorItems = validationItems.filter((v) => v.level === "error");
  const warningItems = validationItems.filter((v) => v.level === "warning");
  const infoItems = validationItems.filter((v) => v.level === "info");
  const hasUnknownDocs = submission.documents.some((d) => d.documentType === "UNKNOWN");

  return (
    <div className="mx-auto max-w-4xl py-8">
      {/* Hidden file input for re-uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_MIME_TYPES.join(",")}
        onChange={handleReupload}
        className="hidden"
      />

      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => router.push("/portal/submissions/new")}
            className="text-sm text-slate-400 hover:text-slate-600"
          >
            New Submission
          </button>
          <span className="text-sm text-slate-300">/</span>
          <span className="text-sm text-slate-500">Review</span>
        </div>
        <h1
          className="text-2xl font-bold"
          style={{ color: "var(--portal-primary)" }}
        >
          Review Submission
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Review the auto-classified documents below and correct any misclassifications
          before confirming your submission.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submission info bar */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div>
            <span className="text-slate-500">Insured: </span>
            <span className="font-medium text-slate-900">{submission.insuredName}</span>
          </div>
          {submission.lineOfBusiness && (
            <div>
              <span className="text-slate-500">LOB: </span>
              <span className="font-medium text-slate-900">{submission.lineOfBusiness}</span>
            </div>
          )}
          <div>
            <span className="text-slate-500">Documents: </span>
            <span className="font-medium text-slate-900">{submission.documents.length}</span>
          </div>
        </div>
      </div>

      {/* Document classification list */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Document Classification
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Verify auto-detected document types. Use the dropdown to correct any misclassifications.
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {submission.documents.map((doc) => {
            const conf = confidenceLabel(doc.classificationConfidence);
            const isUpdating = updatingDocId === doc.id;
            const isReuploading = reuploadingDocId === doc.id;

            return (
              <li key={doc.id} className="px-6 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  {/* File info */}
                  <div className="flex items-center gap-3 sm:min-w-0 sm:flex-1">
                    <FileIcon fileName={doc.fileName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">
                        {doc.fileName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatBytes(doc.fileSize)}
                      </p>
                    </div>
                  </div>

                  {/* Confidence badge */}
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${conf.color}`}>
                      {conf.text} confidence
                    </span>

                    <DocumentStatusBadge status={doc.status} />
                  </div>

                  {/* Type selector */}
                  <div className="flex items-center gap-2">
                    <select
                      value={doc.documentType}
                      onChange={(e) => handleTypeChange(doc.id, e.target.value)}
                      disabled={isUpdating}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20 sm:w-56"
                    >
                      {Object.entries(DOCUMENT_TYPES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>

                    {/* Re-upload button */}
                    <button
                      type="button"
                      onClick={() => triggerReupload(doc.id)}
                      disabled={isReuploading}
                      className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                      title="Re-upload this document"
                    >
                      {isReuploading ? (
                        <div
                          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent"
                          style={{ borderColor: "var(--portal-primary)", borderTopColor: "transparent" }}
                        />
                      ) : (
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
                          />
                        </svg>
                      )}
                      <span className="hidden sm:inline">Replace</span>
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Validation results */}
      {validationItems.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Validation Results
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Review data quality issues before confirming your submission.
            </p>
          </div>

          <div className="divide-y divide-slate-100 px-6">
            {/* Action Required (errors) */}
            {errorItems.length > 0 && (
              <ValidationGroup
                title="Action Required"
                items={errorItems}
                colorClass="border-red-200 bg-red-50"
                iconColor="text-red-500"
                titleColor="text-red-800"
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                }
              />
            )}

            {/* Warnings */}
            {warningItems.length > 0 && (
              <ValidationGroup
                title="Warnings"
                items={warningItems}
                colorClass="border-yellow-200 bg-yellow-50"
                iconColor="text-yellow-600"
                titleColor="text-yellow-800"
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                }
              />
            )}

            {/* Info */}
            {infoItems.length > 0 && (
              <ValidationGroup
                title="Information"
                items={infoItems}
                colorClass="border-blue-200 bg-blue-50"
                iconColor="text-blue-500"
                titleColor="text-blue-800"
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                }
              />
            )}
          </div>
        </div>
      )}

      {/* No issues */}
      {validationItems.length === 0 && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-green-800">All documents look good</p>
              <p className="text-xs text-green-600">No data quality issues detected. You can confirm your submission.</p>
            </div>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push("/portal/submissions")}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Save as Draft
        </button>

        <div className="flex items-center gap-3">
          {hasUnknownDocs && (
            <p className="text-xs text-red-500">
              Please classify all documents before confirming.
            </p>
          )}
          <button
            type="button"
            onClick={handleConfirmSubmit}
            disabled={confirming || hasUnknownDocs}
            className="rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: "var(--portal-primary)" }}
          >
            {confirming ? "Confirming..." : "Confirm & Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

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

function DocumentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "UPLOADED":
      return (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          Uploaded
        </span>
      );
    case "CLASSIFYING":
      return (
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
          Classifying
        </span>
      );
    case "EXTRACTING":
      return (
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
          Analyzing
        </span>
      );
    case "ANALYZED":
      return (
        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
          Analyzed
        </span>
      );
    case "ERROR":
      return (
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
          Error
        </span>
      );
    default:
      return null;
  }
}

function ValidationGroup({
  title,
  items,
  colorClass,
  iconColor,
  titleColor,
  icon,
}: {
  title: string;
  items: ValidationItem[];
  colorClass: string;
  iconColor: string;
  titleColor: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <h3 className={`text-sm font-semibold ${titleColor}`}>
          {title} ({items.length})
        </h3>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div
            key={`${item.documentId}-${item.field}-${i}`}
            className={`rounded-lg border p-3 ${colorClass}`}
          >
            {item.documentName && (
              <p className="mb-1 text-xs font-medium text-slate-500">
                {item.documentName} &middot; {item.field}
              </p>
            )}
            {!item.documentName && (
              <p className="mb-1 text-xs font-medium text-slate-500">
                {item.field}
              </p>
            )}
            <p className="text-sm text-slate-800">{item.issue}</p>
            <p className="mt-1 text-xs text-slate-600">
              <span className="font-medium">How to fix:</span> {item.howToFix}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
