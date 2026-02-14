import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";

// ─── Types ──────────────────────────────────────────────

interface PdfMetadata {
  author: string | null;
  producer: string | null;
  creator: string | null;
  creationDate: Date | null;
  modDate: Date | null;
  pageCount: number;
  hasTextLayer: boolean;
}

// ─── Known PDF software producers ───────────────────────

const KNOWN_SOFTWARE_PRODUCERS = [
  /adobe/i,
  /acrobat/i,
  /microsoft/i,
  /libreoffice/i,
  /openoffice/i,
  /chromium/i,
  /chrome/i,
  /firefox/i,
  /safari/i,
  /webkit/i,
  /wkhtmltopdf/i,
  /prince/i,
  /ghostscript/i,
  /pdftk/i,
  /itext/i,
  /reportlab/i,
  /fpdf/i,
  /tcpdf/i,
  /jasper/i,
  /crystal\s*reports/i,
  /sap/i,
  /oracle/i,
  /docusign/i,
  /nitro/i,
  /foxit/i,
  /pdf-?lib/i,
  /cairo/i,
  /poppler/i,
  /quartz/i,
  /scansnap/i,
  /xerox/i,
  /ricoh/i,
  /canon/i,
  /epson/i,
  /hp\s/i,
  /kofax/i,
  /abbyy/i,
  /nuance/i,
  /ssrs/i,
  /applied\s*systems/i,
  /vertafore/i,
  /ams\s*360/i,
  /sagitta/i,
  /imageright/i,
];

// ─── Metadata extraction ────────────────────────────────

/** Extract metadata from a PDF buffer using pdf-parse v2. */
async function extractPdfMetadata(buffer: Buffer): Promise<PdfMetadata> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  let textContent = "";
  let pageCount = 0;
  let info: Record<string, unknown> = {};
  let creationDate: Date | null = null;
  let modDate: Date | null = null;

  try {
    const textResult = await parser.getText();
    textContent = textResult?.text ?? "";

    const infoResult = await parser.getInfo();
    pageCount = infoResult?.total ?? 0;
    info = (infoResult?.info as Record<string, unknown>) ?? {};

    // Use getDateNode() for properly parsed dates
    const dateNode = infoResult?.getDateNode?.();
    if (dateNode) {
      creationDate = dateNode.CreationDate ?? null;
      modDate = dateNode.ModDate ?? null;
    }
  } catch {
    // If metadata extraction fails, we still attempt what we can
  } finally {
    await parser.destroy();
  }

  return {
    author: typeof info.Author === "string" ? info.Author : null,
    producer: typeof info.Producer === "string" ? info.Producer : null,
    creator: typeof info.Creator === "string" ? info.Creator : null,
    creationDate,
    modDate,
    pageCount,
    hasTextLayer: textContent.trim().length > 50,
  };
}

// ─── Forensic checks ───────────────────────────────────

/** Check if the producer/author looks like a personal name rather than software. */
function looksLikePersonalName(value: string | null): boolean {
  if (!value || value.trim().length === 0) return false;

  // If it matches known software, it's NOT a personal name
  for (const pattern of KNOWN_SOFTWARE_PRODUCERS) {
    if (pattern.test(value)) return false;
  }

  // Heuristic: personal names typically have 2-3 space-separated words,
  // all starting with uppercase, no numbers or special chars
  const words = value.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;

  const looksLikeName = words.every(
    (w) => /^[A-Z][a-z]+$/.test(w) || /^[A-Z]\.?$/.test(w),
  );
  return looksLikeName;
}

// ─── Main service ──────────────────────────────────────

/**
 * Analyze PDF metadata for a document to detect forged or altered documents.
 *
 * Checks:
 * 1. PDF creationDate after submission date → HIGH
 * 2. Multiple different PDF producers across pages (detected via producer string heuristics) → MEDIUM
 * 3. Author/producer is a personal name instead of software/carrier system → MEDIUM
 * 4. No text layer (image-only PDF) → MEDIUM
 *
 * Creates FraudIndicator records with category FORENSIC.
 */
