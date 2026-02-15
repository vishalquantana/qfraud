import { prisma } from "@/lib/prisma";
import type { Acord125ExtractedData } from "@/services/extraction-acord125";
import type { EntityDocExtractedData } from "@/services/extraction-entity-doc";

// ─── Types ──────────────────────────────────────────────

export type AddressClassification =
  | "RESIDENTIAL"
  | "COMMERCIAL"
  | "VIRTUAL_OFFICE"
  | "PO_BOX";

export interface AddressClassificationResult {
  classification: AddressClassification;
  confidence: number;
  indicators: string[];
}

export interface EINValidationResult {
  ein: string;
  issuanceDate: string | null;
  monthsBeforeApplication: number | null;
  flagged: boolean;
}

// ─── Address Classification ─────────────────────────────

/**
 * Keywords that indicate PO Box addresses.
 */
const PO_BOX_PATTERNS = [
  /\bp\.?\s*o\.?\s*box\b/i,
  /\bpost\s*office\s*box\b/i,
  /\bpo\s*box\b/i,
  /\bpob\s+\d/i,
];

/**
 * Keywords that indicate virtual office addresses.
 */
const VIRTUAL_OFFICE_INDICATORS = [
  "virtual office",
  "virtual address",
  "mail drop",
  "mailbox",
  " pmb ",
  "private mailbox",
  "registered agent",
  "regus ",
  "wework ",
  "spaces ",
  "industrious ",
  "hq ",
];

/**
 * Patterns that indicate commercial addresses.
 */
const COMMERCIAL_INDICATORS = [
  /\bsuite\s+#?\w+/i,
  /\bste\s+#?\w+/i,
  /\bfloor\s+\d+/i,
  /\bfl\s+\d+/i,
  /\bunit\s+#?\w+/i,
  /\bbldg\b/i,
  /\bbuilding\b/i,
  /\bindustrial\s+(park|blvd|drive|way)/i,
  /\bbusiness\s+(park|center|centre)/i,
  /\bcorporate\s+(center|centre|park|drive)/i,
  /\bcommerce\s+(blvd|drive|way|park)/i,
  /\boffice\s+(park|center|centre)/i,
  /\btower\b/i,
  /\bplaza\b/i,
];

/**
 * Patterns that indicate residential addresses.
 */
const RESIDENTIAL_INDICATORS = [
  /\bapt\.?\s+#?\w+/i,
  /\bapartment\s+#?\w+/i,
  /\bcondo\b/i,
  /\bcourt\b/i,
  /\blane\b/i,
  /\bterrace\b/i,
  /\bcircle\b/i,
  /\bplace\b/i,
  /\bway\b/i,
  /\bdrive\b(?!\s*(park|center|centre|corporate|business|commerce))/i,
];

/**
 * Classify an address as RESIDENTIAL, COMMERCIAL, VIRTUAL_OFFICE, or PO_BOX.
 *
 * Uses heuristic pattern matching. In production, this would call an address
 * validation API (USPS, Google, Smarty/SmartyStreets).
 */
