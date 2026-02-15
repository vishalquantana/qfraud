import { getFromS3 } from "@/lib/s3";
import { createLogger } from "@/lib/logger";

const log = createLogger("extraction-ocr");

// ─── Types ──────────────────────────────────────────────

export interface SmartTextResult {
  /** Extracted text content. */
  text: string;
  /** How the text was extracted. */
  source: "pdf-parse" | "tesseract-ocr";
  /** Whether OCR was used for this extraction. */
  isOcr: boolean;
  /** Number of pages in the document (if available). */
  pageCount?: number;
}

// ─── Constants ──────────────────────────────────────────

/** File extensions that are images (not PDFs). */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"]);

/**
 * Minimum characters per page to consider a PDF as having real text content.
 * Below this threshold, we assume the PDF is scanned/image-based.
 */
const MIN_CHARS_PER_PAGE = 50;

// ─── Public API ─────────────────────────────────────────

/**
 * Detect whether a PDF appears to be image-based (scanned) based on
 * the amount of text extracted via pdf-parse.
 *
 * @param extractedText - Text returned by pdf-parse
 * @param pageCount - Number of pages in the PDF
 * @returns true if the PDF likely contains scanned images rather than selectable text
 */
export function isImageBasedPdf(extractedText: string, pageCount: number): boolean {
  const trimmed = extractedText.trim();
  if (trimmed.length === 0) return true;
  const charsPerPage = trimmed.length / Math.max(1, pageCount);
  return charsPerPage < MIN_CHARS_PER_PAGE;
}

/**
 * Extract text from an image buffer using Tesseract.js OCR.
 *
 * @param imageBuffer - Raw image bytes (PNG, JPEG, TIFF, etc.)
 * @returns Recognized text
 */
export async function ocrExtractText(imageBuffer: Buffer): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imageBuffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Smart text extraction that tries pdf-parse first, then falls back to
 * Tesseract.js OCR for scanned/image-based documents.
 *
 * For image files (jpg, png, etc.), it goes directly to OCR.
 *
 * @param s3Key - S3 key for the document
 * @returns Extracted text with metadata about the extraction method
 */
export async function extractTextSmart(s3Key: string): Promise<SmartTextResult> {
  const fileBuffer = await getFromS3(s3Key);
  const ext = getFileExtension(s3Key);

  // Image files → go directly to OCR
  if (IMAGE_EXTENSIONS.has(ext)) {
    log.info({ s3Key }, "image file detected, using OCR directly");
    const text = await ocrExtractText(fileBuffer);
    return { text, source: "tesseract-ocr", isOcr: true };
  }

  // PDF files → try pdf-parse first
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
  const parseResult = await parser.getText();
  const pageCount = (parseResult as { numpages?: number }).numpages ?? 1;
  await parser.destroy();

  const pdfText = parseResult.text ?? "";

  // Check if the PDF has meaningful text content
  if (!isImageBasedPdf(pdfText, pageCount)) {
    return {
      text: pdfText,
      source: "pdf-parse",
      isOcr: false,
      pageCount,
    };
  }

  // PDF is scanned/image-based → fall back to OCR
  log.info({ s3Key, pageCount }, "scanned PDF detected, falling back to OCR");
  const ocrText = await ocrExtractText(fileBuffer);
  return {
    text: ocrText,
    source: "tesseract-ocr",
    isOcr: true,
    pageCount,
  };
}

// ─── Helpers ────────────────────────────────────────────

function getFileExtension(key: string): string {
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1) return "";
  return key.substring(lastDot).toLowerCase();
}
