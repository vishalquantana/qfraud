import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";
import { toJsonValue } from "@/lib/utils";

// ─── Extracted data types ────────────────────────────────

interface FieldConfidence {
  confidence: number;
  source: "regex" | "keyword" | "form-field";
}

interface Officer {
  name: string;
  title: string;
}

export interface EntityDocExtractedData {
  entityName: string | null;
  entityType: string | null;
  stateOfIncorporation: string | null;
  incorporationDate: string | null;
  registeredAgent: string | null;
  registeredAgentAddress: string | null;
  officers: Officer[];
  ein: string | null;
  _metadata: Record<string, FieldConfidence>;
}

// ─── Extraction helpers ─────────────────────────────────

function extractField(
  text: string,
  patterns: RegExp[],
  source: "regex" | "keyword" | "form-field" = "regex",
): { value: string; confidence: FieldConfidence } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const value = match[1].trim();
      if (value.length > 0) {
        return {
          value,
          confidence: { confidence: 0.7, source },
        };
      }
    }
  }
  return null;
}

// ─── Field extraction functions ──────────────────────────

function extractEntityName(text: string) {
  return extractField(text, [
    /(?:ENTITY|COMPANY|BUSINESS|CORPORATION)\s*NAME[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,100})/i,
    /NAME\s+OF\s+(?:ENTITY|COMPANY|CORPORATION|LLC|ORGANIZATION)[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,100})/i,
    /ARTICLES\s+OF\s+(?:INCORPORATION|ORGANIZATION)\s+(?:OF|FOR)[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,100})/i,
    /CERTIFICATE\s+OF\s+(?:FORMATION|INCORPORATION|ORGANIZATION)\s+(?:OF|FOR)[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,100})/i,
    /(?:HEREBY\s+)?(?:FORMED?|ORGANIZED?|INCORPORATED?)\s+(?:UNDER\s+THE\s+NAME)[:\s]*([A-Z][A-Za-z0-9\s,.&'-]{2,100})/i,
  ]);
}

function extractEntityType(
  text: string,
): { value: string; confidence: FieldConfidence } | null {
  const typePatterns: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /LIMITED\s+LIABILITY\s+COMPANY/i, type: "LLC" },
    { pattern: /\bLLC\b/i, type: "LLC" },
    { pattern: /\bL\.L\.C\./i, type: "LLC" },
    { pattern: /\bCORPORATION\b/i, type: "Corporation" },
    { pattern: /\bCORP\.?\b/i, type: "Corporation" },
    { pattern: /\bINC(?:ORPORATED)?\.?\b/i, type: "Corporation" },
    { pattern: /\bS[\s-]?CORP(?:ORATION)?\b/i, type: "S-Corporation" },
    { pattern: /\bC[\s-]?CORP(?:ORATION)?\b/i, type: "C-Corporation" },
    { pattern: /LIMITED\s+PARTNERSHIP/i, type: "Limited Partnership" },
    { pattern: /\bL\.?P\.?\b(?!\.)(?=\s|$)/i, type: "Limited Partnership" },
    { pattern: /GENERAL\s+PARTNERSHIP/i, type: "General Partnership" },
    { pattern: /SOLE\s+PROPRIETOR(?:SHIP)?/i, type: "Sole Proprietorship" },
    { pattern: /LIMITED\s+LIABILITY\s+PARTNERSHIP/i, type: "LLP" },
    { pattern: /\bLLP\b/i, type: "LLP" },
    { pattern: /PROFESSIONAL\s+(?:CORPORATION|ASSOCIATION)/i, type: "Professional Corporation" },
    { pattern: /\bP\.?C\.?\b(?=\s|$)/i, type: "Professional Corporation" },
    { pattern: /NON[\s-]?PROFIT/i, type: "Non-Profit" },
    { pattern: /NOT[\s-]?FOR[\s-]?PROFIT/i, type: "Non-Profit" },
    { pattern: /\b501\s*\(\s*c\s*\)/i, type: "Non-Profit" },
  ];

  // Try explicit entity type field first
  const explicitResult = extractField(text, [
    /ENTITY\s+TYPE[:\s]*([A-Za-z\s.-]{2,40})/i,
    /TYPE\s+OF\s+(?:ENTITY|ORGANIZATION|BUSINESS)[:\s]*([A-Za-z\s.-]{2,40})/i,
    /FORM\s+OF\s+(?:ENTITY|ORGANIZATION|BUSINESS)[:\s]*([A-Za-z\s.-]{2,40})/i,
    /BUSINESS\s+TYPE[:\s]*([A-Za-z\s.-]{2,40})/i,
  ]);

  if (explicitResult) {
    // Normalize the explicit value
    for (const { pattern, type } of typePatterns) {
      if (pattern.test(explicitResult.value)) {
        return {
          value: type,
          confidence: { confidence: 0.8, source: "regex" },
        };
      }
    }
    return explicitResult;
  }

  // Fall back to scanning the full text for type keywords
  for (const { pattern, type } of typePatterns) {
    if (pattern.test(text)) {
      return {
        value: type,
        confidence: { confidence: 0.6, source: "keyword" },
      };
    }
  }

  return null;
}

