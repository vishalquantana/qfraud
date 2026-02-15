import { prisma } from "@/lib/prisma";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { EntityDocExtractedData } from "@/services/extraction-entity-doc";
import type { COIExtractedData } from "@/services/extraction-coi";

// ─── Types ──────────────────────────────────────────────

export interface OFACEntry {
  name: string;
  type: "individual" | "entity";
  programs: string[];
  id: string;
}

export interface NIPRRecord {
  brokerName: string;
  licenseNumber: string;
  state: string;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "REVOKED" | "NOT_FOUND";
  expirationDate: string | null;
  disciplinaryActions: DisciplinaryAction[];
}

export interface DisciplinaryAction {
  date: string;
  type: string;
  description: string;
  state: string;
}

// ─── OFAC SDN List (Mock) ───────────────────────────────

/**
 * Mock OFAC SDN (Specially Designated Nationals) list.
 * In production, this would be loaded from the Treasury Department's
 * regularly updated CSV/XML file.
 */
const MOCK_SDN_LIST: OFACEntry[] = [
  {
    name: "IVAN PETROV",
    type: "individual",
    programs: ["SDGT", "RUSSIA-EO14024"],
    id: "SDN-10001",
  },
  {
    name: "DARKSIDE TRADING LLC",
    type: "entity",
    programs: ["CYBER2"],
    id: "SDN-10002",
  },
  {
    name: "MOHAMMAD AL-RASHIDI",
    type: "individual",
    programs: ["SDGT"],
    id: "SDN-10003",
  },
  {
    name: "GOLDEN DRAGON EXPORTS LTD",
    type: "entity",
    programs: ["NONPRO"],
    id: "SDN-10004",
  },
  {
    name: "SANCTION TEST ENTITY",
    type: "entity",
    programs: ["SDGT", "IRAN"],
    id: "SDN-10005",
  },
  {
    name: "OFAC FLAGGED PERSON",
    type: "individual",
    programs: ["SDGT"],
    id: "SDN-10006",
  },
];

// ─── Fuzzy Name Matching ────────────────────────────────

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity score between two names (0-1).
 * Uses normalized Levenshtein distance.
 */
