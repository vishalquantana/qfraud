import { prisma } from "@/lib/prisma";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { EntityDocExtractedData } from "@/services/extraction-entity-doc";
import type { COIExtractedData } from "@/services/extraction-coi";

// ─── Types ──────────────────────────────────────────────

interface EntityIdentifier {
  type: "name" | "ein" | "address" | "phone" | "officer" | "agent";
  value: string;
  source: string;
}

interface SubmissionIdentifiers {
  submissionId: string;
  insuredName: string;
  identifiers: EntityIdentifier[];
}

// ─── String Matching Utilities ──────────────────────────

function normalizeString(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "").slice(-10); // last 10 digits
}

function normalizeEIN(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  const matrix: number[][] = Array(aLen + 1)
    .fill(null)
    .map(() => Array(bLen + 1).fill(0) as number[]);

  for (let i = 0; i <= aLen; i++) matrix[i][0] = i;
  for (let j = 0; j <= bLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[aLen][bLen];
}

function stringSimilarity(a: string, b: string): number {
  const aNorm = normalizeString(a);
  const bNorm = normalizeString(b);
  if (aNorm.length === 0 || bNorm.length === 0) return 0;
  if (aNorm === bNorm) return 1.0;
  const maxLen = Math.max(aNorm.length, bNorm.length);
  return 1.0 - levenshteinDistance(aNorm, bNorm) / maxLen;
}

// ─── Extracted Data Helpers ─────────────────────────────

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

// ─── Identifier Extraction ──────────────────────────────

async function extractIdentifiers(
  submissionId: string,
): Promise<EntityIdentifier[]> {
  const identifiers: EntityIdentifier[] = [];

  // From ACORD 125
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );
  if (acord125?.data) {
    if (acord125.data.businessName) {
      identifiers.push({
        type: "name",
        value: acord125.data.businessName,
        source: "ACORD_125",
      });
    }
    if (acord125.data.applicantName) {
      identifiers.push({
        type: "name",
        value: acord125.data.applicantName,
        source: "ACORD_125",
      });
    }
    if (acord125.data.physicalAddress) {
      identifiers.push({
        type: "address",
        value: acord125.data.physicalAddress,
        source: "ACORD_125",
      });
    }
    if (acord125.data.mailingAddress) {
      identifiers.push({
        type: "address",
        value: acord125.data.mailingAddress,
        source: "ACORD_125",
      });
    }
  }

  // From Entity Document
  const entityDoc = await findExtractedData<EntityDocExtractedData>(
    submissionId,
    "ENTITY_DOC",
  );
  if (entityDoc?.data) {
    if (entityDoc.data.entityName) {
      identifiers.push({
        type: "name",
        value: entityDoc.data.entityName,
        source: "ENTITY_DOC",
      });
    }
    if (entityDoc.data.ein) {
      identifiers.push({
        type: "ein",
        value: entityDoc.data.ein,
        source: "ENTITY_DOC",
      });
    }
    if (entityDoc.data.officers?.length) {
      for (const officer of entityDoc.data.officers) {
        if (officer.name) {
          identifiers.push({
            type: "officer",
            value: officer.name,
            source: "ENTITY_DOC",
          });
        }
      }
    }
  }

  // From COI
  const coi = await findExtractedData<COIExtractedData>(submissionId, "COI");
  if (coi?.data) {
    if (coi.data.agentName) {
      identifiers.push({
        type: "agent",
        value: coi.data.agentName,
        source: "COI",
      });
    }
    if (coi.data.agentPhone) {
      identifiers.push({
        type: "phone",
        value: coi.data.agentPhone,
        source: "COI",
      });
    }
  }

  return identifiers;
}

// ─── Cross-Submission Matching ──────────────────────────

const NAME_SIMILARITY_THRESHOLD = 0.8;
const ADDRESS_SIMILARITY_THRESHOLD = 0.75;

// ─── Fraud Flag Checks ──────────────────────────────────

/**
 * Flag: same beneficial owner appearing in >2 unrelated submissions = CRITICAL
 */