function extractStateOfIncorporation(text: string) {
  // US state names and abbreviations
  const statePattern =
    "(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\\s+Hampshire|New\\s+Jersey|New\\s+Mexico|New\\s+York|North\\s+Carolina|North\\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\\s+Island|South\\s+Carolina|South\\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\\s+Virginia|Wisconsin|Wyoming|District\\s+of\\s+Columbia|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)";

  return extractField(text, [
    new RegExp(
      `STATE\\s+OF\\s+(?:INCORPORATION|FORMATION|ORGANIZATION)[:\\s]*(${statePattern})`,
      "i",
    ),
    new RegExp(
      `(?:INCORPORATED|FORMED|ORGANIZED)\\s+(?:IN|UNDER\\s+THE\\s+LAWS\\s+OF)\\s+(?:THE\\s+STATE\\s+OF\\s+)?(${statePattern})`,
      "i",
    ),
    new RegExp(
      `(?:JURISDICTION|DOMICILE)[:\\s]*(${statePattern})`,
      "i",
    ),
    new RegExp(
      `LAWS\\s+OF\\s+(?:THE\\s+STATE\\s+OF\\s+)?(${statePattern})`,
      "i",
    ),
  ]);
}

function extractIncorporationDate(text: string) {
  return extractField(text, [
    /DATE\s+OF\s+(?:INCORPORATION|FORMATION|ORGANIZATION)[:\s]*([\d/.-]+)/i,
    /(?:INCORPORATED|FORMED|ORGANIZED)\s+(?:ON|DATE)[:\s]*([\d/.-]+)/i,
    /FILING\s+DATE[:\s]*([\d/.-]+)/i,
    /DATE\s+FILED[:\s]*([\d/.-]+)/i,
    /EFFECTIVE\s+DATE[:\s]*([\d/.-]+)/i,
  ]);
}