export async function analyzePdfMetadata(documentId: string): Promise<void> {
  // Fetch the document and its submission
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { submission: true },
  });

  // Only analyze PDFs
  if (
    !document.fileType.includes("pdf") &&
    !document.fileName.toLowerCase().endsWith(".pdf")
  ) {
    return;
  }

  // Download the PDF from S3
  const buffer = await getFromS3(document.s3Key);
  const metadata = await extractPdfMetadata(buffer);

  const submissionDate = document.submission.createdAt;

  // ─── Check 1: Creation date after submission ──────────
  if (metadata.creationDate && submissionDate) {
    if (metadata.creationDate > submissionDate) {
      const daysDiff = Math.ceil(
        (metadata.creationDate.getTime() - submissionDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      await prisma.fraudIndicator.create({
        data: {
          submissionId: document.submissionId,
          tenantId: document.tenantId,
          documentId: document.id,
          category: "FORENSIC",
          indicatorName: "PDF_CREATED_AFTER_SUBMISSION",
          description: `PDF creation date (${metadata.creationDate.toISOString().split("T")[0]}) is ${daysDiff} day(s) after the submission date (${submissionDate.toISOString().split("T")[0]}). This may indicate the document was fabricated after submission.`,
          severity: "HIGH",
          evidence: JSON.parse(
            JSON.stringify({
              pdfCreationDate: metadata.creationDate.toISOString(),
              submissionDate: submissionDate.toISOString(),
              daysDifference: daysDiff,
              documentId: document.id,
              fileName: document.fileName,
            }),
          ),
          confidence: 0.8,
          recommendedAction:
            "Verify document authenticity with the issuing party. Request original documents with verifiable metadata.",
        },
      });
    }
  }

  // ─── Check 2: Multiple PDF producers ──────────────────
  // Detect if the document shows signs of being assembled from different sources.
  // We check if both producer and creator exist and differ significantly,
  // which suggests pages may have been combined from different tools.
  if (
    metadata.producer &&
    metadata.creator &&
    metadata.producer.toLowerCase() !== metadata.creator.toLowerCase()
  ) {
    // Only flag if they seem like genuinely different software (not just version differences)
    const producerBase = metadata.producer.split(/[\d(]/)[0].trim().toLowerCase();
    const creatorBase = metadata.creator.split(/[\d(]/)[0].trim().toLowerCase();

    if (producerBase !== creatorBase && producerBase.length > 0 && creatorBase.length > 0) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId: document.submissionId,
          tenantId: document.tenantId,
          documentId: document.id,
          category: "FORENSIC",
          indicatorName: "MULTIPLE_PDF_PRODUCERS",
          description: `Document was created with "${metadata.creator}" but produced/modified by "${metadata.producer}". Different creation and production tools may indicate document assembly from multiple sources.`,
          severity: "MEDIUM",
          evidence: JSON.parse(
            JSON.stringify({
              producer: metadata.producer,
              creator: metadata.creator,
              documentId: document.id,
              fileName: document.fileName,
            }),
          ),
          confidence: 0.6,
          recommendedAction:
            "Review the document for signs of assembly or modification. Compare against known carrier document formats.",
        },
      });
    }
  }

  // ─── Check 3: Personal name as author/producer ────────
  const authorIsPersonal = looksLikePersonalName(metadata.author);
  const producerIsPersonal = looksLikePersonalName(metadata.producer);

  if (authorIsPersonal || producerIsPersonal) {
    const flaggedField = authorIsPersonal ? "author" : "producer";
    const flaggedValue = authorIsPersonal
      ? metadata.author
      : metadata.producer;

    await prisma.fraudIndicator.create({
      data: {
        submissionId: document.submissionId,
        tenantId: document.tenantId,
        documentId: document.id,
        category: "FORENSIC",
        indicatorName: "PERSONAL_NAME_IN_PDF_METADATA",
        description: `PDF ${flaggedField} field contains a personal name ("${flaggedValue}") instead of expected software or carrier system name. Insurance documents are typically generated by carrier or agency management systems.`,
        severity: "MEDIUM",
        evidence: JSON.parse(
          JSON.stringify({
            field: flaggedField,
            value: flaggedValue,
            author: metadata.author,
            producer: metadata.producer,
            creator: metadata.creator,
            documentId: document.id,
            fileName: document.fileName,
          }),
        ),
        confidence: 0.55,
        recommendedAction:
          "Verify the document was issued by the stated carrier or agency. Request documents generated directly from the carrier system.",
      },
    });
  }

  // ─── Check 4: No text layer (image-only PDF) ──────────
  if (!metadata.hasTextLayer) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId: document.submissionId,
        tenantId: document.tenantId,
        documentId: document.id,
        category: "FORENSIC",
        indicatorName: "IMAGE_ONLY_PDF",
        description: `PDF contains no text layer (image-only). This prevents text-based verification and may indicate a scanned copy or modified document where text was removed to prevent analysis.`,
        severity: "MEDIUM",
        evidence: JSON.parse(
          JSON.stringify({
            hasTextLayer: false,
            pageCount: metadata.pageCount,
            documentId: document.id,
            fileName: document.fileName,
          }),
        ),
        confidence: 0.5,
        recommendedAction:
          "Request a text-based version of the document. If only scans are available, perform manual review of document contents.",
      },
    });
  }
}
