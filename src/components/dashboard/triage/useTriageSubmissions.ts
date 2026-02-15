"use client";

import { useState, useEffect, useCallback } from "react";
import type { TriageSubmission, TriageFilters } from "./triage-types";

export interface UseTriageResult {
  submissions: TriageSubmission[];
  loading: boolean;
  error: string;
  refetch: () => void;
  /** Optimistically update a single submission's fields. */
  optimisticUpdate: (id: string, patch: Partial<TriageSubmission>) => void;
  /** Replace the full submissions array (for bulk optimistic updates). */
  setSubmissionsOptimistic: (subs: TriageSubmission[]) => void;
}

/**
 * Custom hook that fetches and manages triage submissions.
 *
 * Includes indicator counts from the _count field returned by the API
 * rather than making N+1 individual requests per submission.
 */
export function useTriageSubmissions(filters: TriageFilters): UseTriageResult {
  const [submissions, setSubmissions] = useState<TriageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    params.set("limit", "100");
    params.set("include", "indicatorCount");
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.broker) params.set("broker", filters.broker);

    try {
      const res = await fetch(`/api/submissions?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load submissions.");
        return;
      }
      const data = await res.json();
      let items = data.data as TriageSubmission[];

      // Client-side LOB filter (until API supports it)
      if (filters.lob) {
        items = items.filter(
          (s) => s.lineOfBusiness?.toLowerCase() === filters.lob.toLowerCase(),
        );
      }

      // Map _count to indicatorCount for backward compat
      const withCounts = items.map((sub) => ({
        ...sub,
        indicatorCount:
          sub.indicatorCount ?? sub._count?.fraudIndicators ?? 0,
      }));

      setSubmissions(withCounts);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [filters.severity, filters.lob, filters.dateFrom, filters.dateTo, filters.broker]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const optimisticUpdate = useCallback(
    (id: string, patch: Partial<TriageSubmission>) => {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const setSubmissionsOptimistic = useCallback(
    (subs: TriageSubmission[]) => {
      setSubmissions(subs);
    },
    [],
  );

  return {
    submissions,
    loading,
    error,
    refetch: fetchSubmissions,
    optimisticUpdate,
    setSubmissionsOptimistic,
  };
}
