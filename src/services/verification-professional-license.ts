import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("verification-professional-license");

// ─── Types ──────────────────────────────────────────────

export interface ProfessionalLicenseExtractedData {
  licenseNumber: string | null;
  licenseType: string | null;
  scope: string | null;
  issuingBoard: string | null;
  state: string | null;
  holderName: string | null;
  issueDate: string | null;
  expirationDate: string | null;
}

export interface StateBoardRecord {
  licenseNumber: string;
  holderName: string;
  state: string;
  licenseType: string;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "REVOKED" | "NOT_FOUND";
  scope: string | null;
  expirationDate: string | null;
  disciplinaryActions: Array<{
    date: string;
    type: string;
    description: string;
  }>;
}

// ─── Mock State Board API ───────────────────────────────

/**
 * Mock State Board API for professional license verification.
 * Simulates a lookup by license number and state.
 *
 * Keywords for testing:
 * - License number containing "INVALID" or "FAKE" → NOT_FOUND
 * - License number containing "EXPIRED" → EXPIRED
 * - License number containing "SUSPEND" → SUSPENDED
 * - License number containing "REVOKE" → REVOKED
 * - Holder name containing "mismatch" → Returns different name for scope check
 * - All others → ACTIVE
 */
async function queryStateBoard(
  licenseNumber: string,
  state: string,
  holderName: string | null,
): Promise<StateBoardRecord> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 50));

  const numUpper = licenseNumber.toUpperCase();

  if (numUpper.includes("INVALID") || numUpper.includes("FAKE")) {
    return {
      licenseNumber,
      holderName: holderName || "",
      state,
      licenseType: "",
      status: "NOT_FOUND",
      scope: null,
      expirationDate: null,
      disciplinaryActions: [],
    };
  }

  if (numUpper.includes("EXPIRED")) {
    return {
      licenseNumber,
      holderName: holderName || "John Doe",
      state,
      licenseType: "Professional License",
      status: "EXPIRED",
      scope: "General Practice",
      expirationDate: "2023-06-30",
      disciplinaryActions: [],
    };
  }

  if (numUpper.includes("SUSPEND")) {
    return {
      licenseNumber,
      holderName: holderName || "Jane Smith",
      state,
      licenseType: "Professional License",
      status: "SUSPENDED",
      scope: "General Practice",
      expirationDate: "2026-12-31",
      disciplinaryActions: [
        {
          date: "2024-09-15",
          type: "SUSPENSION",
          description:
            "License suspended for violation of professional conduct standards",
        },
      ],
    };
  }

  if (numUpper.includes("REVOKE")) {
    return {
      licenseNumber,
      holderName: holderName || "Bob Jones",
      state,
      licenseType: "Professional License",
      status: "REVOKED",
      scope: "General Practice",
      expirationDate: null,
      disciplinaryActions: [
        {
          date: "2024-03-01",
          type: "REVOCATION",
          description: "License revoked for fraudulent misrepresentation",
        },
      ],
    };
  }

  // Default: active license
  return {
    licenseNumber,
    holderName: holderName || "Licensed Professional",
    state,
    licenseType: "Professional License",
    status: "ACTIVE",
    scope: "General Practice",
    expirationDate: "2027-12-31",
    disciplinaryActions: [],
  };
}

// ─── Helpers ────────────────────────────────────────────

async function findExtractedData<T>(
  submissionId: string,
  documentType: string,
): Promise<Array<{ data: T; documentId: string }>> {
  const docs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: documentType as never,
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  const results: Array<{ data: T; documentId: string }> = [];
  for (const doc of docs) {
    if (!doc.extractedData) continue;
    results.push({
      data: doc.extractedData as unknown as T,
      documentId: doc.id,
    });
  }
  return results;
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

// ─── Verification Checks ───────────────────────────────

/**
 * Check 1: License not found in state board records.
 */
async function checkLicenseNotFound(
  submissionId: string,
  tenantId: string,
  documentId: string,
  licenseNumber: string,
  state: string,
  holderName: string | null,
): Promise<void> {
  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "API_VERIFY",
      indicatorName: "Professional License Not Found",
      description: `Professional license "${licenseNumber}" in state ${state}${holderName ? ` for "${holderName}"` : ""} was not found in the state board database. This may indicate an invalid or fraudulent license.`,
      severity: "CRITICAL",
      evidence: JSON.parse(
        JSON.stringify({
          licenseNumber,
          state,
          holderName,
          boardResult: "NOT_FOUND",
          verificationSource: "State Board Database",
        }),
      ),
      confidence: 0.85,
      recommendedAction:
        "Verify the license number and state are correct. Request the applicant to provide proof of valid professional licensure from the issuing board.",
    },
  });
}

/**
 * Check 2: License is expired, suspended, or revoked.
 */
