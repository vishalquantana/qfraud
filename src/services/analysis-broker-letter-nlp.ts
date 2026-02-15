import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";
import type { LossRunExtractedData } from "@/services/extraction-loss-run";

// ─── Types ──────────────────────────────────────────────

interface MatchedPhrase {
  phrase: string;
  context: string;
  patternCategory: string;
}

// ─── Keyword Pattern Libraries ──────────────────────────

/** Phrases indicating urgency or time pressure on the underwriter */
const PRESSURE_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\burgent(?:ly)?\b/i, category: "urgency" },
  { pattern: /\btime[- ]sensitive\b/i, category: "urgency" },
  { pattern: /\bneed\s+(?:a\s+)?quick\s+(?:response|turnaround|answer|decision)\b/i, category: "urgency" },
  { pattern: /\bexpir(?:ing|es?)\s+today\b/i, category: "urgency" },
  { pattern: /\basap\b/i, category: "urgency" },
  { pattern: /\bimmediate(?:ly)?\b/i, category: "urgency" },
  { pattern: /\brush(?:ed|ing)?\b/i, category: "urgency" },
  { pattern: /\bdeadline\s+(?:is\s+)?today\b/i, category: "urgency" },
  { pattern: /\bcannot\s+wait\b/i, category: "urgency" },
  { pattern: /\btime\s+is\s+(?:of\s+the\s+essence|running\s+out)\b/i, category: "urgency" },
  { pattern: /\bneed\s+(?:this|it)\s+(?:done|processed|bound)\s+(?:today|now|immediately)\b/i, category: "urgency" },
  { pattern: /\blast[- ]minute\b/i, category: "urgency" },
  { pattern: /\bcritical\s+deadline\b/i, category: "urgency" },
];

/** Phrases attempting to influence underwriter to overlook issues */
const MANIPULATION_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\bignore\b/i, category: "manipulation" },
  { pattern: /\boverlook\b/i, category: "manipulation" },
  { pattern: /\bdisregard\b/i, category: "manipulation" },
  { pattern: /\bdon'?t\s+worry\s+about\b/i, category: "manipulation" },
  { pattern: /\bminor\s+issue\b/i, category: "manipulation" },
  { pattern: /\bnot\s+(?:a\s+)?(?:big\s+)?concern\b/i, category: "manipulation" },
  { pattern: /\bjust\s+a\s+(?:formality|technicality)\b/i, category: "manipulation" },
  { pattern: /\bskip\s+(?:the\s+)?(?:usual|normal|standard)\b/i, category: "manipulation" },
  { pattern: /\bno\s+need\s+to\s+(?:review|check|verify|look\s+at)\b/i, category: "manipulation" },
  { pattern: /\bpush\s+(?:this|it)\s+through\b/i, category: "manipulation" },
  { pattern: /\bfast[- ]track\b/i, category: "manipulation" },
  { pattern: /\bbypass\b/i, category: "manipulation" },
  { pattern: /\bwaive\s+(?:the\s+)?(?:requirement|review)\b/i, category: "manipulation" },
  { pattern: /\bmake\s+an?\s+exception\b/i, category: "manipulation" },
];

/** Phrases suggesting prior coverage was declined elsewhere */
const DECLINATION_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\bdeclined\b/i, category: "declination" },
  { pattern: /\bnon[- ]renew(?:al|ed)\b/i, category: "declination" },
  { pattern: /\bcancell?(?:ed|ation)\b/i, category: "declination" },
  { pattern: /\brefused?\b/i, category: "declination" },
  { pattern: /\bturn(?:ed)?\s+(?:down|away)\b/i, category: "declination" },
  { pattern: /\brejected?\b/i, category: "declination" },
  { pattern: /\bunable\s+to\s+(?:place|find|secure)\s+coverage\b/i, category: "declination" },
  { pattern: /\bdifficulty\s+(?:finding|placing|securing)\s+coverage\b/i, category: "declination" },
  { pattern: /\bmarket(?:s?)?\s+(?:have\s+)?(?:declined|refused|passed)\b/i, category: "declination" },
];

// ─── Helpers ────────────────────────────────────────────

async function extractPdfText(s3Key: string): Promise<string> {
  const fileBuffer = await getFromS3(s3Key);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
  const result = await parser.getText();
  const text = result.text;
  await parser.destroy();
  return text;
}

/**
 * Extract text surrounding a match for context (up to ~100 chars each side).
 */