export function classifyAddress(address: string): AddressClassificationResult {
  const indicators: string[] = [];

  // Check PO Box first (highest priority)
  for (const pattern of PO_BOX_PATTERNS) {
    if (pattern.test(address)) {
      indicators.push("PO Box pattern detected");
      return {
        classification: "PO_BOX",
        confidence: 0.95,
        indicators,
      };
    }
  }

  // Check virtual office indicators
  const lower = address.toLowerCase();
  for (const keyword of VIRTUAL_OFFICE_INDICATORS) {
    if (lower.includes(keyword.toLowerCase())) {
      indicators.push(`Virtual office keyword: "${keyword.trim()}"`);
    }
  }

  if (indicators.length > 0) {
    return {
      classification: "VIRTUAL_OFFICE",
      confidence: 0.8,
      indicators,
    };
  }

  // Score commercial vs residential
  let commercialScore = 0;
  let residentialScore = 0;

  for (const pattern of COMMERCIAL_INDICATORS) {
    if (pattern.test(address)) {
      commercialScore++;
      indicators.push(`Commercial pattern: ${pattern.source}`);
    }
  }

  for (const pattern of RESIDENTIAL_INDICATORS) {
    if (pattern.test(address)) {
      residentialScore++;
      indicators.push(`Residential pattern: ${pattern.source}`);
    }
  }

  if (commercialScore > residentialScore) {
    return {
      classification: "COMMERCIAL",
      confidence: Math.min(0.5 + commercialScore * 0.15, 0.85),
      indicators,
    };
  }

  if (residentialScore > 0) {
    return {
      classification: "RESIDENTIAL",
      confidence: Math.min(0.5 + residentialScore * 0.15, 0.85),
      indicators,
    };
  }

  // Default to commercial with low confidence (most business addresses lack strong indicators)
  return {
    classification: "COMMERCIAL",
    confidence: 0.4,
    indicators: ["No strong classification signals — defaulting to commercial"],
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
 * Mock EIN issuance date lookup.
 *
 * In production, this would check against IRS records or a third-party
 * EIN verification service. The mock returns a deterministic date based
 * on EIN patterns for testing:
 * - EINs starting with "99" → filed 3 months ago (should trigger flag)
 * - EINs starting with "88" → filed 1 month ago (should trigger flag)
 * - All others → filed 2 years ago (should not trigger flag)
 */
async function lookupEINIssuanceDate(ein: string): Promise<string | null> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 30));

  const normalized = ein.replace(/-/g, "");

  if (normalized.startsWith("99")) {
    // Recent EIN — 3 months ago
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().split("T")[0];
  }

  if (normalized.startsWith("88")) {
    // Very recent EIN — 1 month ago
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split("T")[0];
  }

  // Default: filed 2 years ago
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString().split("T")[0];
}

/**
 * Mock web presence check.
 *
 * In production, this would check:
 * - Domain registration (WHOIS)
 * - Google search results
 * - LinkedIn company page
 * - BBB listing
 *
 * For MVP, uses keyword-based deterministic results:
 * - Entity names containing "no web" or "nowebsite" → no web presence
 * - All others → web presence found
 */
async function checkWebPresence(entityName: string): Promise<{
  hasWebPresence: boolean;
  indicators: string[];
}> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 30));

  const nameLower = entityName.toLowerCase();

  if (
    nameLower.includes("no web") ||
    nameLower.includes("nowebsite") ||
    nameLower.includes("no presence")
  ) {
    return {
      hasWebPresence: false,
      indicators: [
        "No company website found",
        "No LinkedIn company page found",
        "No BBB listing found",
        "No Google business profile found",
      ],
    };
  }

  return {
    hasWebPresence: true,
    indicators: [
      "Company website found",
      "LinkedIn company page found",
    ],
  };
}

// ─── Address Verification Checks ────────────────────────

/**
 * Check if registered agent or business address is a virtual office or PO box
 * for a commercial entity.
 */
