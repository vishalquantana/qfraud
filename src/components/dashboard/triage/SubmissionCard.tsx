"use client";

import { useDraggable } from "@dnd-kit/core";
import type { TriageSubmission } from "@/app/dashboard/triage/page";

interface SubmissionCardProps {
  submission: TriageSubmission;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  isDragOverlay?: boolean;
}

// ─── Severity Badge Config ──────────────────────────────

const SEVERITY_CONFIG: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  CRITICAL: {
    label: "Critical",
    color: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
    dot: "bg-red-500",
  },
  HIGH: {
    label: "High",
    color:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  MEDIUM: {
    label: "Medium",
    color:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400",
    dot: "bg-yellow-500",
  },
  LOW: {
    label: "Low",
    color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
    dot: "bg-slate-400",
  },
  CLEAN: {
    label: "Clean",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400",
    dot: "bg-green-500",
  },
};

// ─── Risk Score Gauge ────────────────────────────────────

function RiskScoreGauge({ score }: { score: number | null }) {
  const value = score ?? 0;
  const color =
    value >= 85
      ? "text-red-600 dark:text-red-400"
      : value >= 60
        ? "text-orange-500 dark:text-orange-400"
        : value >= 35
          ? "text-yellow-500 dark:text-yellow-400"
          : "text-green-500 dark:text-green-400";

  const strokeColor =
    value >= 85
      ? "#dc2626"
      : value >= 60
        ? "#f97316"
        : value >= 35
          ? "#eab308"
          : "#22c55e";

  // SVG arc for the gauge
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 100) * circumference;

  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-slate-200 dark:text-slate-700"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
        />
      </svg>
      <span
        className={`absolute text-xs font-bold ${color}`}
      >
        {score ?? "—"}
      </span>
    </div>
  );
}

// ─── Main Card Component ─────────────────────────────────

export default function SubmissionCard({
  submission,
  isSelected,
  onToggleSelect,
  onClick,
  isDragOverlay,
}: SubmissionCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: submission.id,
  });

  const severity = submission.severity
    ? SEVERITY_CONFIG[submission.severity]
    : null;

  const brokerName =
    submission.submitter?.name ?? submission.submitter?.email ?? "Unknown";

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      className={`group cursor-grab rounded-lg border bg-white p-3 shadow-sm transition-all dark:bg-slate-800 ${
        isDragging
          ? "opacity-40"
          : isDragOverlay
            ? "rotate-2 scale-105 shadow-xl border-primary-400 dark:border-primary-600"
            : isSelected
              ? "border-primary-400 ring-2 ring-primary-400/30 dark:border-primary-600"
              : "border-slate-200 hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:hover:border-slate-600"
      }`}
    >
      {/* Top row: checkbox + name + date */}
      <div className="mb-2 flex items-start gap-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 dark:border-slate-600"
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="truncate text-sm font-semibold text-slate-900 hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
          >
            {submission.insuredName}
          </button>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {brokerName}
          </p>
        </div>
        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
          {formatDate(submission.createdAt)}
        </span>
      </div>

      {/* Middle: LOB */}
      {submission.lineOfBusiness && (
        <p className="mb-2 truncate text-xs text-slate-500 dark:text-slate-400">
          {submission.lineOfBusiness}
        </p>
      )}

      {/* Bottom row: gauge + severity + indicators */}
      <div className="flex items-center gap-3">
        <RiskScoreGauge score={submission.riskScore} />

        <div className="min-w-0 flex-1 space-y-1">
          {severity && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${severity.color}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${severity.dot}`} />
              {severity.label}
            </span>
          )}

          {(submission.indicatorCount ?? 0) > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">
                {submission.indicatorCount}
              </span>{" "}
              indicator{submission.indicatorCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
