"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  tenantId: string;
  submissionId: string | null;
  userId: string | null;
  action: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface AuditUser {
  id: string;
  name: string;
}

// ─── Constants ──────────────────────────────────────────

const ACTION_TYPES = [
  "SUBMISSION_CREATED",
  "DOCUMENT_UPLOADED",
  "PROCESSING_STARTED",
  "PROCESSING_COMPLETED",
  "FRAUD_FLAG_RAISED",
  "SUBMISSION_APPROVED",
  "SUBMISSION_DECLINED",
  "SUBMISSION_ESCALATED",
  "SIU_REFERRAL",
  "SCORE_OVERRIDE",
  "THRESHOLD_CHANGED",
  "USER_LOGIN",
] as const;

const ACTION_LABELS: Record<string, string> = {
  SUBMISSION_CREATED: "Submission Created",
  DOCUMENT_UPLOADED: "Document Uploaded",
  PROCESSING_STARTED: "Processing Started",
  PROCESSING_COMPLETED: "Processing Completed",
  FRAUD_FLAG_RAISED: "Fraud Flag Raised",
  SUBMISSION_APPROVED: "Submission Approved",
  SUBMISSION_DECLINED: "Submission Declined",
  SUBMISSION_ESCALATED: "Submission Escalated",
  SIU_REFERRAL: "SIU Referral",
  SCORE_OVERRIDE: "Score Override",
  THRESHOLD_CHANGED: "Threshold Changed",
  USER_LOGIN: "User Login",
};