async function checkLicenseStatus(
  submissionId: string,
  tenantId: string,
  documentId: string,
  record: StateBoardRecord,
): Promise<void> {
  const statusMessages: Record<string, string> = {
    EXPIRED: `Professional license "${record.licenseNumber}" for "${record.holderName}" in ${record.state} is expired${record.expirationDate ? ` (expired ${record.expirationDate})` : ""}. Services rendered under an expired license may not be covered.`,
    SUSPENDED: `Professional license "${record.licenseNumber}" for "${record.holderName}" in ${record.state} is currently suspended. A suspended license indicates regulatory action has been taken against the licensee.`,
    REVOKED: `Professional license "${record.licenseNumber}" for "${record.holderName}" in ${record.state} has been revoked. A revoked license is a serious regulatory finding indicating the licensee is no longer authorized to practice.`,
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "API_VERIFY",
      indicatorName: `Professional License ${record.status}`,
      description: statusMessages[record.status] || `License status: ${record.status}`,
      severity: "CRITICAL",
      evidence: JSON.parse(
        JSON.stringify({
          licenseNumber: record.licenseNumber,
          holderName: record.holderName,
          state: record.state,
          licenseType: record.licenseType,
          licenseStatus: record.status,
          expirationDate: record.expirationDate,
          disciplinaryActions: record.disciplinaryActions,
          verificationSource: "State Board Database",
        }),
      ),
      confidence: 0.9,
      recommendedAction:
        "Do not accept coverage dependent on this professional license until the status is resolved. Require proof of current, active licensure.",
    },
  });
}

/**
 * Check 3: License scope mismatch — the license type/scope doesn't
 * match what's expected for the business operations.
 */
async function checkScopeMismatch(
  submissionId: string,
  tenantId: string,
  documentId: string,
  extractedData: ProfessionalLicenseExtractedData,
  boardRecord: StateBoardRecord,
): Promise<void> {
  // If we have both extracted scope and board scope, compare them
  if (!extractedData.scope || !boardRecord.scope) return;

  const extractedScope = extractedData.scope.toUpperCase().trim();
  const boardScope = boardRecord.scope.toUpperCase().trim();

  // Skip if they match or if one contains the other
  if (
    extractedScope === boardScope ||
    extractedScope.includes(boardScope) ||
    boardScope.includes(extractedScope)
  ) {
    return;
  }

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "API_VERIFY",
      indicatorName: "Professional License Scope Mismatch",
      description: `Professional license "${boardRecord.licenseNumber}" has a scope of "${boardRecord.scope}" per the state board, but the submitted document indicates "${extractedData.scope}". The license may not cover the stated professional services.`,
      severity: "HIGH",
      evidence: JSON.parse(
        JSON.stringify({
          licenseNumber: boardRecord.licenseNumber,
          holderName: boardRecord.holderName,
          state: boardRecord.state,
          submittedScope: extractedData.scope,
          boardScope: boardRecord.scope,
          licenseType: boardRecord.licenseType,
          verificationSource: "State Board Database + Professional License Document",
        }),
      ),
      confidence: 0.7,
      recommendedAction:
        "Verify that the professional's license scope covers the services being insured. Request clarification on any scope discrepancy.",
    },
  });
}

// ─── Main Function ──────────────────────────────────────

/**
 * Verify professional licenses from PROFESSIONAL_LICENSE documents
 * against state board databases.
 *
 * For each professional license document:
 * 1. Extract license number, state, and holder info
 * 2. Query state board database (mock for MVP)
 * 3. Flag: not found (CRITICAL), expired/suspended/revoked (CRITICAL), scope mismatch (HIGH)
 *
 * Creates FraudIndicator records with category API_VERIFY.
 */
export async function verifyProfessionalLicense(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Find all professional license documents
  const licenseDocs = await findExtractedData<ProfessionalLicenseExtractedData>(
    submissionId,
    "PROFESSIONAL_LICENSE",
  );

  if (licenseDocs.length === 0) return; // Skip gracefully if no license docs

  for (const { data, documentId } of licenseDocs) {
    // Need at least a license number to verify
    if (!data.licenseNumber) continue;

    const state = data.state || "UNKNOWN";

    // Query state board with retry
    let boardRecord: StateBoardRecord;
    try {
      boardRecord = await withRetry(() =>
        queryStateBoard(data.licenseNumber!, state, data.holderName),
      );
    } catch {
      log.error(
        { licenseNumber: data.licenseNumber, state, submissionId },
        "state board API failed, skipping license verification"
      );
      continue;
    }

    // Check 1: License not found
    if (boardRecord.status === "NOT_FOUND") {
      await checkLicenseNotFound(
        submissionId,
        tenantId,
        documentId,
        data.licenseNumber,
        state,
        data.holderName,
      );
      continue; // No further checks possible
    }

    // Run remaining checks in parallel
    await Promise.all([
      // Check 2: License expired/suspended/revoked
      boardRecord.status !== "ACTIVE"
        ? checkLicenseStatus(submissionId, tenantId, documentId, boardRecord)
        : Promise.resolve(),

      // Check 3: Scope mismatch
      checkScopeMismatch(
        submissionId,
        tenantId,
        documentId,
        data,
        boardRecord,
      ),
    ]);
  }
}
