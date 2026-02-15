// Shared types and constants for the Triage board

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

export const COLUMNS = [
  { id: "NEW", label: "New", statuses: ["PROCESSING", "UNDER_REVIEW"] },
  { id: "IN_REVIEW", label: "In Review", statuses: ["INFO_NEEDED"] },
  { id: "APPROVED", label: "Approved", statuses: ["APPROVED"] },
  { id: "DECLINED", label: "Declined", statuses: ["DECLINED"] },
  { id: "REFERRED_TO_SIU", label: "Referred to SIU", statuses: ["REFERRED_TO_SIU"] },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

export const COLUMN_ID_TO_STATUS: Record<string, string> = {
  NEW: "UNDER_REVIEW",
  IN_REVIEW: "INFO_NEEDED",
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
  REFERRED_TO_SIU: "REFERRED_TO_SIU",
};

export const STATUS_TO_ACTION: Record<string, string> = {
  APPROVED: "approve",
  DECLINED: "decline",
  INFO_NEEDED: "request-info",
  REFERRED_TO_SIU: "refer-to-siu",
};

export const SEVERITY_OPTIONS = [
  { value: "", label: "All Severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "CLEAN", label: "Clean" },
];

export const LOB_OPTIONS = [
  { value: "", label: "All Lines of Business" },
  { value: "Commercial Property", label: "Commercial Property" },
  { value: "General Liability", label: "General Liability" },
  { value: "Workers Compensation", label: "Workers Compensation" },
  { value: "Commercial Auto", label: "Commercial Auto" },
  { value: "Professional Liability", label: "Professional Liability" },
  { value: "Umbrella/Excess", label: "Umbrella/Excess" },
];

export interface TriageFilters {
  severity: string;
  lob: string;
  broker: string;
  dateFrom: string;
  dateTo: string;
}

/**
 * Group submissions into kanban columns, sorted by risk score descending.
 */
export function groupByColumn(
  submissions: TriageSubmission[],
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
      (c.statuses as readonly string[]).includes(sub.status),
    );
    if (col) {
      groups[col.id].push(sub);
    }
  }

  for (const key of Object.keys(groups) as ColumnId[]) {
    groups[key].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  }

  return groups;
}
