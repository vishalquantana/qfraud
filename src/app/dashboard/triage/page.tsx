"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import KanbanColumn from "@/components/dashboard/triage/KanbanColumn";
import SubmissionCard from "@/components/dashboard/triage/SubmissionCard";

// ─── Types ──────────────────────────────────────────────

export interface TriageSubmission {
  id: string;
  insuredName: string;
  lineOfBusiness: string | null;
  status: string;
  riskScore: number | null;
  severity: string | null;
  createdAt: string;
  submitter: { id: string; name: string | null; email: string } | null;
  assignedUnderwriter: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  _count?: { fraudIndicators: number };
  indicatorCount?: number;
}

// ─── Column Definitions ─────────────────────────────────

const COLUMNS = [
  { id: "NEW", label: "New", statuses: ["PROCESSING", "UNDER_REVIEW"] },
  { id: "IN_REVIEW", label: "In Review", statuses: ["INFO_NEEDED"] },
  { id: "APPROVED", label: "Approved", statuses: ["APPROVED"] },
  { id: "DECLINED", label: "Declined", statuses: ["DECLINED"] },
  { id: "REFERRED_TO_SIU", label: "Referred to SIU", statuses: ["REFERRED_TO_SIU"] },
] as const;

type ColumnId = (typeof COLUMNS)[number]["id"];

const COLUMN_ID_TO_STATUS: Record<string, string> = {
  NEW: "UNDER_REVIEW",
  IN_REVIEW: "INFO_NEEDED",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
  REFERRED_TO_SIU: "REFERRED_TO_SIU",
};

const STATUS_TO_ACTION: Record<string, string> = {
  APPROVED: "approve",
  DECLINED: "decline",
  INFO_NEEDED: "request-info",
  REFERRED_TO_SIU: "refer-to-siu",
};

