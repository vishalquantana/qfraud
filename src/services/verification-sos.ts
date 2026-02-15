import { prisma } from "@/lib/prisma";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { EntityDocExtractedData } from "@/services/extraction-entity-doc";

// ─── Types ──────────────────────────────────────────────

export interface SOSRecord {
  entityName: string;
  status: "ACTIVE" | "INACTIVE" | "DISSOLVED" | "SUSPENDED" | "NOT_FOUND";
  stateOfIncorporation: string;
  incorporationDate: string | null;
  registeredAgent: string | null;
  registeredAgentAddress: string | null;
  filingDate: string | null;
}

export interface SOSApiResponse {
  found: boolean;
  record: SOSRecord | null;
  error?: string;
}

// ─── Mock SOS API ───────────────────────────────────────

/**
 * Mock SOS API that simulates a Secretary of State entity lookup.
 * Replace this with a real state API integration in production.
 *
 * The mock returns a deterministic result based on the entity name:
 * - Names containing "phantom" or "shell" → NOT_FOUND
 * - Names containing "dissolved" → DISSOLVED
 * - Names containing "suspended" → SUSPENDED
 * - Names containing "inactive" → INACTIVE
 * - All others → ACTIVE with a simulated record
 */
async function querySOS(
  entityName: string,
  state: string,
): Promise<SOSApiResponse> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 50));

  const nameLower = entityName.toLowerCase();

  if (nameLower.includes("phantom") || nameLower.includes("shell")) {
    return { found: false, record: null };
  }

  if (nameLower.includes("dissolved")) {
    return {
      found: true,
      record: {
        entityName,
        status: "DISSOLVED",
        stateOfIncorporation: state,
        incorporationDate: "2015-03-15",
        registeredAgent: "CT Corporation System",
        registeredAgentAddress: "123 Main St, Suite 100, " + state,
        filingDate: "2023-01-01",
      },
    };
  }

  if (nameLower.includes("suspended")) {
    return {
      found: true,
      record: {
        entityName,
        status: "SUSPENDED",
        stateOfIncorporation: state,
        incorporationDate: "2018-06-10",
        registeredAgent: "LegalZoom Registered Agent",
        registeredAgentAddress: "PO Box 4567, " + state,
        filingDate: "2022-06-15",
      },
    };
  }

  if (nameLower.includes("inactive")) {
    return {
      found: true,
      record: {
        entityName,
        status: "INACTIVE",
        stateOfIncorporation: state,
        incorporationDate: "2020-01-20",
        registeredAgent: "Incorp Services Inc",
        registeredAgentAddress: "Virtual Office Center, 789 Commerce Blvd, " + state,
        filingDate: "2021-12-01",
      },
    };
  }

  // Default: return an active entity
  return {
    found: true,
    record: {
      entityName,
      status: "ACTIVE",
      stateOfIncorporation: state,
      incorporationDate: "2019-07-22",
      registeredAgent: "National Registered Agents Inc",
      registeredAgentAddress: "456 Business Park Dr, " + state,
      filingDate: "2024-01-15",
    },
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
 * Extract entity name and state from ACORD 125 or entity documents.
 */
async function extractEntityInfo(submissionId: string): Promise<{
  entityName: string;
  state: string;
  documentId: string;
} | null> {
  // Try ACORD 125 first (most common source)
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );

  if (acord125) {
    const name = acord125.data.businessName || acord125.data.applicantName;
    const state = extractStateFromAddress(
      acord125.data.physicalAddress || acord125.data.mailingAddress,
    );
    if (name && state) {
      return { entityName: name, state, documentId: acord125.documentId };
    }
  }

  // Fallback to entity documents
  const entityDoc = await findExtractedData<EntityDocExtractedData>(
    submissionId,
    "ENTITY_DOC",
  );

  if (entityDoc) {
    const name = entityDoc.data.entityName;
    const state =
      entityDoc.data.stateOfIncorporation ||
      extractStateFromAddress(entityDoc.data.registeredAgentAddress);
    if (name && state) {
      return { entityName: name, state, documentId: entityDoc.documentId };
    }
  }

  return null;
}

/**
 * Extract 2-letter state code from an address string.
 */