async function checkRepeatedOwner(
  submissionId: string,
  tenantId: string,
  currentIdentifiers: EntityIdentifier[],
  allSubmissionIdentifiers: SubmissionIdentifiers[],
): Promise<void> {
  // Collect owner/entity names from current submission
  const ownerNames = currentIdentifiers
    .filter((id) => id.type === "name")
    .map((id) => id.value);

  if (ownerNames.length === 0) return;

  for (const ownerName of ownerNames) {
    const normalizedOwner = normalizeString(ownerName);
    if (!normalizedOwner) continue;

    // Find other submissions with similar owner names
    const matchingSubmissions: string[] = [];

    for (const sub of allSubmissionIdentifiers) {
      if (sub.submissionId === submissionId) continue;

      const otherNames = sub.identifiers
        .filter((id) => id.type === "name")
        .map((id) => id.value);

      for (const otherName of otherNames) {
        if (stringSimilarity(ownerName, otherName) >= NAME_SIMILARITY_THRESHOLD) {
          matchingSubmissions.push(sub.submissionId);
          break;
        }
      }
    }

    // >2 means at least 3 total (current + 2 others)
    if (matchingSubmissions.length >= 2) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          category: "ENTITY_INTEL",
          indicatorName: "Repeated Owner Across Submissions",
          description: `Beneficial owner "${ownerName}" appears across ${matchingSubmissions.length + 1} submissions (current + ${matchingSubmissions.length} others), which may indicate a fraud ring.`,
          severity: "CRITICAL",
          evidence: JSON.parse(
            JSON.stringify({
              ownerName,
              totalAppearances: matchingSubmissions.length + 1,
              matchedSubmissionIds: matchingSubmissions,
              matchMethod: "fuzzy_levenshtein",
              similarityThreshold: NAME_SIMILARITY_THRESHOLD,
            }),
          ),
          confidence: 0.85,
          recommendedAction:
            "Investigate potential fraud ring. Cross-reference the matched submissions for additional common identifiers such as addresses, phone numbers, or agents.",
        },
      });
    }
  }
}

/**
 * Flag: same address used across unrelated submissions = HIGH
 */
async function checkRepeatedAddress(
  submissionId: string,
  tenantId: string,
  currentIdentifiers: EntityIdentifier[],
  allSubmissionIdentifiers: SubmissionIdentifiers[],
): Promise<void> {
  const addresses = currentIdentifiers
    .filter((id) => id.type === "address")
    .map((id) => id.value);

  if (addresses.length === 0) return;

  for (const address of addresses) {
    const normalizedAddr = normalizeString(address);
    if (!normalizedAddr) continue;

    const matchingSubmissions: Array<{
      submissionId: string;
      matchedAddress: string;
      similarity: number;
    }> = [];

    for (const sub of allSubmissionIdentifiers) {
      if (sub.submissionId === submissionId) continue;

      const otherAddresses = sub.identifiers
        .filter((id) => id.type === "address")
        .map((id) => id.value);

      for (const otherAddr of otherAddresses) {
        const sim = stringSimilarity(address, otherAddr);
        if (sim >= ADDRESS_SIMILARITY_THRESHOLD) {
          matchingSubmissions.push({
            submissionId: sub.submissionId,
            matchedAddress: otherAddr,
            similarity: Math.round(sim * 100) / 100,
          });
          break;
        }
      }
    }

    if (matchingSubmissions.length > 0) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          category: "ENTITY_INTEL",
          indicatorName: "Shared Address Across Submissions",
          description: `Address "${address}" is shared with ${matchingSubmissions.length} other submission(s). Shared addresses across unrelated businesses may indicate shell companies or a fraud ring.`,
          severity: "HIGH",
          evidence: JSON.parse(
            JSON.stringify({
              address,
              matchedSubmissions: matchingSubmissions,
              matchMethod: "fuzzy_levenshtein",
              similarityThreshold: ADDRESS_SIMILARITY_THRESHOLD,
            }),
          ),
          confidence: 0.75,
          recommendedAction:
            "Verify whether the matched submissions represent truly unrelated businesses. Investigate if the address is a virtual office or mail drop.",
        },
      });
    }
  }
}

/**
 * Flag: same agent with >25% of submissions falling outside appetite = MEDIUM
 */