async function checkAddressClassification(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  // Check business addresses from ACORD 125
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );

  if (acord125) {
    const addresses = [
      {
        label: "Physical Address",
        value: acord125.data.physicalAddress,
      },
      {
        label: "Mailing Address",
        value: acord125.data.mailingAddress,
      },
    ];

    for (const addr of addresses) {
      if (!addr.value) continue;

      const result = classifyAddress(addr.value);

      if (
        result.classification === "VIRTUAL_OFFICE" ||
        result.classification === "PO_BOX"
      ) {
        await prisma.fraudIndicator.create({
          data: {
            submissionId,
            tenantId,
            documentId: acord125.documentId,
            category: "ENTITY_INTEL",
            indicatorName: `Business ${addr.label} Classified as ${result.classification.replace("_", " ")}`,
            description: `The business ${addr.label.toLowerCase()} "${addr.value}" has been classified as a ${result.classification === "PO_BOX" ? "PO Box" : "virtual office"} address. Commercial entities typically operate from physical business locations.`,
            severity: "MEDIUM",
            evidence: JSON.parse(
              JSON.stringify({
                addressField: addr.label,
                address: addr.value,
                classification: result.classification,
                classificationConfidence: result.confidence,
                classificationIndicators: result.indicators,
                verificationSource: "Address Classification Heuristic",
              }),
            ),
            confidence: result.confidence,
            recommendedAction:
              "Request verification of the physical business location. Ask for utility bills or lease agreements as proof of physical presence.",
          },
        });
      }
    }
  }

  // Check entity document registered agent address
  const entityDoc = await findExtractedData<EntityDocExtractedData>(
    submissionId,
    "ENTITY_DOC",
  );

  if (entityDoc && entityDoc.data.registeredAgentAddress) {
    const result = classifyAddress(entityDoc.data.registeredAgentAddress);

    if (
      result.classification === "VIRTUAL_OFFICE" ||
      result.classification === "PO_BOX"
    ) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId,
          tenantId,
          documentId: entityDoc.documentId,
          category: "ENTITY_INTEL",
          indicatorName: `Registered Agent Address Classified as ${result.classification.replace("_", " ")}`,
          description: `The registered agent address "${entityDoc.data.registeredAgentAddress}" has been classified as a ${result.classification === "PO_BOX" ? "PO Box" : "virtual office"} address, which may indicate a shell entity without physical business presence.`,
          severity: "MEDIUM",
          evidence: JSON.parse(
            JSON.stringify({
              addressField: "Registered Agent Address",
              address: entityDoc.data.registeredAgentAddress,
              registeredAgent: entityDoc.data.registeredAgent,
              classification: result.classification,
              classificationConfidence: result.confidence,
              classificationIndicators: result.indicators,
              verificationSource: "Address Classification Heuristic",
            }),
          ),
          confidence: result.confidence,
          recommendedAction:
            "Verify that the business has a legitimate physical location separate from the registered agent address.",
        },
      });
    }
  }
}

// ─── EIN Validation ─────────────────────────────────────

/**
 * Validate EIN timing — flag if EIN was filed less than 6 months
 * before the application date.
 */
async function checkEINTiming(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  // Get EIN from entity documents
  const entityDoc = await findExtractedData<EntityDocExtractedData>(
    submissionId,
    "ENTITY_DOC",
  );

  if (!entityDoc || !entityDoc.data.ein) return;

  const ein = entityDoc.data.ein;

  // Look up EIN issuance date
  const issuanceDate = await lookupEINIssuanceDate(ein);
  if (!issuanceDate) return;

  // Get application date from ACORD 125 or submission creation
  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );

  let applicationDate: Date;
  if (acord125?.data.effectiveDate) {
    const parsed = new Date(acord125.data.effectiveDate);
    applicationDate = isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    // Fallback to submission creation date
    const submission = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { createdAt: true },
    });
    applicationDate = submission.createdAt;
  }

  const issuance = new Date(issuanceDate);
  if (isNaN(issuance.getTime())) return;

  // Calculate months between EIN issuance and application
  const monthsDiff =
    (applicationDate.getFullYear() - issuance.getFullYear()) * 12 +
    (applicationDate.getMonth() - issuance.getMonth());

  if (monthsDiff < 6) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: entityDoc.documentId,
        category: "ENTITY_INTEL",
        indicatorName: "Recently Filed EIN",
        description: `The Federal EIN (${ein}) was filed approximately ${monthsDiff} month(s) before the application date. Recently obtained EINs may indicate a newly created entity established for fraudulent purposes.`,
        severity: "HIGH",
        evidence: JSON.parse(
          JSON.stringify({
            ein,
            einIssuanceDate: issuanceDate,
            applicationDate: applicationDate.toISOString().split("T")[0],
            monthsBeforeApplication: monthsDiff,
            threshold: 6,
            verificationSource: "EIN Issuance Date Lookup",
          }),
        ),
        confidence: 0.75,
        recommendedAction:
          "Verify the legitimacy of the business. Request additional documentation such as tax returns, bank statements, or business licenses to confirm the entity is operational.",
      },
    });
  }
}