function extractStateFromAddress(address: string | null): string | null {
  if (!address) return null;

  // Match common state abbreviation patterns: ", CA 90210" or ", CA,"
  const stateZipMatch = address.match(
    /,\s*([A-Z]{2})\s+\d{5}/,
  );
  if (stateZipMatch) return stateZipMatch[1];

  const stateCommaMatch = address.match(/,\s*([A-Z]{2})\s*,/);
  if (stateCommaMatch) return stateCommaMatch[1];

  // Try trailing state code: "... CA"
  const trailingMatch = address.match(/\b([A-Z]{2})$/);
  if (trailingMatch) return trailingMatch[1];

  return null;
}

/**
 * Check if an address indicates a virtual office or PO box.
 */
function isVirtualOfficeOrPOBox(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower.includes("po box") ||
    lower.includes("p.o. box") ||
    lower.includes("p.o box") ||
    lower.includes("virtual office") ||
    lower.includes("virtual address") ||
    lower.includes("mail drop") ||
    lower.includes("mailbox") ||
    lower.includes("pmb") ||
    /\bsuite\s+#?\d+.*\bvirtual\b/i.test(address) ||
    /\bc\/o\b.*\bagent\b/i.test(address)
  );
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
 * Check 1: Entity not found in SOS records.
 */
async function checkEntityNotFound(
  submissionId: string,
  tenantId: string,
  documentId: string,
  entityName: string,
): Promise<void> {
  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "ENTITY_INTEL",
      indicatorName: "Entity Not Found in SOS Records",
      description: `Business entity "${entityName}" was not found in the Secretary of State records. This may indicate a fictitious or unregistered entity.`,
      severity: "CRITICAL",
      evidence: JSON.parse(
        JSON.stringify({
          entityName,
          sosResult: "NOT_FOUND",
          verificationSource: "Secretary of State",
        }),
      ),
      confidence: 0.85,
      recommendedAction:
        "Verify the entity name spelling and state. Request proof of entity registration from the applicant.",
    },
  });
}

/**
 * Check 2: Entity is inactive or dissolved.
 */
async function checkEntityInactive(
  submissionId: string,
  tenantId: string,
  documentId: string,
  record: SOSRecord,
): Promise<void> {
  const statusDescriptions: Record<string, string> = {
    INACTIVE:
      "The entity is listed as inactive in state records, meaning it may no longer be authorized to conduct business.",
    DISSOLVED:
      "The entity has been dissolved according to state records. It is no longer a legal entity.",
    SUSPENDED:
      "The entity has been suspended by the state, often due to non-compliance with filing or tax requirements.",
  };

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "ENTITY_INTEL",
      indicatorName: `Entity Status: ${record.status}`,
      description: statusDescriptions[record.status] || `Entity status is ${record.status}.`,
      severity: "CRITICAL",
      evidence: JSON.parse(
        JSON.stringify({
          entityName: record.entityName,
          entityStatus: record.status,
          stateOfIncorporation: record.stateOfIncorporation,
          incorporationDate: record.incorporationDate,
          filingDate: record.filingDate,
          verificationSource: "Secretary of State",
        }),
      ),
      confidence: 0.9,
      recommendedAction:
        "Contact the applicant to confirm entity status. Verify if the entity has been reinstated or if a successor entity exists.",
    },
  });
}

/**
 * Check 3: Entity incorporated less than 2 years ago with mature operations claimed.
 */