async function checkAgentSubmissionPattern(
  submissionId: string,
  tenantId: string,
  currentIdentifiers: EntityIdentifier[],
  allSubmissionIdentifiers: SubmissionIdentifiers[],
): Promise<void> {
  const agentNames = currentIdentifiers
    .filter((id) => id.type === "agent")
    .map((id) => id.value);

  if (agentNames.length === 0) return;

  for (const agentName of agentNames) {
    const normalizedAgent = normalizeString(agentName);
    if (!normalizedAgent) continue;

    // Find all submissions by this agent
    const agentSubmissionIds: string[] = [submissionId];

    for (const sub of allSubmissionIdentifiers) {
      if (sub.submissionId === submissionId) continue;

      const otherAgents = sub.identifiers
        .filter((id) => id.type === "agent")
        .map((id) => id.value);

      for (const otherAgent of otherAgents) {
        if (
          stringSimilarity(agentName, otherAgent) >= NAME_SIMILARITY_THRESHOLD
        ) {
          agentSubmissionIds.push(sub.submissionId);
          break;
        }
      }
    }

    // Need at least 4 submissions to evaluate the 25% threshold meaningfully
    if (agentSubmissionIds.length < 4) continue;

    // Check how many of the agent's submissions were declined or referred to SIU
    const outsideAppetite = await prisma.submission.count({
      where: {
        id: { in: agentSubmissionIds },
        tenantId,
        status: { in: ["DECLINED", "REFERRED_TO_SIU"] },
      },
    });

    const outsideAppetiteRate = outsideAppetite / agentSubmissionIds.length;

    if (outsideAppetiteRate > 0.25) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          category: "ENTITY_INTEL",
          indicatorName: "Agent High Decline/SIU Rate",
          description: `Agent "${agentName}" has ${outsideAppetite} out of ${agentSubmissionIds.length} submissions (${Math.round(outsideAppetiteRate * 100)}%) declined or referred to SIU, exceeding the 25% threshold.`,
          severity: "MEDIUM",
          evidence: JSON.parse(
            JSON.stringify({
              agentName,
              totalSubmissions: agentSubmissionIds.length,
              outsideAppetiteCount: outsideAppetite,
              outsideAppetiteRate:
                Math.round(outsideAppetiteRate * 100) / 100,
              threshold: 0.25,
              submissionIds: agentSubmissionIds,
            }),
          ),
          confidence: 0.7,
          recommendedAction:
            "Review the agent's submission history for patterns. A high decline rate may indicate the agent is knowingly submitting poor-quality or fraudulent applications.",
        },
      });
    }
  }
}

/**
 * Flag: same EIN across unrelated submissions = CRITICAL
 */
async function checkRepeatedEIN(
  submissionId: string,
  tenantId: string,
  currentIdentifiers: EntityIdentifier[],
  allSubmissionIdentifiers: SubmissionIdentifiers[],
): Promise<void> {
  const eins = currentIdentifiers
    .filter((id) => id.type === "ein")
    .map((id) => id.value);

  if (eins.length === 0) return;

  for (const ein of eins) {
    const normalizedEIN = normalizeEIN(ein);
    if (normalizedEIN.length < 9) continue;

    const matchingSubmissions: string[] = [];

    for (const sub of allSubmissionIdentifiers) {
      if (sub.submissionId === submissionId) continue;

      const otherEINs = sub.identifiers
        .filter((id) => id.type === "ein")
        .map((id) => id.value);

      for (const otherEIN of otherEINs) {
        if (normalizeEIN(otherEIN) === normalizedEIN) {
          matchingSubmissions.push(sub.submissionId);
          break;
        }
      }
    }

    if (matchingSubmissions.length > 0) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          category: "ENTITY_INTEL",
          indicatorName: "Duplicate EIN Across Submissions",
          description: `EIN "${ein}" appears in ${matchingSubmissions.length} other submission(s). The same tax ID across unrelated submissions is a strong fraud ring indicator.`,
          severity: "CRITICAL",
          evidence: JSON.parse(
            JSON.stringify({
              ein,
              matchedSubmissionIds: matchingSubmissions,
              matchMethod: "exact",
            }),
          ),
          confidence: 0.95,
          recommendedAction:
            "Immediately investigate the matched submissions. Duplicate EINs across unrelated entities is a strong indicator of identity fraud or shell company activity.",
        },
      });
    }
  }
}

