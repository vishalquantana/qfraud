"use client";

import { useDroppable } from "@dnd-kit/core";

interface KanbanColumnProps {
  id: string;
  label: string;
  count: number;
  children: React.ReactNode;
}

const COLUMN_COLORS: Record<string, { header: string; badge: string }> = {
  NEW: {
    header: "border-blue-200 dark:border-blue-800",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  },
  IN_REVIEW: {
    header: "border-yellow-200 dark:border-yellow-800",
    badge:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400",
  },
  APPROVED: {
    header: "border-green-200 dark:border-green-800",
    badge:
      "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400",
  },
  DECLINED: {
    header: "border-red-200 dark:border-red-800",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
  },
  REFERRED_TO_SIU: {
    header: "border-purple-200 dark:border-purple-800",
    badge:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400",
  },
};

export default function KanbanColumn({
  id,
  label,
  count,
  children,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const colors = COLUMN_COLORS[id] ?? {
    header: "border-slate-200 dark:border-slate-700",
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
  };

  return (
    <div
      ref={setNodeRef}
      role="list"
      aria-label={`${label} column, ${count} submissions`}
      className={`flex w-72 min-w-[288px] flex-shrink-0 flex-col rounded-xl border-2 transition-colors ${
        isOver
          ? "border-primary-400 bg-primary-50/50 dark:border-primary-600 dark:bg-primary-900/20"
          : `border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50`
      }`}
    >
      {/* Column header */}
      <div
        className={`flex items-center justify-between border-b-2 px-4 py-3 ${colors.header}`}
      >
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {label}
        </h3>
        <span
          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-xs font-semibold ${colors.badge}`}
        >
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {children}
        {count === 0 && (
          <p className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
            No submissions
          </p>
        )}
      </div>
    </div>
  );
}