const SEVERITY_OPTIONS = [
  { value: "", label: "All Severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "CLEAN", label: "Clean" },
];

const LOB_OPTIONS = [
  { value: "", label: "All Lines of Business" },
  { value: "Commercial Property", label: "Commercial Property" },
  { value: "General Liability", label: "General Liability" },
  { value: "Workers Compensation", label: "Workers Compensation" },
  { value: "Commercial Auto", label: "Commercial Auto" },
  { value: "Professional Liability", label: "Professional Liability" },
  { value: "Umbrella/Excess", label: "Umbrella/Excess" },
];

// ─── Helper: Group submissions by column ────────────────

function groupByColumn(
  submissions: TriageSubmission[]
): Record<ColumnId, TriageSubmission[]> {
  const groups: Record<ColumnId, TriageSubmission[]> = {
    NEW: [],
    IN_REVIEW: [],
    APPROVED: [],
    DECLINED: [],
    REFERRED_TO_SIU: [],
  };

  for (const sub of submissions) {
    const col = COLUMNS.find((c) =>
      (c.statuses as readonly string[]).includes(sub.status)
    );
    if (col) {
      groups[col.id].push(sub);
    }
  }

  // Sort each column by risk score descending (highest first)
  for (const key of Object.keys(groups) as ColumnId[]) {
    groups[key].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  }

  return groups;
}

// ─── Main Component ─────────────────────────────────────

export default function TriagePage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<TriageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [severityFilter, setSeverityFilter] = useState("");
  const [lobFilter, setLobFilter] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  // DnD state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{
    submissionId: string;
    targetColumn: string;
  } | null>(null);
  const [justification, setJustification] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // ─── Fetch Submissions ──────────────────────────────────

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    params.set("limit", "100");
    if (severityFilter) params.set("severity", severityFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (brokerFilter) params.set("broker", brokerFilter);

    try {
      const res = await fetch(`/api/submissions?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load submissions.");
        return;
      }
      const data = await res.json();
      let items = data.data as TriageSubmission[];

      // Client-side LOB filter
      if (lobFilter) {
        items = items.filter(
          (s) => s.lineOfBusiness?.toLowerCase() === lobFilter.toLowerCase()
        );
      }

      // Fetch indicator counts for all submissions
      const withCounts = await Promise.all(
        items.map(async (sub) => {
          try {
            const indRes = await fetch(
              `/api/submissions/${sub.id}/indicators`
            );
            if (indRes.ok) {
              const indData = await indRes.json();
              return {
                ...sub,
                indicatorCount: Array.isArray(indData.data)
                  ? indData.data.length
                  : 0,
              };
            }
          } catch {
            // ignore
          }
          return { ...sub, indicatorCount: 0 };
        })
      );

      setSubmissions(withCounts);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [severityFilter, lobFilter, dateFrom, dateTo, brokerFilter]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // ─── Column grouping ───────────────────────────────────

  const grouped = groupByColumn(submissions);

  // ─── DnD Handlers ──────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const submissionId = active.id as string;
    const targetColumnId = over.id as string;

    // Check if the target is actually a column
    const targetCol = COLUMNS.find((c) => c.id === targetColumnId);
    if (!targetCol) return;

    // Find current column for this submission
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return;

    const currentCol = COLUMNS.find((c) =>
      (c.statuses as readonly string[]).includes(submission.status)
    );
    if (!currentCol || currentCol.id === targetCol.id) return;

    const targetStatus = COLUMN_ID_TO_STATUS[targetCol.id];
    const action = STATUS_TO_ACTION[targetStatus];
    if (!action) return;

    // For decline, require justification via modal
    if (action === "decline") {
      setPendingDrop({ submissionId, targetColumn: targetCol.id });
      setJustification("");
      setActionModalOpen(true);
      return;
    }

    // Otherwise, execute the status update directly
    executeStatusChange(submissionId, action);
  }

  async function executeStatusChange(
    submissionId: string,
    action: string,
    extraBody: Record<string, string> = {}
  ) {
    try {
      const res = await fetch(`/api/submissions/${submissionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extraBody }),
      });

      if (res.ok) {
        const data = await res.json();
        // Update local state
        setSubmissions((prev) =>
          prev.map((s) =>
            s.id === submissionId
              ? { ...s, status: data.data.status }
              : s
          )
        );
      }
    } catch {
      // ignore
    }
  }

  function handleModalConfirm() {
    if (!pendingDrop) return;
    const targetStatus =
      COLUMN_ID_TO_STATUS[pendingDrop.targetColumn];
    const action = STATUS_TO_ACTION[targetStatus];
    if (action) {
      executeStatusChange(pendingDrop.submissionId, action, {
        justification,
      });
    }
    setActionModalOpen(false);
    setPendingDrop(null);
    setJustification("");
  }

  // ─── Bulk Approve ──────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkApprove() {
    setBulkApproving(true);
    const promises = Array.from(selectedIds).map((id) =>
      executeStatusChange(id, "approve")
    );
    await Promise.allSettled(promises);
    setSelectedIds(new Set());
    setBulkApproving(false);
  }

  // Count how many selected are LOW risk
  const selectedLowRisk = Array.from(selectedIds).filter((id) => {
    const sub = submissions.find((s) => s.id === id);
    return sub && (sub.severity === "LOW" || sub.severity === "CLEAN");
  });

  // ─── Active card for DragOverlay ───────────────────────

  const activeSubmission = activeId
    ? submissions.find((s) => s.id === activeId)
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Triage Board
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Drag submissions between columns to update their status.
          </p>
        </div>
        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproving || selectedLowRisk.length === 0}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {bulkApproving ? (
              <svg
                className="h-4 w-4 animate-spin"
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
            ) : (
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
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            )}
            Approve Selected ({selectedLowRisk.length})
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={lobFilter}
          onChange={(e) => setLobFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {LOB_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={brokerFilter}
          onChange={(e) => setBrokerFilter(e.target.value)}
          placeholder="Search broker..."
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
        />

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-sm text-slate-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>

        {(severityFilter || lobFilter || brokerFilter || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setSeverityFilter("");
              setLobFilter("");
              setBrokerFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Loading submissions...
            </span>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {!loading && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                count={grouped[col.id].length}
              >
                {grouped[col.id].map((sub) => (
                  <SubmissionCard
                    key={sub.id}
                    submission={sub}
                    isSelected={selectedIds.has(sub.id)}
                    onToggleSelect={() => toggleSelect(sub.id)}
                    onClick={() =>
                      router.push(`/dashboard/submissions/${sub.id}`)
                    }
                  />
                ))}
              </KanbanColumn>
            ))}
          </div>

          <DragOverlay>
            {activeSubmission && (
              <SubmissionCard
                submission={activeSubmission}
                isSelected={false}
                onToggleSelect={() => {}}
                onClick={() => {}}
                isDragOverlay
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Justification Modal (for decline action) */}
      {actionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Decline Submission
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Please provide a justification for declining this submission.
            </p>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
              placeholder="Enter justification..."
              className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setActionModalOpen(false);
                  setPendingDrop(null);
                  setJustification("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleModalConfirm}
                disabled={!justification.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
