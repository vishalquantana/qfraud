"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────

interface SIUCase {
  id: string;
  status: string;
  assignedTo: { id: string; name: string; email: string };
  submission: {
    id: string;
    insuredName: string;
    lineOfBusiness: string | null;
    riskScore: number | null;
    severity: string | null;
    createdAt: string;
  };
  indicatorCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── Constants ──────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "OPEN", label: "Open" },
  { value: "INVESTIGATING", label: "Investigating" },
  { value: "EVIDENCE_GATHERED", label: "Evidence Gathered" },
  { value: "CONFIRMED_FRAUD", label: "Confirmed Fraud" },
  { value: "FALSE_POSITIVE", label: "False Positive" },
  { value: "INCONCLUSIVE", label: "Inconclusive" },
];

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

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-600 dark:text-red-400",
  HIGH: "text-orange-600 dark:text-orange-400",
  MEDIUM: "text-yellow-600 dark:text-yellow-400",
  LOW: "text-slate-500 dark:text-slate-400",
  CLEAN: "text-green-600 dark:text-green-400",
};

// ─── Component ──────────────────────────────────────────

export default function SIUCasesPage() {
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<SIUCase[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  // ─── Fetch cases ──────────────────────────────────────

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "20");
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/siu-cases?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load SIU cases");
      const json = await res.json();
      setCases(json.data);
      setPagination(json.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  // ─── Render ──────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          SIU Cases
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Special Investigation Unit case management.{" "}
          {pagination.total > 0 && `${pagination.total} total cases`}
        </p>
      </div>

      {/* ─── Filters ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by case status"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ─── Error Alert ──────────────────────────────────── */}
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

      {/* ─── Loading ──────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-3" aria-busy="true">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          <span className="text-slate-500 dark:text-slate-400">
            Loading cases...
          </span>
        </div>
      )}

      {/* ─── Cases Table ──────────────────────────────────── */}
      {!loading && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="SIU cases">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                    Case ID
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                    Insured Name
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                    Submission Date
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                    Assigned To
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                    Last Updated
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400">
                    Indicators
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {cases.map((c) => (
                  <tr
                    key={c.id}
                    className="group bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/siu-cases/${c.id}`}
                        className="font-mono text-xs font-medium text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
                      >
                        {c.id.slice(0, 8)}...
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {c.submission.insuredName}
                      </div>
                      {c.submission.lineOfBusiness && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {c.submission.lineOfBusiness}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                      {new Date(c.submission.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {c.assignedTo.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-medium ${
                          c.submission.severity
                            ? SEVERITY_COLORS[c.submission.severity] ?? ""
                            : ""
                        }`}
                      >
                        {c.indicatorCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cases.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
              No SIU cases found
              {statusFilter ? " matching the current filter" : ""}.
            </div>
          )}
        </div>
      )}

      {/* ─── Pagination ────────────────────────────────────── */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total}{" "}
            cases)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              Previous
            </button>
            <button
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages, p + 1))
              }
              disabled={page >= pagination.totalPages}
              aria-label="Next page"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