const ACTION_COLORS: Record<string, string> = {
  SUBMISSION_CREATED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
  DOCUMENT_UPLOADED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
  PROCESSING_STARTED:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-400",
  PROCESSING_COMPLETED:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-400",
  FRAUD_FLAG_RAISED:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
  SUBMISSION_APPROVED:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400",
  SUBMISSION_DECLINED:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
  SUBMISSION_ESCALATED:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400",
  SIU_REFERRAL:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400",
  SCORE_OVERRIDE:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
  THRESHOLD_CHANGED:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400",
  USER_LOGIN:
    "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300",
};

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

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [submissionFilter, setSubmissionFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "50");
      if (actionFilter) params.set("action", actionFilter);
      if (userFilter) params.set("userId", userFilter);
      if (submissionFilter) params.set("submissionId", submissionFilter);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (search) params.set("search", search);

      const res = await fetch(`/api/audit-logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      const json = await res.json();
      setLogs(json.data);
      setPagination(json.pagination);
      if (json.users) setUsers(json.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, userFilter, submissionFilter, startDate, endDate, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 when filters change
  const applySearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleFilterChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const summarizeDetails = (details: Record<string, unknown>): string => {
    const parts: string[] = [];
    if (details.reason) parts.push(String(details.reason));
    if (details.justification) parts.push(String(details.justification));
    if (details.status) parts.push(`Status: ${details.status}`);
    if (details.action) parts.push(String(details.action));
    if (details.documentCount !== undefined)
      parts.push(`${details.documentCount} documents`);
    if (details.errorCount !== undefined && Number(details.errorCount) > 0)
      parts.push(`${details.errorCount} errors`);
    if (details.durationMs !== undefined)
      parts.push(`${Math.round(Number(details.durationMs))}ms`);
    if (parts.length === 0) {
      const keys = Object.keys(details).slice(0, 3);
      return keys.join(", ") || "—";
    }
    return parts.join(" | ");
  };

  const handleExportCSV = () => {
    downloadCSV(
      "audit-trail.csv",
      ["Timestamp", "User", "Action", "Submission ID", "Details", "IP Address"],
      logs.map((log) => [
        new Date(log.createdAt).toLocaleString(),
        log.user?.name ?? "System",
        ACTION_LABELS[log.action] ?? log.action,
        log.submissionId ?? "",
        JSON.stringify(log.details),
        log.ipAddress ?? "",
      ])
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Audit Trail
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Complete system activity log for compliance and regulatory audit.
          </p>
        </div>
        {logs.length > 0 && (
          <button
            onClick={handleExportCSV}
            aria-label="Export audit trail as CSV"
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
        )}
      </div>

      {/* ─── Filters ─────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Action Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Action Type
            </label>
            <select
              value={actionFilter}
              onChange={(e) =>
                handleFilterChange(setActionFilter, e.target.value)
              }
              aria-label="Filter by action type"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">All Actions</option>
              {ACTION_TYPES.map((action) => (
                <option key={action} value={action}>
                  {ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </div>

          {/* User */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              User
            </label>
            <select
              value={userFilter}
              onChange={(e) =>
                handleFilterChange(setUserFilter, e.target.value)
              }
              aria-label="Filter by user"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) =>
                handleFilterChange(setStartDate, e.target.value)
              }
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => handleFilterChange(setEndDate, e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Search + Submission ID row */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Submission ID */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Submission ID
            </label>
            <input
              type="text"
              placeholder="Filter by submission ID..."
              value={submissionFilter}
              onChange={(e) =>
                handleFilterChange(setSubmissionFilter, e.target.value)
              }
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
            />
          </div>

          {/* Search */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Search Details
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search across details..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applySearch();
                }}
                className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
              />
              <button
                onClick={applySearch}
                className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Active filters summary */}
        {(actionFilter ||
          userFilter ||
          submissionFilter ||
          startDate ||
          endDate ||
          search) && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Active filters:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {actionFilter && (
                <FilterChip
                  label={ACTION_LABELS[actionFilter] ?? actionFilter}
                  onClear={() => handleFilterChange(setActionFilter, "")}
                />
              )}
              {userFilter && (
                <FilterChip
                  label={`User: ${users.find((u) => u.id === userFilter)?.name ?? userFilter}`}
                  onClear={() => handleFilterChange(setUserFilter, "")}
                />
              )}
              {submissionFilter && (
                <FilterChip
                  label={`Sub: ${submissionFilter.slice(0, 8)}...`}
                  onClear={() => handleFilterChange(setSubmissionFilter, "")}
                />
              )}
              {startDate && (
                <FilterChip
                  label={`From: ${startDate}`}
                  onClear={() => handleFilterChange(setStartDate, "")}
                />
              )}
              {endDate && (
                <FilterChip
                  label={`To: ${endDate}`}
                  onClear={() => handleFilterChange(setEndDate, "")}
                />
              )}
              {search && (
                <FilterChip
                  label={`"${search}"`}
                  onClear={() => {
                    setSearch("");
                    setSearchInput("");
                    setPage(1);
                  }}
                />
              )}
            </div>
            <button
              onClick={() => {
                setActionFilter("");
                setUserFilter("");
                setSubmissionFilter("");
                setStartDate("");
                setEndDate("");
                setSearch("");
                setSearchInput("");
                setPage(1);
              }}
              className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ─── Error ───────────────────────────────────────── */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ─── Loading ─────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-3 py-12" aria-busy="true">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          <span className="text-slate-500 dark:text-slate-400">
            Loading audit logs...
          </span>
        </div>
      )}

      {/* ─── Table ───────────────────────────────────────── */}
      {!loading && (
        <>
          {logs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="mt-4 text-sm font-medium text-slate-900 dark:text-white">
                No audit log entries found
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Try adjusting your filters or date range.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <table className="min-w-full text-sm" aria-label="Audit log entries">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                      Timestamp
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                      User
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                      Submission
                    </th>
                    <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {logs.map((log) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      expanded={expandedId === log.id}
                      onToggle={() =>
                        setExpandedId(expandedId === log.id ? null : log.id)
                      }
                      summarizeDetails={summarizeDetails}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ─── Pagination ──────────────────────────────── */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Showing{" "}
                {(pagination.page - 1) * pagination.limit + 1}
                {" - "}
                {Math.min(
                  pagination.page * pagination.limit,
                  pagination.total
                )}{" "}
                of {pagination.total.toLocaleString()} entries
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Previous
                </button>
                {generatePageNumbers(page, pagination.totalPages).map(
                  (p, idx) =>
                    p === "..." ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 text-sm text-slate-400"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                          page === p
                            ? "bg-primary-600 text-white"
                            : "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
                        }`}
                      >
                        {p}
                      </button>
                    )
                )}
                <button
                  onClick={() =>
                    setPage(Math.min(pagination.totalPages, page + 1))
                  }
                  disabled={page === pagination.totalPages}
                  aria-label="Next page"
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Log Row with Expandable Details ─────────────────────

