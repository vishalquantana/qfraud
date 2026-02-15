"use client";

import {
  SEVERITY_OPTIONS,
  LOB_OPTIONS,
  type TriageFilters,
} from "./triage-types";

interface TriageFilterBarProps {
  filters: TriageFilters;
  onChange: (filters: TriageFilters) => void;
}

const selectCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500";

export default function TriageFilterBar({
  filters,
  onChange,
}: TriageFilterBarProps) {
  const hasAnyFilter =
    filters.severity || filters.lob || filters.broker || filters.dateFrom || filters.dateTo;

  function update(partial: Partial<TriageFilters>) {
    onChange({ ...filters, ...partial });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3" role="search" aria-label="Filter submissions">
      <select
        value={filters.severity}
        onChange={(e) => update({ severity: e.target.value })}
        className={selectCls}
        aria-label="Filter by severity"
      >
        {SEVERITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={filters.lob}
        onChange={(e) => update({ lob: e.target.value })}
        className={selectCls}
        aria-label="Filter by line of business"
      >
        {LOB_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        value={filters.broker}
        onChange={(e) => update({ broker: e.target.value })}
        placeholder="Search broker..."
        className={inputCls}
        aria-label="Search by broker name"
      />

      <div className="flex items-center gap-2">
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => update({ dateFrom: e.target.value })}
          className={inputCls}
          aria-label="Date from"
        />
        <span className="text-sm text-slate-400">to</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => update({ dateTo: e.target.value })}
          className={inputCls}
          aria-label="Date to"
        />
      </div>

      {hasAnyFilter && (
        <button
          onClick={() =>
            onChange({ severity: "", lob: "", broker: "", dateFrom: "", dateTo: "" })
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
          aria-label="Clear all filters"
        >
          Clear
        </button>
      )}
    </div>
  );
}
