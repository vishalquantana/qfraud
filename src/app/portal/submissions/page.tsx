"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Types ──────────────────────────────────────────────

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

interface Submission {
  id: string;
  insuredName: string;
  lineOfBusiness: string | null;
  status: string;
  riskScore: number | null;
  severity: string | null;
  createdAt: string;
  updatedAt: string;
  submitter: Submitter | null;
  assignedUnderwriter: AssignedUnderwriter | null;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PROCESSING: { label: "Processing", color: "bg-blue-50 text-blue-700" },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-50 text-yellow-700" },
  APPROVED: { label: "Approved", color: "bg-green-50 text-green-700" },
  DECLINED: { label: "Declined", color: "bg-red-50 text-red-700" },
  INFO_NEEDED: { label: "Info Needed", color: "bg-orange-50 text-orange-700" },
  REFERRED_TO_SIU: { label: "Under Review", color: "bg-yellow-50 text-yellow-700" },
};

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "PROCESSING", label: "Processing" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "DECLINED", label: "Declined" },
  { value: "INFO_NEEDED", label: "Info Needed" },
];

// ─── Main Component ─────────────────────────────────────

export default function SubmissionsPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Count of INFO_NEEDED submissions for notification badge
  const [infoNeededCount, setInfoNeededCount] = useState(0);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    if (statusFilter) params.set("status", statusFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    try {
      const res = await fetch(`/api/submissions?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load submissions.");
        return;
      }
      const data = await res.json();
      let filteredData = data.data as Submission[];

      // Client-side search by insured name
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filteredData = filteredData.filter((s) =>
          s.insuredName.toLowerCase().includes(q)
        );
      }

      setSubmissions(filteredData);
      setPagination(data.pagination);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, searchQuery]);

  // Fetch INFO_NEEDED count for notification badge
  const fetchInfoNeededCount = useCallback(async () => {
    try {
      const res = await fetch("/api/submissions?status=INFO_NEEDED&limit=1");
      if (res.ok) {
        const data = await res.json();
        setInfoNeededCount(data.pagination?.total ?? 0);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  useEffect(() => {
    fetchInfoNeededCount();
  }, [fetchInfoNeededCount]);

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="mx-auto max-w-6xl py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--portal-primary)" }}
          >
            My Submissions
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            View and track the status of your submissions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {infoNeededCount > 0 && (
            <button
              onClick={() => {
                setStatusFilter("INFO_NEEDED");
                setPage(1);
              }}
              className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 transition-colors hover:bg-orange-100"
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
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                />
              </svg>
              {infoNeededCount} need{infoNeededCount === 1 ? "s" : ""} action
            </button>
          )}
          <button
            onClick={() => router.push("/portal/submissions/new")}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: "var(--portal-primary)" }}
          >
            New Submission
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by insured name..."
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
              />
            </div>
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
              placeholder="From"
            />
            <span className="text-sm text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--portal-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]/20"
              placeholder="To"
            />
          </div>

          {/* Clear filters */}
          {(statusFilter || searchQuery || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setStatusFilter("");
                setSearchQuery("");
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 py-12">
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
            style={{
              borderColor: "var(--portal-primary)",
              borderTopColor: "transparent",
            }}
          />
          <span className="text-sm text-slate-500">Loading submissions...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && submissions.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
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
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-700">No submissions found</p>
          <p className="mt-1 text-sm text-slate-500">
            {statusFilter || searchQuery || dateFrom || dateTo
              ? "Try adjusting your filters."
              : "Get started by creating your first submission."}
          </p>
          {!statusFilter && !searchQuery && !dateFrom && !dateTo && (
            <button
              onClick={() => router.push("/portal/submissions/new")}
              className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: "var(--portal-primary)" }}
            >
              New Submission
            </button>
          )}
        </div>
      )}

      {/* Submission table */}
      {!loading && submissions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Submission Date
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Insured Name
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Line of Business
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Assigned Underwriter
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {submissions.map((sub) => {
                  const statusCfg = STATUS_CONFIG[sub.status] ?? {
                    label: sub.status,
                    color: "bg-slate-100 text-slate-600",
                  };
                  return (
                    <tr
                      key={sub.id}
                      onClick={() =>
                        router.push(`/portal/submissions/${sub.id}`)
                      }
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                        {formatDate(sub.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-slate-900">
                          {sub.insuredName}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {sub.lineOfBusiness ?? "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.color}`}
                        >
                          {sub.status === "PROCESSING" && (
                            <svg
                              className="h-3 w-3 animate-spin"
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
                          )}
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {sub.assignedUnderwriter?.name ??
                          sub.assignedUnderwriter?.email ??
                          "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="divide-y divide-slate-100 md:hidden">
            {submissions.map((sub) => {
              const statusCfg = STATUS_CONFIG[sub.status] ?? {
                label: sub.status,
                color: "bg-slate-100 text-slate-600",
              };
              return (
                <div
                  key={sub.id}
                  onClick={() => router.push(`/portal/submissions/${sub.id}`)}
                  className="cursor-pointer px-4 py-4 transition-colors hover:bg-slate-50"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {sub.insuredName}
                    </p>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.color}`}
                    >
                      {sub.status === "PROCESSING" && (
                        <svg
                          className="h-3 w-3 animate-spin"
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
                      )}
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{formatDate(sub.createdAt)}</span>
                    {sub.lineOfBusiness && <span>{sub.lineOfBusiness}</span>}
                    {sub.assignedUnderwriter && (
                      <span>
                        UW: {sub.assignedUnderwriter.name ?? sub.assignedUnderwriter.email}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
              <p className="text-sm text-slate-500">
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(
                  pagination.page * pagination.limit,
                  pagination.total
                )}{" "}
                of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-500">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(pagination.totalPages, p + 1))
                  }
                  disabled={page >= pagination.totalPages}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