function getMatchContext(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 80);
  const end = Math.min(text.length, match.index + match[0].length + 80);
  let context = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) context = "..." + context;
  if (end < text.length) context = context + "...";
  return context;
}

/**
 * Scan text for all matches against a pattern library.
 */
function scanForPatterns(
  text: string,
  patterns: Array<{ pattern: RegExp; category: string }>,
): MatchedPhrase[] {
  const matches: MatchedPhrase[] = [];
  const seenPhrases = new Set<string>();

  for (const { pattern, category } of patterns) {
    // Create a global version for scanning
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    let match: RegExpExecArray | null;

    while ((match = globalPattern.exec(text)) !== null) {
      const phrase = match[0].toLowerCase();
      if (seenPhrases.has(phrase)) continue;
      seenPhrases.add(phrase);

      matches.push({
        phrase: match[0],
        context: getMatchContext(text, match),
        patternCategory: category,
      });
    }
  }

  return matches;
}

// ─── NLP Analysis Checks ────────────────────────────────

/**
 * Check 1: Detect pressure language (urgency, rush, deadlines).
 * Severity: MEDIUM
 */
async function checkPressureLanguage(
  text: string,
  documentId: string,
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const matches = scanForPatterns(text, PRESSURE_PATTERNS);
  if (matches.length === 0) return;

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "NLP",
      indicatorName: "BROKER_PRESSURE_LANGUAGE",
      description: `Broker submission letter contains ${matches.length} pressure/urgency phrase(s): ${matches.map((m) => `"${m.phrase}"`).join(", ")}. Pressure tactics may be used to rush underwriting review and bypass standard due diligence.`,
      severity: "MEDIUM",
      evidence: JSON.parse(
        JSON.stringify({
          matchCount: matches.length,
          matchedPhrases: matches,
          documentId,
          analysisType: "pressure_language_detection",
        }),
      ),
      confidence: Math.min(0.5 + matches.length * 0.1, 0.9),
      recommendedAction:
        "Review the broker letter carefully for unusual urgency. Apply standard underwriting timelines regardless of pressure. Verify that claimed deadlines are legitimate.",
    },
  });
}

/**
 * Check 2: Detect manipulation language (overlook, disregard, bypass).
 * Severity: HIGH
 */
async function checkManipulationLanguage(
  text: string,
  documentId: string,
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const matches = scanForPatterns(text, MANIPULATION_PATTERNS);
  if (matches.length === 0) return;

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "NLP",
      indicatorName: "BROKER_MANIPULATION_LANGUAGE",
      description: `Broker submission letter contains ${matches.length} manipulation phrase(s): ${matches.map((m) => `"${m.phrase}"`).join(", ")}. These phrases suggest an attempt to influence the underwriter to skip standard review procedures.`,
      severity: "HIGH",
      evidence: JSON.parse(
        JSON.stringify({
          matchCount: matches.length,
          matchedPhrases: matches,
          documentId,
          analysisType: "manipulation_detection",
        }),
      ),
      confidence: Math.min(0.6 + matches.length * 0.1, 0.95),
      recommendedAction:
        "Apply enhanced scrutiny to this submission. Ensure all standard underwriting checks are completed. Consider flagging the broker for monitoring.",
    },
  });
}

/**
 * Check 3: Detect concealment — broker letter doesn't mention known prior losses.
 * Cross-references extracted loss run data.
 * Severity: CRITICAL
 */