function nameSimilarity(name1: string, name2: string): number {
  const a = name1.toUpperCase().trim();
  const b = name2.toUpperCase().trim();

  if (a === b) return 1.0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Default similarity threshold for OFAC matching.
 * Names scoring above this are flagged as potential matches.
 */
const OFAC_SIMILARITY_THRESHOLD = 0.85;

/**
 * Screen a name against the OFAC SDN list using fuzzy matching.
 * Returns all matches above the similarity threshold.
 */
function screenNameAgainstOFAC(
  name: string,
  threshold: number = OFAC_SIMILARITY_THRESHOLD,
): Array<{ entry: OFACEntry; similarity: number }> {
  const matches: Array<{ entry: OFACEntry; similarity: number }> = [];

  for (const entry of MOCK_SDN_LIST) {
    const similarity = nameSimilarity(name, entry.name);
    if (similarity >= threshold) {
      matches.push({ entry, similarity });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

// ─── Mock NIPR Broker License API ───────────────────────

/**
 * Mock NIPR (National Insurance Producer Registry) API.
 * Simulates a broker license lookup by name and state.
 *
 * Keywords for testing:
 * - "unlicensed" or "fake broker" → NOT_FOUND
 * - "expired" → EXPIRED license
 * - "suspended" or "revoked" → SUSPENDED with disciplinary actions
 * - All others → ACTIVE
 */
async function queryNIPR(
  brokerName: string,
  state: string,
): Promise<NIPRRecord> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 50));

  const nameLower = brokerName.toLowerCase();

  if (nameLower.includes("unlicensed") || nameLower.includes("fake broker")) {
    return {
      brokerName,
      licenseNumber: "",
      state,
      status: "NOT_FOUND",
      expirationDate: null,
      disciplinaryActions: [],
    };
  }

  if (nameLower.includes("expired")) {
    return {
      brokerName,
      licenseNumber: `NPN-${Math.floor(1000000 + Math.random() * 9000000)}`,
      state,
      status: "EXPIRED",
      expirationDate: "2023-06-30",
      disciplinaryActions: [],
    };
  }

  if (nameLower.includes("suspended") || nameLower.includes("revoked")) {
    return {
      brokerName,
      licenseNumber: `NPN-${Math.floor(1000000 + Math.random() * 9000000)}`,
      state,
      status: "SUSPENDED",
      expirationDate: "2025-12-31",
      disciplinaryActions: [
        {
          date: "2024-03-15",
          type: "SUSPENSION",
          description:
            "License suspended for failure to comply with continuing education requirements",
          state,
        },
        {
          date: "2023-08-20",
          type: "FINE",
          description: "Fined $5,000 for misrepresentation on applications",
          state,
        },
      ],
    };
  }

  // Default: return an active license
  return {
    brokerName,
    licenseNumber: `NPN-${Math.floor(1000000 + Math.random() * 9000000)}`,
    state,
    status: "ACTIVE",
    expirationDate: "2026-12-31",
    disciplinaryActions: [],
  };
}

// ─── Helpers ────────────────────────────────────────────

async function findExtractedData<T>(
  submissionId: string,
  documentType: string,
): Promise<{ data: T; documentId: string } | null> {
  const doc = await prisma.document.findFirst({
    where: {
      submissionId,
      documentType: documentType as never,
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!doc || !doc.extractedData) return null;

  return {
    data: doc.extractedData as unknown as T,
    documentId: doc.id,
  };
}

/**
 * Extract all named entities and individuals from the submission.
 * Returns a deduplicated list of names with their source document IDs.
 */
async function extractAllNames(
  submissionId: string,
): Promise<Array<{ name: string; type: "entity" | "individual"; documentId: string }>> {
  const names: Array<{ name: string; type: "entity" | "individual"; documentId: string }> = [];
  const seen = new Set<string>();

  const addName = (name: string | null, type: "entity" | "individual", documentId: string) => {
    if (!name || name.trim().length < 2) return;
    const normalized = name.trim().toUpperCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    names.push({ name: name.trim(), type, documentId });
  };

  // From ACORD 125
  const acord125 = await findExtractedData<Acord125ExtractedData>(submissionId, "ACORD_125");
  if (acord125) {
    addName(acord125.data.businessName, "entity", acord125.documentId);
    addName(acord125.data.applicantName, "individual", acord125.documentId);
    addName(acord125.data.dba, "entity", acord125.documentId);
  }

  // From Entity documents
  const entityDoc = await findExtractedData<EntityDocExtractedData>(submissionId, "ENTITY_DOC");
  if (entityDoc) {
    addName(entityDoc.data.entityName, "entity", entityDoc.documentId);
    addName(entityDoc.data.registeredAgent, "individual", entityDoc.documentId);
    if (entityDoc.data.officers) {
      for (const officer of entityDoc.data.officers) {
        addName(officer.name, "individual", entityDoc.documentId);
      }
    }
  }

  // From COI
  const coi = await findExtractedData<COIExtractedData>(submissionId, "COI");
  if (coi) {
    addName(coi.data.insuredName, "entity", coi.documentId);
    addName(coi.data.agentName, "individual", coi.documentId);
  }

  return names;
}

/**
 * Extract broker info from submission — broker name and state.
 */
async function extractBrokerInfo(submissionId: string): Promise<{
  brokerName: string;
  state: string;
  documentId: string;
} | null> {
  // Try COI first for agent/broker info
  const coi = await findExtractedData<COIExtractedData>(submissionId, "COI");
  if (coi && coi.data.agentName) {
    // Try to infer state from the submission's insured address
    const acord125 = await findExtractedData<Acord125ExtractedData>(submissionId, "ACORD_125");
    const state = acord125
      ? extractStateFromAddress(acord125.data.physicalAddress || acord125.data.mailingAddress)
      : null;
    if (state) {
      return { brokerName: coi.data.agentName, state, documentId: coi.documentId };
    }
  }

  // Fallback: check if the submitter is a broker user
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      submitter: { select: { name: true, role: true } },
    },
  });

  if (submission?.submitter?.role === "BROKER" && submission.submitter.name) {
    const acord125 = await findExtractedData<Acord125ExtractedData>(submissionId, "ACORD_125");
    const state = acord125
      ? extractStateFromAddress(acord125.data.physicalAddress || acord125.data.mailingAddress)
      : null;
    if (state) {
      return { brokerName: submission.submitter.name, state, documentId: "" };
    }
  }

  return null;
}

/**
 * Extract 2-letter state code from an address string.
 */
function extractStateFromAddress(address: string | null): string | null {
  if (!address) return null;

  const stateZipMatch = address.match(/,\s*([A-Z]{2})\s+\d{5}/);
  if (stateZipMatch) return stateZipMatch[1];

  const stateCommaMatch = address.match(/,\s*([A-Z]{2})\s*,/);
  if (stateCommaMatch) return stateCommaMatch[1];

  const trailingMatch = address.match(/\b([A-Z]{2})$/);
  if (trailingMatch) return trailingMatch[1];

  return null;
}

/**
 * Retry wrapper for API calls with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── OFAC Screening ─────────────────────────────────────

/**
 * Screen all named entities and individuals from a submission
 * against the OFAC SDN list.
 *
 * Uses fuzzy name matching (Levenshtein distance) with a configurable
 * similarity threshold. Any match is flagged as CRITICAL.
 */