function LogRow({
  log,
  expanded,
  onToggle,
  summarizeDetails,
}: {
  log: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
  summarizeDetails: (details: Record<string, unknown>) => string;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer bg-white transition-colors hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/50"
      >
        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">
          <div className="text-sm">
            {new Date(log.createdAt).toLocaleDateString()}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {new Date(log.createdAt).toLocaleTimeString()}
          </div>
        </td>
        <td className="px-4 py-3">
          {log.user ? (
            <div>
              <div className="font-medium text-slate-900 dark:text-white">
                {log.user.name}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {log.user.email}
              </div>
            </div>
          ) : (
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              System
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
              ACTION_COLORS[log.action] ??
              "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
            }`}
          >
            {ACTION_LABELS[log.action] ?? log.action}
          </span>
        </td>
        <td className="px-4 py-3">
          {log.submissionId ? (
            <a
              href={`/dashboard/submissions/${log.submissionId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400"
            >
              {log.submissionId.slice(0, 12)}...
            </a>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              —
            </span>
          )}
        </td>
        <td className="max-w-[250px] truncate px-4 py-3 text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <svg
              className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${expanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span className="truncate text-xs">
              {summarizeDetails(log.details)}
            </span>
          </div>
        </td>
      </tr>

      {/* Expanded details row */}
      {expanded && (
        <tr className="bg-slate-50 dark:bg-slate-900/50">
          <td colSpan={5} className="px-4 py-4">
            <ExpandedDetails details={log.details} ipAddress={log.ipAddress} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Expanded Details Panel ──────────────────────────────

function ExpandedDetails({
  details,
  ipAddress,
}: {
  details: Record<string, unknown>;
  ipAddress: string | null;
}) {
  const renderValue = (
    value: unknown,
    depth: number = 0
  ): React.ReactNode => {
    if (value === null || value === undefined) {
      return (
        <span className="text-slate-400 dark:text-slate-500">null</span>
      );
    }
    if (typeof value === "boolean") {
      return (
        <span
          className={
            value
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }
        >
          {value.toString()}
        </span>
      );
    }
    if (typeof value === "number") {
      return (
        <span className="text-blue-600 dark:text-blue-400">
          {value}
        </span>
      );
    }
    if (typeof value === "string") {
      return (
        <span className="text-slate-900 dark:text-white">{value}</span>
      );
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <span className="text-slate-400 dark:text-slate-500">[]</span>
        );
      }
      return (
        <div className="ml-4 space-y-1">
          {value.map((item, i) => (
            <div key={i} className="flex gap-1">
              <span className="text-slate-400 dark:text-slate-500">[{i}]</span>
              {renderValue(item, depth + 1)}
            </div>
          ))}
        </div>
      );
    }
    if (typeof value === "object") {
      return (
        <div className={depth > 0 ? "ml-4" : ""}>
          {Object.entries(value as Record<string, unknown>).map(
            ([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="flex-shrink-0 font-medium text-slate-600 dark:text-slate-400">
                  {formatKey(k)}:
                </span>
                {renderValue(v, depth + 1)}
              </div>
            )
          )}
        </div>
      );
    }
    return (
      <span className="text-slate-900 dark:text-white">
        {String(value)}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Full Details
        </h4>
        {ipAddress && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            IP: {ipAddress}
          </span>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs dark:border-slate-700 dark:bg-slate-800">
        {Object.keys(details).length === 0 ? (
          <span className="text-slate-400 dark:text-slate-500">
            No details available
          </span>
        ) : (
          <div className="space-y-1">{renderValue(details)}</div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
      {label}
      <button
        onClick={onClear}
        className="ml-0.5 hover:text-primary-900 dark:hover:text-primary-300"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </span>
  );
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function generatePageNumbers(
  current: number,
  total: number
): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("...");
  pages.push(total);

  return pages;
}