// ─── Web Presence Check ─────────────────────────────────

/**
 * Check if a recently incorporated business (<2 years) has web presence.
 * Flag if no web presence is found.
 */
async function checkWebPresenceForNewEntity(
  submissionId: string,
  tenantId: string,
): Promise<void> {
  // Get entity info
  const entityDoc = await findExtractedData<EntityDocExtractedData>(
    submissionId,
    "ENTITY_DOC",
  );

  const acord125 = await findExtractedData<Acord125ExtractedData>(
    submissionId,
    "ACORD_125",
  );

  // Determine incorporation date
  let incorporationDate: Date | null = null;
  let documentId = "";
  let entityName = "";

  if (entityDoc?.data.incorporationDate) {
    const parsed = new Date(entityDoc.data.incorporationDate);
    if (!isNaN(parsed.getTime())) {
      incorporationDate = parsed;
      documentId = entityDoc.documentId;
      entityName = entityDoc.data.entityName || "";
    }
  }

  // Fallback: use yearEstablished from ACORD 125
  if (!incorporationDate && acord125?.data.yearEstablished) {
    const year = parseInt(acord125.data.yearEstablished, 10);
    if (!isNaN(year)) {
      incorporationDate = new Date(year, 0, 1); // Jan 1 of that year
      documentId = acord125.documentId;
      entityName = acord125.data.businessName || acord125.data.applicantName || "";
    }
  }

  if (!incorporationDate || !entityName) return;

  // Check if incorporated less than 2 years ago
  const now = new Date();
  const yearsOld =
    (now.getTime() - incorporationDate.getTime()) /
    (365.25 * 24 * 60 * 60 * 1000);

  if (yearsOld >= 2) return;

  // Check web presence
  const webPresence = await checkWebPresence(entityName);

  if (!webPresence.hasWebPresence) {
    const state =
      entityDoc?.data.stateOfIncorporation ||
      extractStateFromAddress(
        acord125?.data.physicalAddress || acord125?.data.mailingAddress || null,
      );

    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: documentId || null,
        category: "ENTITY_INTEL",
        indicatorName: "New Entity with No Web Presence",
        description: `Business "${entityName}" was incorporated less than ${yearsOld.toFixed(1)} years ago and has no detectable web presence. Legitimate businesses typically establish an online presence early in their operations.`,
        severity: "HIGH",
        evidence: JSON.parse(
          JSON.stringify({
            entityName,
            incorporationDate: incorporationDate.toISOString().split("T")[0],
            entityAgeYears: parseFloat(yearsOld.toFixed(1)),
            state: state || "Unknown",
            webPresenceChecks: webPresence.indicators,
            verificationSource: "Web Presence Heuristic + Entity Documents",
          }),
        ),
        confidence: 0.7,
        recommendedAction:
          "Verify the legitimacy of this business. Request proof of operations such as client contracts, bank statements, or physical business verification.",
      },
    });
  }
}

// ─── Main Functions ─────────────────────────────────────

/**
 * Validate EIN timing and check for web presence of new entities.
 *
 * Flags:
 * - EIN filed <6 months before application date → HIGH
 * - Business incorporated <2 years with no web presence → HIGH
 * - Registered agent or business address classified as virtual office/PO box → MEDIUM
 */
export async function validateEIN(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Run all checks in parallel
  await Promise.all([
    checkAddressClassification(submissionId, tenantId),
    checkEINTiming(submissionId, tenantId),
    checkWebPresenceForNewEntity(submissionId, tenantId),
  ]);
}