function extractRegisteredAgent(text: string) {
  return extractField(text, [
    /REGISTERED\s+AGENT[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /AGENT\s+FOR\s+SERVICE\s+OF\s+PROCESS[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /STATUTORY\s+AGENT[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
    /RESIDENT\s+AGENT[:\s]*([A-Z][A-Za-z\s,.&'-]{2,80})/i,
  ]);
}

function extractRegisteredAgentAddress(text: string) {
  return extractField(text, [
    /REGISTERED\s+(?:AGENT\s+)?(?:OFFICE\s+)?ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,150})/i,
    /AGENT(?:'?S)?\s+ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,150})/i,
    /PRINCIPAL\s+(?:OFFICE\s+)?ADDRESS[:\s]*([A-Za-z0-9\s,.#'-]{5,150})/i,
    /REGISTERED\s+OFFICE[:\s]*([A-Za-z0-9\s,.#'-]{5,150})/i,
  ]);
}

function extractOfficers(
  text: string,
): { value: Officer[]; confidence: FieldConfidence } | null {
  const officers: Officer[] = [];
  const titles = [
    "CEO",
    "CFO",
    "COO",
    "CTO",
    "PRESIDENT",
    "VICE\\s+PRESIDENT",
    "VP",
    "SECRETARY",
    "TREASURER",
    "DIRECTOR",
    "CHAIRMAN",
    "MANAGER",
    "MANAGING\\s+MEMBER",
    "MEMBER",
    "GENERAL\\s+PARTNER",
    "PARTNER",
    "PRINCIPAL",
    "OWNER",
    "CHIEF\\s+EXECUTIVE\\s+OFFICER",
    "CHIEF\\s+FINANCIAL\\s+OFFICER",
    "CHIEF\\s+OPERATING\\s+OFFICER",
  ];

  const titleGroupPattern = titles.join("|");

  // Pattern 1: Title followed by name (e.g., "President: John Smith")
  const titleFirstPattern = new RegExp(
    `(${titleGroupPattern})[:\\s]+([A-Z][A-Za-z\\s,.'-]{2,60})`,
    "gi",
  );
  let match;
  while ((match = titleFirstPattern.exec(text)) !== null) {
    const title = match[1].trim().replace(/\s+/g, " ");
    const name = match[2].trim();
    // Skip if name looks like an address or generic text
    if (!/^\d|STREET|AVENUE|DRIVE|SUITE|ADDRESS/i.test(name)) {
      officers.push({ name, title });
    }
  }

  // Pattern 2: Name followed by title (e.g., "John Smith, President")
  if (officers.length === 0) {
    const nameFirstPattern = new RegExp(
      `([A-Z][A-Za-z\\s,.'-]{2,40}?)\\s*[,–-]\\s*(${titleGroupPattern})`,
      "gi",
    );
    while ((match = nameFirstPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const title = match[2].trim().replace(/\s+/g, " ");
      if (!/^\d|STREET|AVENUE|DRIVE|SUITE|ADDRESS/i.test(name)) {
        officers.push({ name, title });
      }
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  const unique = officers.filter((o) => {
    const key = o.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length > 0) {
    return {
      value: unique,
      confidence: { confidence: 0.6, source: "regex" },
    };
  }
  return null;
}

function extractEIN(text: string) {
  return extractField(text, [
    /(?:EIN|FEIN|EMPLOYER\s+IDENTIFICATION\s+NUMBER|FEDERAL\s+(?:EMPLOYER\s+)?ID(?:ENTIFICATION)?(?:\s+NUMBER)?|TAX\s+ID(?:ENTIFICATION)?(?:\s+NUMBER)?)[:\s#]*(\d{2}-?\d{7})/i,
    /(?:TIN|TAXPAYER\s+IDENTIFICATION\s+NUMBER)[:\s#]*(\d{2}-?\d{7})/i,
  ]);
}

// ─── PDF text extraction helper ──────────────────────────

async function extractPdfText(s3Key: string): Promise<string> {
  const fileBuffer = await getFromS3(s3Key);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
  const result = await parser.getText();
  const text = result.text;
  await parser.destroy();
  return text;
}

// ─── Main extraction function ────────────────────────────

/**
 * Extract structured fields from a business entity document
 * (e.g., Articles of Incorporation, Certificate of Formation, LLC Operating Agreement).
 *
 * Reads the PDF content from S3 and uses regex/pattern-based extraction
 * to identify entity name, type, incorporation details, registered agent,
 * officers, and EIN.
 *
 * Updates the document record with extractedData JSON and sets status to ANALYZED.
 */
export async function extractEntityDocument(
  documentId: string,
): Promise<EntityDocExtractedData> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });

  try {
    const text = await extractPdfText(doc.s3Key);

    const metadata: Record<string, FieldConfidence> = {};

    // Extract all fields
    const entityNameResult = extractEntityName(text);
    const entityTypeResult = extractEntityType(text);
    const stateOfIncorporationResult = extractStateOfIncorporation(text);
    const incorporationDateResult = extractIncorporationDate(text);
    const registeredAgentResult = extractRegisteredAgent(text);
    const registeredAgentAddressResult = extractRegisteredAgentAddress(text);
    const officersResult = extractOfficers(text);
    const einResult = extractEIN(text);

    // Build metadata
    if (entityNameResult) metadata.entityName = entityNameResult.confidence;
    if (entityTypeResult) metadata.entityType = entityTypeResult.confidence;
    if (stateOfIncorporationResult)
      metadata.stateOfIncorporation = stateOfIncorporationResult.confidence;
    if (incorporationDateResult)
      metadata.incorporationDate = incorporationDateResult.confidence;
    if (registeredAgentResult) metadata.registeredAgent = registeredAgentResult.confidence;
    if (registeredAgentAddressResult)
      metadata.registeredAgentAddress = registeredAgentAddressResult.confidence;
    if (officersResult) metadata.officers = officersResult.confidence;
    if (einResult) metadata.ein = einResult.confidence;

    const extractedData: EntityDocExtractedData = {
      entityName: entityNameResult?.value ?? null,
      entityType: entityTypeResult?.value ?? null,
      stateOfIncorporation: stateOfIncorporationResult?.value ?? null,
      incorporationDate: incorporationDateResult?.value ?? null,
      registeredAgent: registeredAgentResult?.value ?? null,
      registeredAgentAddress: registeredAgentAddressResult?.value ?? null,
      officers: officersResult?.value ?? [],
      ein: einResult?.value ?? null,
      _metadata: metadata,
    };

    // Update document with extracted data and set status to ANALYZED
    await prisma.document.update({
      where: { id: documentId },
      data: {
        extractedData: toJsonValue(extractedData),
        status: "ANALYZED",
      },
    });

    return extractedData;
  } catch (error) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ERROR" },
    });
    throw error;
  }
}
