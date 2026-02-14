"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";

const ACCEPTED_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tiff", ".tif"],
};

const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

const LOB_OPTIONS = [
  "General Liability",
  "Commercial Property",
  "Workers' Compensation",
  "Commercial Auto",
  "Professional Liability",
  "Umbrella / Excess",
  "Inland Marine",
  "Cyber Liability",
  "Directors & Officers",
  "Employment Practices Liability",
];

interface UploadFile {
  id: string;
  file: File;
  status: "pending" | "uploading" | "complete" | "error";
  progress: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

let fileIdCounter = 0;

export default function NewSubmissionPage() {
  const router = useRouter();
  const [insuredName, setInsuredName] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);

  const onDrop = useCallback(
    (accepted: File[]) => {
      setError("");
      const currentCount = files.length;
      if (currentCount + accepted.length > MAX_FILES) {
        setError(`Maximum ${MAX_FILES} files per submission.`);
        return;
      }

      const newTotalSize =
        totalSize + accepted.reduce((s, f) => s + f.size, 0);
      if (newTotalSize > MAX_TOTAL_BYTES) {
        setError("Total file size exceeds 500 MB limit.");
        return;
      }

      const newFiles: UploadFile[] = accepted.map((file) => ({
        id: `file-${++fileIdCounter}`,
        file,
        status: "pending" as const,
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
    },
    [files.length, totalSize]
  );

  const onDropRejected = useCallback(() => {
    setError("Some files were rejected. Accepted types: PDF, XLSX, DOCX, JPG, PNG, TIFF.");
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_EXTENSIONS,
    maxFiles: MAX_FILES,
    noClick: false,
  });

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!insuredName.trim()) {
      setError("Insured Name is required.");
      return;
    }
    if (files.length === 0) {
      setError("Please upload at least one document.");
      return;
    }

    setSubmitting(true);
    setFiles((prev) =>
      prev.map((f) => ({ ...f, status: "uploading" as const, progress: 50 }))
    );

    const formData = new FormData();
    formData.append("insuredName", insuredName.trim());
    if (lineOfBusiness) {
      formData.append("lineOfBusiness", lineOfBusiness);
    }
    if (effectiveDate) {
      formData.append("effectiveDate", effectiveDate);
    }
    formData.append("channel", "PORTAL");
    for (const f of files) {
      formData.append("files", f.file);
    }

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create submission.");
        setFiles((prev) =>
          prev.map((f) => ({ ...f, status: "error" as const, progress: 0 }))
        );
        setSubmitting(false);
        return;
      }

      // Mark files as complete based on API response
      setFiles((prev) =>
        prev.map((f) => {
          const doc = data.documents?.find(
            (d: { fileName: string }) => d.fileName === f.file.name
          );
          if (doc?.status === "error") {
            return {
              ...f,
              status: "error" as const,
              progress: 0,
              error: doc.error || "Upload failed",
            };
          }
          return { ...f, status: "complete" as const, progress: 100 };
        })
      );

      // Redirect to the review step
      router.push(`/portal/submissions/${data.submissionId}/review`);
    } catch {
      setError("Network error. Please try again.");
      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: "error" as const, progress: 0 }))
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="mb-8">
        <h1
          className="text-2xl font-bold"
          style={{ color: "var(--portal-primary)" }}
        >
          New Submission
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Upload your documents and provide submission details below.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Submission details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Submission Details
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <label
                htmlFor="insuredName"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Insured Name <span className="text-red-500">*</span>
              </label>
              <input
                id="insuredName"
                type="text"
                value={insuredName}
                onChange={(e) => setInsuredName(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
                placeholder="Business or individual name"
              />
            </div>

            <div>
              <label
                htmlFor="lineOfBusiness"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Line of Business
              </label>
              <select
                id="lineOfBusiness"
                value={lineOfBusiness}
                onChange={(e) => setLineOfBusiness(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
              >
                <option value="">Select line of business</option>
                {LOB_OPTIONS.map((lob) => (
                  <option key={lob} value={lob}>
                    {lob}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="effectiveDate"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Effective Date
              </label>
              <input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
              />
            </div>
          </div>
        </div>

        {/* Upload zone */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Documents
          </h2>

          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              isDragActive
                ? "border-[var(--portal-primary)] bg-[var(--portal-primary)]/5"
                : "border-slate-300 hover:border-[var(--portal-primary)]/50 hover:bg-slate-50"
            }`}
          >
            <input {...getInputProps()} />
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <svg
                className="h-6 w-6 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            {isDragActive ? (
              <p className="text-sm font-medium" style={{ color: "var(--portal-primary)" }}>
                Drop files here...
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">
                  Drag &amp; drop files here, or{" "}
                  <span style={{ color: "var(--portal-primary)" }}>browse</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  PDF, XLSX, DOCX, JPG, PNG, TIFF — up to {MAX_FILES} files,
                  500 MB total
                </p>
              </>
            )}
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {files.length} file{files.length !== 1 ? "s" : ""} selected
                </span>
                <span>{formatBytes(totalSize)} total</span>
              </div>

              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <FileIcon fileName={f.file.name} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">
                        {f.file.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatBytes(f.file.size)}
                      </p>
                    </div>

                    <StatusBadge status={f.status} error={f.error} />

                    {f.status === "uploading" && (
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${f.progress}%`,
                            backgroundColor: "var(--portal-primary)",
                          }}
                        />
                      </div>
                    )}

                    {!submitting && (
                      <button
                        type="button"
                        onClick={() => removeFile(f.id)}
                        className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label={`Remove ${f.file.name}`}
                      >
                        <svg
                          className="h-4 w-4"
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
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push("/portal/submissions")}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || files.length === 0}
            className="rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: "var(--portal-primary)" }}
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

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

function StatusBadge({
  status,
  error,
}: {
  status: UploadFile["status"];
  error?: string;
}) {
  switch (status) {
    case "pending":
      return (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          Ready
        </span>
      );
    case "uploading":
      return (
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
          Uploading
        </span>
      );
    case "complete":
      return (
        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
          Done
        </span>
      );
    case "error":
      return (
        <span
          className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600"
          title={error}
        >
          Error
        </span>
      );
  }
}
