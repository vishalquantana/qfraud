"use client";

import { useState, useCallback } from "react";
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
import TriageFilterBar from "@/components/dashboard/triage/TriageFilterBar";
import BulkApproveButton from "@/components/dashboard/triage/BulkApproveButton";
import JustificationModal from "@/components/dashboard/triage/JustificationModal";
import { useTriageSubmissions } from "@/components/dashboard/triage/useTriageSubmissions";
import {
  COLUMNS,
  COLUMN_ID_TO_STATUS,
  STATUS_TO_ACTION,
  groupByColumn,
  type TriageFilters,
} from "@/components/dashboard/triage/triage-types";

// Re-export for backward compat (SubmissionCard imports TriageSubmission from here)
export type { TriageSubmission } from "@/components/dashboard/triage/triage-types";

// Action → target status mapping
const ACTION_TO_STATUS: Record<string, string> = {
  approve: "APPROVED",
  decline: "DECLINED",
  "request-info": "INFO_NEEDED",
  "refer-to-siu": "REFERRED_TO_SIU",
};

// ─── Main Component ─────────────────────────────────────

export default function TriagePage() {
  const router = useRouter();

  // Filters
  const [filters, setFilters] = useState<TriageFilters>({
    severity: "",
    lob: "",
    broker: "",
    dateFrom: "",
    dateTo: "",
  });

  // Data
  const {
    submissions,
    loading,
    error,
    refetch,
    optimisticUpdate,
    setSubmissionsOptimistic,
  } = useTriageSubmissions(filters);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  // DnD state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [pendingDropId, setPendingDropId] = useState<string | null>(null);

  // Toast for optimistic update feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const grouped = groupByColumn(submissions);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ─── Optimistic Status Change ─────────────────────────

  const executeStatusChange = useCallback(
    async (submissionId: string, action: string, extraBody: Record<string, string> = {}) => {
      const targetStatus = ACTION_TO_STATUS[action];

      // Snapshot current state for rollback
      const snapshot = [...submissions];

      // Optimistic update: immediately move the card
      if (targetStatus) {
        optimisticUpdate(submissionId, { status: targetStatus });
      }

      try {
        const res = await fetch(`/api/submissions/${submissionId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extraBody }),
        });
        if (res.ok) {
          showToast(`Submission ${action}d successfully`, "success");
          refetch();
        } else {
          // Revert on server error
          setSubmissionsOptimistic(snapshot);
          showToast(`Failed to ${action} submission`, "error");
        }
      } catch {
        // Revert on network error
        setSubmissionsOptimistic(snapshot);
        showToast(`Network error — ${action} failed`, "error");
      }
    },
    [submissions, optimisticUpdate, setSubmissionsOptimistic, refetch, showToast],
  );

  // ─── DnD Handlers ──────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const submissionId = active.id as string;
    const targetCol = COLUMNS.find((c) => c.id === over.id);
    if (!targetCol) return;

    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return;

    const currentCol = COLUMNS.find((c) =>
      (c.statuses as readonly string[]).includes(submission.status),
    );
    if (!currentCol || currentCol.id === targetCol.id) return;

    const targetStatus = COLUMN_ID_TO_STATUS[targetCol.id];
    const action = STATUS_TO_ACTION[targetStatus];
    if (!action) return;

    if (action === "decline") {
      setPendingDropId(submissionId);
      setDeclineModalOpen(true);
      return;
    }

    executeStatusChange(submissionId, action);
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
      executeStatusChange(id, "approve"),
    );
    await Promise.allSettled(promises);
    setSelectedIds(new Set());
    setBulkApproving(false);
  }

  const selectedLowRiskCount = Array.from(selectedIds).filter((id) => {
    const sub = submissions.find((s) => s.id === id);
    return sub && (sub.severity === "LOW" || sub.severity === "CLEAN");
  }).length;

  const activeSubmission = activeId
    ? submissions.find((s) => s.id === activeId)
    : null;

  // ─── Render ────────────────────────────────────────────

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
        <BulkApproveButton
          selectedCount={selectedIds.size}
          lowRiskCount={selectedLowRiskCount}
          isApproving={bulkApproving}
          onApprove={handleBulkApprove}
        />
      </div>

      <TriageFilterBar filters={filters} onChange={setFilters} />

      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-1 items-center justify-center" aria-busy="true">
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
          <div className="flex flex-1 gap-4 overflow-x-auto pb-4" role="region" aria-label="Kanban board">
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

      <JustificationModal
        open={declineModalOpen}
        onConfirm={(justification) => {
          if (pendingDropId) {
            executeStatusChange(pendingDropId, "decline", { justification });
          }
          setDeclineModalOpen(false);
          setPendingDropId(null);
        }}
        onCancel={() => {
          setDeclineModalOpen(false);
          setPendingDropId(null);
        }}
      />
    </div>
  );
}