async function checkConcealment(
  text: string,
  documentId: string,
  submissionId: string,
  tenantId: string,
): Promise<void> {
  // Get all loss run documents for this submission
  const lossRunDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "LOSS_RUN" as never,
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (lossRunDocs.length === 0) return; // No loss runs to cross-reference

  // Collect all claims from loss runs
  let totalClaims = 0;
  const significantClaims: Array<{
    claimNumber: string | null;
    totalIncurred: number | null;
    dateOfLoss: string | null;
  }> = [];

  for (const doc of lossRunDocs) {
    if (!doc.extractedData) continue;
    const data = doc.extractedData as unknown as LossRunExtractedData;
    if (!data.claims) continue;

    totalClaims += data.claims.length;

    for (const claim of data.claims) {
      // Track claims with significant incurred amounts (>$10,000)
      if (claim.totalIncurred && claim.totalIncurred > 10000) {
        significantClaims.push({
          claimNumber: claim.claimNumber,
          totalIncurred: claim.totalIncurred,
          dateOfLoss: claim.dateOfLoss,
        });
      }
    }
  }

  if (totalClaims === 0 || significantClaims.length === 0) return;

  // Check if the broker letter mentions losses, claims, or incidents
  const textLower = text.toLowerCase();
  const lossDisclosureKeywords = [
    "loss", "claim", "incident", "accident", "damage",
    "injury", "lawsuit", "litigation", "settlement",
    "prior loss", "loss history", "claims history",
  ];

  const mentionsLosses = lossDisclosureKeywords.some((kw) =>
    textLower.includes(kw),
  );

  // If there are significant claims in loss runs but the broker letter
  // doesn't mention losses at all, flag as concealment
  if (!mentionsLosses) {
    const totalIncurred = significantClaims.reduce(
      (sum, c) => sum + (c.totalIncurred ?? 0),
      0,
    );

    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId,
        category: "NLP",
        indicatorName: "BROKER_LOSS_CONCEALMENT",
        description: `Broker submission letter makes no mention of losses, claims, or incidents, despite ${significantClaims.length} significant claim(s) totaling $${totalIncurred.toLocaleString()} found in submitted loss runs. This may indicate intentional concealment of loss history.`,
        severity: "CRITICAL",
        evidence: JSON.parse(
          JSON.stringify({
            significantClaimCount: significantClaims.length,
            totalIncurredAmount: totalIncurred,
            significantClaims,
            lossRunDocumentCount: lossRunDocs.length,
            totalClaimCount: totalClaims,
            brokerLetterMentionsLosses: false,
            documentId,
            analysisType: "concealment_detection",
          }),
        ),
        confidence: 0.8,
        recommendedAction:
          "Request the broker to explicitly address the loss history in their submission narrative. Cross-verify all claims against loss run data. Consider whether the omission is intentional.",
      },
    });
  }
}

/**
 * Check 4: Detect evidence of prior coverage declinations not disclosed.
 * Severity: HIGH
 */
async function checkDeclinationEvidence(
  text: string,
  documentId: string,
  submissionId: string,
  tenantId: string,
): Promise<void> {
  const matches = scanForPatterns(text, DECLINATION_PATTERNS);
  if (matches.length === 0) return;

  // If we find declination language, the broker may have inadvertently
  // disclosed prior declinations — check if this was formally declared
  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "NLP",
      indicatorName: "BROKER_DECLINATION_EVIDENCE",
      description: `Broker submission letter contains language suggesting prior coverage declinations or non-renewals: ${matches.map((m) => `"${m.phrase}"`).join(", ")}. Prior declinations should be formally disclosed in the application.`,
      severity: "HIGH",
      evidence: JSON.parse(
        JSON.stringify({
          matchCount: matches.length,
          matchedPhrases: matches,
          documentId,
          analysisType: "declination_detection",
        }),
      ),
      confidence: Math.min(0.6 + matches.length * 0.1, 0.9),
      recommendedAction:
        "Request formal disclosure of all prior carrier declinations, non-renewals, and cancellations. Verify the complete coverage history including any gaps.",
    },
  });
}

// ─── Main Export ─────────────────────────────────────────

/**
 * Analyze broker cover letter / submission narrative for concealment,
 * pressure tactics, and manipulation language.
 *
 * Checks:
 * 1. Pressure language detection (urgency, rush) — MEDIUM
 * 2. Manipulation language detection (overlook, disregard) — HIGH
 * 3. Concealment check: cross-reference with loss runs — CRITICAL
 * 4. Declination evidence: prior coverage declinations not disclosed — HIGH
 *
 * Creates FraudIndicator records with category NLP.
 * Starts with keyword/regex patterns, ready for transformer-based
 * intent detection upgrade.
 */
export async function analyzeBrokerLetter(
  submissionId: string,
): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Find all broker submission documents
  const brokerDocs = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "BROKER_SUBMISSION" as never,
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (brokerDocs.length === 0) return; // Gracefully skip if no broker letters

  for (const doc of brokerDocs) {
    // Extract text from the broker letter
    let text: string;
    try {
      text = await extractPdfText(doc.s3Key);
    } catch {
      // If text extraction fails, skip this document
      continue;
    }

    if (!text || text.trim().length < 20) continue; // Skip empty/minimal documents

    // Run all NLP checks in parallel
    await Promise.all([
      checkPressureLanguage(text, doc.id, submissionId, tenantId),
      checkManipulationLanguage(text, doc.id, submissionId, tenantId),
      checkConcealment(text, doc.id, submissionId, tenantId),
      checkDeclinationEvidence(text, doc.id, submissionId, tenantId),
    ]);
  }
}