async function checkRecentIncorporation(
  submissionId: string,
  tenantId: string,
  documentId: string,
  record: SOSRecord,
  acord125Data: Acord125ExtractedData | null,
): Promise<void> {
  if (!record.incorporationDate) return;

  const incDate = new Date(record.incorporationDate);
  if (isNaN(incDate.getTime())) return;

  const now = new Date();
  const yearsOld =
    (now.getTime() - incDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (yearsOld >= 2) return;

  // Check for indicators of mature operations
  const matureIndicators: string[] = [];

  if (acord125Data) {
    if (
      acord125Data.yearEstablished &&
      parseInt(acord125Data.yearEstablished, 10) < now.getFullYear() - 3
    ) {
      matureIndicators.push(
        `Year established on application (${acord125Data.yearEstablished}) predates incorporation by ${Math.round(now.getFullYear() - parseInt(acord125Data.yearEstablished, 10) - yearsOld)} years`,
      );
    }
    if (acord125Data.annualRevenue && acord125Data.annualRevenue > 1000000) {
      matureIndicators.push(
        `High annual revenue ($${acord125Data.annualRevenue.toLocaleString()}) for a ${yearsOld.toFixed(1)}-year-old entity`,
      );
    }
    if (
      acord125Data.numberOfEmployees &&
      acord125Data.numberOfEmployees > 20
    ) {
      matureIndicators.push(
        `${acord125Data.numberOfEmployees} employees for a ${yearsOld.toFixed(1)}-year-old entity`,
      );
    }
  }

  if (matureIndicators.length === 0) return;

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "ENTITY_INTEL",
      indicatorName: "Recently Incorporated Entity with Mature Operations",
      description: `Entity was incorporated only ${yearsOld.toFixed(1)} years ago but claims operational maturity that doesn't match its age.`,
      severity: "HIGH",
      evidence: JSON.parse(
        JSON.stringify({
          entityName: record.entityName,
          incorporationDate: record.incorporationDate,
          entityAgeYears: parseFloat(yearsOld.toFixed(1)),
          matureIndicators,
          verificationSource: "Secretary of State + ACORD 125",
        }),
      ),
      confidence: 0.75,
      recommendedAction:
        "Request explanation for the discrepancy between incorporation date and claimed business maturity. Verify if business was acquired or reorganized.",
    },
  });
}

/**
 * Check 4: Registered agent address is a virtual office or PO box.
 */
async function checkRegisteredAgentAddress(
  submissionId: string,
  tenantId: string,
  documentId: string,
  record: SOSRecord,
): Promise<void> {
  if (!record.registeredAgentAddress) return;

  if (!isVirtualOfficeOrPOBox(record.registeredAgentAddress)) return;

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "ENTITY_INTEL",
      indicatorName: "Registered Agent at Virtual Office / PO Box",
      description:
        "The registered agent address appears to be a virtual office or PO Box, which may indicate a shell entity without a physical business presence.",
      severity: "MEDIUM",
      evidence: JSON.parse(
        JSON.stringify({
          entityName: record.entityName,
          registeredAgent: record.registeredAgent,
          registeredAgentAddress: record.registeredAgentAddress,
          addressClassification: "VIRTUAL_OFFICE_OR_PO_BOX",
          verificationSource: "Secretary of State",
        }),
      ),
      confidence: 0.7,
      recommendedAction:
        "Request physical business address verification. Check if the applicant has a legitimate business location.",
    },
  });
}

// ─── Main Function ──────────────────────────────────────

/**
 * Verify business entity against Secretary of State records.
 *
 * Extracts entity name and state from ACORD 125 or entity documents,
 * queries the SOS API (mock for MVP), and creates FraudIndicator
 * records for any findings.
 *
 * Flags:
 * - Entity not found → CRITICAL
 * - Entity inactive/dissolved/suspended → CRITICAL
 * - Incorporated <2 years with mature operations → HIGH
 * - Registered agent at virtual office/PO box → MEDIUM
 */
export async function verifyEntity(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Extract entity info from available documents
  const entityInfo = await extractEntityInfo(submissionId);
  if (!entityInfo) return; // Skip gracefully if no entity info available

  const { entityName, state, documentId } = entityInfo;

  // Query SOS with retry logic
  let sosResponse: SOSApiResponse;
  try {
    sosResponse = await withRetry(() => querySOS(entityName, state));
  } catch {
    // API failure — add to manual verification queue (log and skip)
    console.error(
      `SOS API failed for submission ${submissionId}, entity "${entityName}" in ${state}. Adding to manual verification queue.`,
    );
    return;
  }

  // Get ACORD 125 data for mature operations check
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );

  // Check 1: Entity not found
  if (!sosResponse.found || !sosResponse.record) {
    await checkEntityNotFound(submissionId, tenantId, documentId, entityName);
    return; // No further checks possible without a record
  }

  const record = sosResponse.record;

  // Run remaining checks in parallel
  await Promise.all([
    // Check 2: Entity inactive/dissolved/suspended
    record.status !== "ACTIVE"
      ? checkEntityInactive(submissionId, tenantId, documentId, record)
      : Promise.resolve(),

    // Check 3: Recently incorporated with mature operations
    checkRecentIncorporation(
      submissionId,
      tenantId,
      documentId,
      record,
      acord125?.data ?? null,
    ),

    // Check 4: Registered agent at virtual office/PO box
    checkRegisteredAgentAddress(submissionId, tenantId, documentId, record),
  ]);
}