/**
 * Flag: same phone number across unrelated submissions = HIGH
 */
async function checkRepeatedPhone(
  submissionId: string,
  tenantId: string,
  currentIdentifiers: EntityIdentifier[],
  allSubmissionIdentifiers: SubmissionIdentifiers[],
): Promise<void> {
  const phones = currentIdentifiers
    .filter((id) => id.type === "phone")
    .map((id) => id.value);

  if (phones.length === 0) return;

  for (const phone of phones) {
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 10) continue;

    const matchingSubmissions: string[] = [];

    for (const sub of allSubmissionIdentifiers) {
      if (sub.submissionId === submissionId) continue;

      const otherPhones = sub.identifiers
        .filter((id) => id.type === "phone")
        .map((id) => id.value);

      for (const otherPhone of otherPhones) {
        if (normalizePhone(otherPhone) === normalizedPhone) {
          matchingSubmissions.push(sub.submissionId);
          break;
        }
      }
    }

    if (matchingSubmissions.length > 0) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          category: "ENTITY_INTEL",
          indicatorName: "Shared Phone Number Across Submissions",
          description: `Phone number "${phone}" is shared with ${matchingSubmissions.length} other submission(s). Shared contact information across unrelated businesses may indicate connected entities.`,
          severity: "HIGH",
          evidence: JSON.parse(
            JSON.stringify({
              phone,
              matchedSubmissionIds: matchingSubmissions,
              matchMethod: "exact_normalized",
            }),
          ),
          confidence: 0.8,
          recommendedAction:
            "Verify whether the matched submissions share a legitimate business relationship. Shared phone numbers across unrelated entities may indicate coordinated fraud.",
        },
      });
    }
  }
}

// ─── Main Service ───────────────────────────────────────

/**
 * Cross-submission entity resolution.
 *
 * Extracts key entity identifiers (owner names, EINs, addresses, phone numbers,
 * agent names) from the submission and fuzzy-matches them against ALL other
 * submissions in the tenant's database.
 *
 * Flags:
 * - Same beneficial owner in >2 unrelated submissions → CRITICAL
 * - Same address across unrelated submissions → HIGH
 * - Same agent with >25% submissions outside appetite → MEDIUM
 * - Same EIN across submissions → CRITICAL (exact match)
 * - Same phone across submissions → HIGH (exact match)
 *
 * Uses Levenshtein distance for name/address comparison, exact match for EIN/phone.
 */
export async function resolveEntities(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  const tenantId = submission.tenantId;

  // Extract identifiers for the current submission
  const currentIdentifiers = await extractIdentifiers(submissionId);
  if (currentIdentifiers.length === 0) return;

  // Get all other submissions in tenant
  const otherSubmissions = await prisma.submission.findMany({
    where: {
      tenantId,
      id: { not: submissionId },
    },
    select: { id: true, insuredName: true },
  });

  // Extract identifiers for all other submissions
  const allSubmissionIdentifiers: SubmissionIdentifiers[] = [];

  for (const sub of otherSubmissions) {
    const ids = await extractIdentifiers(sub.id);
    allSubmissionIdentifiers.push({
      submissionId: sub.id,
      insuredName: sub.insuredName,
      identifiers: ids,
    });
  }

  // Run all checks in parallel
  await Promise.all([
    checkRepeatedOwner(
      submissionId,
      tenantId,
      currentIdentifiers,
      allSubmissionIdentifiers,
    ),
    checkRepeatedAddress(
      submissionId,
      tenantId,
      currentIdentifiers,
      allSubmissionIdentifiers,
    ),
    checkAgentSubmissionPattern(
      submissionId,
      tenantId,
      currentIdentifiers,
      allSubmissionIdentifiers,
    ),
    checkRepeatedEIN(
      submissionId,
      tenantId,
      currentIdentifiers,
      allSubmissionIdentifiers,
    ),
    checkRepeatedPhone(
      submissionId,
      tenantId,
      currentIdentifiers,
      allSubmissionIdentifiers,
    ),
  ]);
}