export async function screenOFAC(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Extract all named entities and individuals from documents
  const names = await extractAllNames(submissionId);
  if (names.length === 0) return; // Skip gracefully if no names found

  // Screen each name against OFAC list
  for (const { name, type, documentId } of names) {
    const matches = screenNameAgainstOFAC(name);

    for (const match of matches) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          documentId: documentId || null,
          category: "ENTITY_INTEL",
          indicatorName: "OFAC SDN List Match",
          description: `${type === "entity" ? "Entity" : "Individual"} "${name}" matches OFAC Specially Designated Nationals list entry "${match.entry.name}" with ${(match.similarity * 100).toFixed(0)}% similarity.`,
          severity: "CRITICAL",
          evidence: JSON.parse(
            JSON.stringify({
              screenedName: name,
              nameType: type,
              matchedSDNEntry: match.entry.name,
              sdnId: match.entry.id,
              sdnType: match.entry.type,
              programs: match.entry.programs,
              similarityScore: parseFloat(match.similarity.toFixed(3)),
              matchThreshold: OFAC_SIMILARITY_THRESHOLD,
              verificationSource: "OFAC SDN List",
            }),
          ),
          confidence: parseFloat(match.similarity.toFixed(2)),
          recommendedAction:
            "IMMEDIATE: This submission must be reviewed for sanctions compliance. Do not approve until OFAC screening is resolved. Escalate to compliance department.",
        },
      });
    }
  }
}

// ─── Broker License Verification ────────────────────────

/**
 * Verify broker/agent license status against NIPR database.
 *
 * Flags:
 * - Broker not found → CRITICAL
 * - License expired/suspended/revoked → CRITICAL
 * - Disciplinary actions on record → HIGH
 */
export async function verifyBrokerLicense(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Extract broker info from documents
  const brokerInfo = await extractBrokerInfo(submissionId);
  if (!brokerInfo) return; // Skip gracefully if no broker info

  const { brokerName, state, documentId } = brokerInfo;

  // Query NIPR with retry
  let niprRecord: NIPRRecord;
  try {
    niprRecord = await withRetry(() => queryNIPR(brokerName, state));
  } catch {
    console.error(
      `NIPR API failed for submission ${submissionId}, broker "${brokerName}" in ${state}. Skipping verification.`,
    );
    return;
  }

  // Check 1: Broker not found
  if (niprRecord.status === "NOT_FOUND") {
    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: documentId || null,
        category: "ENTITY_INTEL",
        indicatorName: "Broker License Not Found",
        description: `Broker/agent "${brokerName}" was not found in the NIPR database for state ${state}. This may indicate an unlicensed agent is submitting business.`,
        severity: "CRITICAL",
        evidence: JSON.parse(
          JSON.stringify({
            brokerName,
            state,
            niprStatus: "NOT_FOUND",
            verificationSource: "NIPR",
          }),
        ),
        confidence: 0.85,
        recommendedAction:
          "Verify broker licensing independently. Request the broker's NPN (National Producer Number) and verify directly with the state DOI.",
      },
    });
    return;
  }

  // Check 2: License expired, suspended, or revoked
  if (
    niprRecord.status === "EXPIRED" ||
    niprRecord.status === "SUSPENDED" ||
    niprRecord.status === "REVOKED"
  ) {
    const statusMessages: Record<string, string> = {
      EXPIRED: `Broker "${brokerName}" has an expired license (expired ${niprRecord.expirationDate || "unknown date"}). Business submitted by an expired licensee may be invalid.`,
      SUSPENDED: `Broker "${brokerName}" has a suspended license in ${state}. A suspended license indicates regulatory action has been taken.`,
      REVOKED: `Broker "${brokerName}" has a revoked license in ${state}. A revoked license is a serious regulatory finding.`,
    };

    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: documentId || null,
        category: "ENTITY_INTEL",
        indicatorName: `Broker License ${niprRecord.status}`,
        description: statusMessages[niprRecord.status],
        severity: "CRITICAL",
        evidence: JSON.parse(
          JSON.stringify({
            brokerName,
            licenseNumber: niprRecord.licenseNumber,
            state,
            licenseStatus: niprRecord.status,
            expirationDate: niprRecord.expirationDate,
            verificationSource: "NIPR",
          }),
        ),
        confidence: 0.9,
        recommendedAction:
          "Do not accept business from this broker until their license status is resolved. Notify compliance department.",
      },
    });
  }

  // Check 3: Disciplinary actions on record
  if (niprRecord.disciplinaryActions.length > 0) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: documentId || null,
        category: "ENTITY_INTEL",
        indicatorName: "Broker Has Disciplinary History",
        description: `Broker "${brokerName}" has ${niprRecord.disciplinaryActions.length} disciplinary action(s) on record. This warrants enhanced scrutiny of submissions from this producer.`,
        severity: "HIGH",
        evidence: JSON.parse(
          JSON.stringify({
            brokerName,
            licenseNumber: niprRecord.licenseNumber,
            state,
            licenseStatus: niprRecord.status,
            disciplinaryActionCount: niprRecord.disciplinaryActions.length,
            disciplinaryActions: niprRecord.disciplinaryActions,
            verificationSource: "NIPR",
          }),
        ),
        confidence: 0.85,
        recommendedAction:
          "Review disciplinary history details. Apply enhanced scrutiny to all submissions from this broker. Consider adding to monitoring list.",
      },
    });
  }
}
