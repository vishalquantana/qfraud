import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { withTenantFilter } from "@/lib/rbac";
import { getStateFraudWarning, extractStateFromAddress } from "./state-fraud-warnings";

// ─── Types ──────────────────────────────────────────────

interface NoteEntry {
  userId: string;
  text: string;
  timestamp: string;
}

interface EvidenceEntry {
  type: string;
  url: string;
  description: string;
  timestamp: string;
}

interface ReportData {
  siuCase: {
    id: string;
    status: string;
    resolution: string | null;
    notes: NoteEntry[];
    evidence: EvidenceEntry[];
    createdAt: Date;
    updatedAt: Date;
    assignedTo: { name: string | null; email: string };
    submission: {
      id: string;
      insuredName: string;
      lineOfBusiness: string | null;
      riskScore: number | null;
      severity: string | null;
      status: string;
      channel: string;
      createdAt: Date;
      submitter: { name: string | null; email: string } | null;
    };
  };
  indicators: {
    id: string;
    category: string;
    indicatorName: string;
    description: string;
    severity: string;
    evidence: unknown;
    confidence: number;
    recommendedAction: string | null;
    isOverridden: boolean;
    createdAt: Date;
  }[];
  tenantName: string;
}

export type SIUReportType = "DOI_FRAUD_REFERRAL" | "INVESTIGATION_SUMMARY";

// ─── Severity & Category Labels ─────────────────────────

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const CATEGORY_LABELS: Record<string, string> = {
  CROSS_DOC: "Cross-Document Validation",
  FORENSIC: "Document Forensics",
  STATISTICAL: "Statistical Anomaly",
  TEMPORAL: "Temporal Analysis",
  RATIO: "Financial Ratio",
  ENTITY_INTEL: "Entity Intelligence",
  VISUAL_AI: "Visual AI",
  NLP: "Natural Language Processing",
  API_VERIFY: "API Verification",
  RULES: "Rules Engine",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  EVIDENCE_GATHERED: "Evidence Gathered",
  CONFIRMED_FRAUD: "Confirmed Fraud",
  FALSE_POSITIVE: "False Positive",
  INCONCLUSIVE: "Inconclusive",
};

// ─── Fetch report data ──────────────────────────────────

async function fetchReportData(
  caseId: string,
  tenantId: string
): Promise<ReportData> {
  const siuCase = await prisma.sIUCase.findFirst({
    where: withTenantFilter(tenantId, { id: caseId }),
    include: {
      submission: {
        select: {
          id: true,
          insuredName: true,
          lineOfBusiness: true,
          riskScore: true,
          severity: true,
          status: true,
          channel: true,
          createdAt: true,
          submitter: { select: { name: true, email: true } },
        },
      },
      assignedTo: { select: { name: true, email: true } },
    },
  });

  if (!siuCase) {
    throw new Error("SIU case not found");
  }

  const indicators = await prisma.fraudIndicator.findMany({
    where: withTenantFilter(tenantId, {
      submissionId: siuCase.submissionId,
    }),
    orderBy: { severity: "asc" },
  });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  return {
    siuCase: {
      ...siuCase,
      notes: siuCase.notes as unknown as NoteEntry[],
      evidence: siuCase.evidence as unknown as EvidenceEntry[],
      assignedTo: siuCase.assignedTo,
      submission: siuCase.submission,
    },
    indicators: indicators.map((i) => ({
      id: i.id,
      category: i.category,
      indicatorName: i.indicatorName,
      description: i.description,
      severity: i.severity,
      evidence: i.evidence,
      confidence: i.confidence,
      recommendedAction: i.recommendedAction,
      isOverridden: i.isOverridden,
      createdAt: i.createdAt,
    })),
    tenantName: tenant?.name ?? "Unknown Organization",
  };
}

// ─── Helper: format date ────────────────────────────────

function fmt(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Helper: draw horizontal rule ───────────────────────

function drawHR(doc: InstanceType<typeof PDFDocument>) {
  const y = doc.y + 5;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor("#cbd5e1")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);
}

// ─── Helper: section header ─────────────────────────────

function sectionHeader(
  doc: InstanceType<typeof PDFDocument>,
  title: string
) {
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor("#1e293b").text(title, { underline: false });
  drawHR(doc);
  doc.fontSize(10).fillColor("#334155");
}

// ─── Helper: key-value pair ─────────────────────────────

function kvPair(
  doc: InstanceType<typeof PDFDocument>,
  key: string,
  value: string
) {
  doc.font("Helvetica-Bold").text(`${key}: `, { continued: true });
  doc.font("Helvetica").text(value);
}

// ─── Generate DOI Fraud Referral PDF ────────────────────

function generateDOIFraudReferral(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        info: {
          Title: `DOI Fraud Referral - ${data.siuCase.submission.insuredName}`,
          Author: data.tenantName,
          Subject: "State DOI Fraud Referral Report",
          Creator: "Quantana Shield",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ── Header ──
      doc.fontSize(18).fillColor("#1e40af").text("FRAUD REFERRAL REPORT", {
        align: "center",
      });
      doc.fontSize(10).fillColor("#64748b").text(
        `State Department of Insurance Referral`,
        { align: "center" }
      );
      doc.moveDown(0.3);
      doc.fontSize(9).text(`Prepared by: ${data.tenantName}`, {
        align: "center",
      });
      doc.text(`Date Prepared: ${fmt(new Date())}`, { align: "center" });
      doc.text(`Case Reference: ${data.siuCase.id}`, { align: "center" });
      doc.moveDown(0.5);
      drawHR(doc);

      // ── Case Information ──
      sectionHeader(doc, "1. Case Information");
      kvPair(doc, "Case ID", data.siuCase.id);
      kvPair(doc, "Case Status", STATUS_LABELS[data.siuCase.status] ?? data.siuCase.status);
      kvPair(doc, "Date Opened", fmt(data.siuCase.createdAt));
      kvPair(
        doc,
        "Investigating Organization",
        data.tenantName
      );
      kvPair(
        doc,
        "Assigned Investigator",
        data.siuCase.assignedTo.name ?? data.siuCase.assignedTo.email
      );
      doc.moveDown(0.3);

      // ── Insured/Subject Information ──
      sectionHeader(doc, "2. Subject Information");
      kvPair(doc, "Insured Name", data.siuCase.submission.insuredName);
      kvPair(doc, "Line of Business", data.siuCase.submission.lineOfBusiness ?? "Not specified");
      kvPair(doc, "Submission Date", fmt(data.siuCase.submission.createdAt));
      kvPair(doc, "Submission Channel", data.siuCase.submission.channel);
      if (data.siuCase.submission.submitter) {
        kvPair(
          doc,
          "Submitting Broker",
          data.siuCase.submission.submitter.name ?? data.siuCase.submission.submitter.email
        );
      }
      doc.moveDown(0.3);

      // ── Risk Assessment ──
      sectionHeader(doc, "3. Risk Assessment Summary");
      kvPair(
        doc,
        "Risk Score",
        data.siuCase.submission.riskScore !== null
          ? `${data.siuCase.submission.riskScore}/100`
          : "Not scored"
      );
      kvPair(
        doc,
        "Severity Classification",
        SEVERITY_LABELS[data.siuCase.submission.severity ?? ""] ?? "N/A"
      );

      const activeIndicators = data.indicators.filter((i) => !i.isOverridden);
      kvPair(doc, "Total Fraud Indicators", String(activeIndicators.length));

      // Count by severity
      const sevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const ind of activeIndicators) {
        if (ind.severity in sevCounts) {
          sevCounts[ind.severity as keyof typeof sevCounts]++;
        }
      }
      kvPair(
        doc,
        "Indicator Breakdown",
        `Critical: ${sevCounts.CRITICAL}, High: ${sevCounts.HIGH}, Medium: ${sevCounts.MEDIUM}, Low: ${sevCounts.LOW}`
      );
      doc.moveDown(0.3);

      // ── Fraud Indicators (Detailed) ──
      sectionHeader(doc, "4. Detailed Fraud Findings");

      if (activeIndicators.length === 0) {
        doc.text("No active fraud indicators found for this submission.");
      } else {
        for (let i = 0; i < activeIndicators.length; i++) {
          const ind = activeIndicators[i];
          doc.moveDown(0.3);
          doc
            .font("Helvetica-Bold")
            .fillColor("#1e293b")
            .text(`${i + 1}. ${ind.indicatorName}`);
          doc.font("Helvetica").fillColor("#334155");
          kvPair(doc, "  Category", CATEGORY_LABELS[ind.category] ?? ind.category);
          kvPair(doc, "  Severity", SEVERITY_LABELS[ind.severity] ?? ind.severity);
          kvPair(doc, "  Confidence", `${Math.round(ind.confidence * 100)}%`);
          kvPair(doc, "  Description", ind.description);
          if (ind.recommendedAction) {
            kvPair(doc, "  Recommended Action", ind.recommendedAction);
          }

          // Evidence summary
          if (ind.evidence && typeof ind.evidence === "object") {
            const evidenceObj = ind.evidence as Record<string, unknown>;
            const evidenceEntries = Object.entries(evidenceObj).filter(
              ([, v]) => v !== null && v !== undefined
            );
            if (evidenceEntries.length > 0) {
              doc.font("Helvetica-Bold").text("  Supporting Evidence:");
              doc.font("Helvetica");
              for (const [key, val] of evidenceEntries) {
                const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                const valStr = typeof val === "object" ? JSON.stringify(val) : String(val);
                doc.text(`    ${label}: ${valStr}`, { indent: 10 });
              }
            }
          }
        }
      }
      doc.moveDown(0.3);

      // ── Evidence Collected ──
      sectionHeader(doc, "5. Evidence Collected During Investigation");
      if (data.siuCase.evidence.length === 0) {
        doc.text("No additional evidence collected.");
      } else {
        for (const ev of data.siuCase.evidence) {
          doc.moveDown(0.2);
          doc.font("Helvetica-Bold").text(`Type: ${ev.type}`);
          doc.font("Helvetica");
          doc.text(`Date: ${fmtDateTime(ev.timestamp)}`);
          doc.text(`Description: ${ev.description}`);
          if (ev.url) {
            doc.text(`Reference: ${ev.url}`);
          }
        }
      }
      doc.moveDown(0.3);

      // ── Resolution ──
      sectionHeader(doc, "6. Investigation Conclusion");
      kvPair(doc, "Final Status", STATUS_LABELS[data.siuCase.status] ?? data.siuCase.status);
      if (data.siuCase.resolution) {
        kvPair(doc, "Resolution Summary", data.siuCase.resolution);
      } else {
        doc.text("Investigation is ongoing. No final resolution yet.");
      }
      doc.moveDown(0.3);

      // ── State Fraud Warning ──
      sectionHeader(doc, "7. Fraud Warning Notice");
      // Try to extract state from submission data - use a default
      const stateCode = extractStateFromAddress(
        data.siuCase.submission.insuredName
      );
      const fraudWarning = getStateFraudWarning(stateCode);
      doc.fontSize(9).fillColor("#64748b").text(fraudWarning, {
        align: "justify",
      });
      doc.moveDown(0.5);

      // ── Certification ──
      drawHR(doc);
      doc.fontSize(9).fillColor("#64748b").text(
        "This report is prepared for submission to the appropriate State Department of Insurance. " +
        "The information contained herein is based on data collected during the investigation " +
        "and is believed to be accurate as of the date of preparation.",
        { align: "center" }
      );
      doc.moveDown(0.5);
      doc.text(
        `Report generated on ${fmtDateTime(new Date())} by ${data.tenantName} via Quantana Shield.`,
        { align: "center" }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Generate Internal Investigation Summary PDF ────────

function generateInvestigationSummary(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        info: {
          Title: `Investigation Summary - ${data.siuCase.submission.insuredName}`,
          Author: data.tenantName,
          Subject: "Internal Investigation Summary Report",
          Creator: "Quantana Shield",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ── Header ──
      doc
        .fontSize(18)
        .fillColor("#1e40af")
        .text("INTERNAL INVESTIGATION SUMMARY", { align: "center" });
      doc.fontSize(10).fillColor("#64748b").text("Confidential — For Internal Use Only", {
        align: "center",
      });
      doc.moveDown(0.3);
      doc.fontSize(9).text(`Organization: ${data.tenantName}`, {
        align: "center",
      });
      doc.text(`Date Prepared: ${fmt(new Date())}`, { align: "center" });
      doc.text(`Case Reference: ${data.siuCase.id}`, { align: "center" });
      doc.moveDown(0.5);
      drawHR(doc);

      // ── Case Overview ──
      sectionHeader(doc, "1. Case Overview");
      kvPair(doc, "Case ID", data.siuCase.id);
      kvPair(doc, "Case Status", STATUS_LABELS[data.siuCase.status] ?? data.siuCase.status);
      kvPair(doc, "Date Opened", fmt(data.siuCase.createdAt));
      kvPair(doc, "Last Updated", fmt(data.siuCase.updatedAt));
      kvPair(
        doc,
        "Assigned Investigator",
        data.siuCase.assignedTo.name ?? data.siuCase.assignedTo.email
      );
      doc.moveDown(0.3);

      // ── Subject Details ──
      sectionHeader(doc, "2. Subject Details");
      kvPair(doc, "Insured Name", data.siuCase.submission.insuredName);
      kvPair(doc, "Line of Business", data.siuCase.submission.lineOfBusiness ?? "Not specified");
      kvPair(doc, "Submission Date", fmt(data.siuCase.submission.createdAt));
      kvPair(doc, "Submission Channel", data.siuCase.submission.channel);
      kvPair(
        doc,
        "Submission Status",
        data.siuCase.submission.status
      );
      if (data.siuCase.submission.submitter) {
        kvPair(
          doc,
          "Submitting Broker",
          `${data.siuCase.submission.submitter.name ?? "N/A"} (${data.siuCase.submission.submitter.email})`
        );
      }
      doc.moveDown(0.3);

      // ── Risk Assessment ──
      sectionHeader(doc, "3. Risk Assessment");
      kvPair(
        doc,
        "Risk Score",
        data.siuCase.submission.riskScore !== null
          ? `${data.siuCase.submission.riskScore}/100`
          : "Not scored"
      );
      kvPair(
        doc,
        "Severity Classification",
        SEVERITY_LABELS[data.siuCase.submission.severity ?? ""] ?? "N/A"
      );

      // Category breakdown
      const catBreakdown: Record<string, number> = {};
      for (const ind of data.indicators) {
        catBreakdown[ind.category] = (catBreakdown[ind.category] ?? 0) + 1;
      }
      if (Object.keys(catBreakdown).length > 0) {
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").text("Indicators by Category:");
        doc.font("Helvetica");
        for (const [cat, count] of Object.entries(catBreakdown)) {
          doc.text(`  ${CATEGORY_LABELS[cat] ?? cat}: ${count}`, { indent: 10 });
        }
      }
      doc.moveDown(0.3);

      // ── All Fraud Indicators ──
      sectionHeader(doc, "4. Fraud Indicators (All)");
      if (data.indicators.length === 0) {
        doc.text("No fraud indicators generated for this submission.");
      } else {
        for (let i = 0; i < data.indicators.length; i++) {
          const ind = data.indicators[i];
          doc.moveDown(0.3);
          const overriddenLabel = ind.isOverridden ? " [OVERRIDDEN]" : "";
          doc
            .font("Helvetica-Bold")
            .fillColor(ind.isOverridden ? "#94a3b8" : "#1e293b")
            .text(`${i + 1}. ${ind.indicatorName}${overriddenLabel}`);
          doc.font("Helvetica").fillColor("#334155");
          kvPair(doc, "  Category", CATEGORY_LABELS[ind.category] ?? ind.category);
          kvPair(doc, "  Severity", SEVERITY_LABELS[ind.severity] ?? ind.severity);
          kvPair(doc, "  Confidence", `${Math.round(ind.confidence * 100)}%`);
          kvPair(doc, "  Description", ind.description);
          kvPair(doc, "  Detected", fmtDateTime(ind.createdAt));
          if (ind.recommendedAction) {
            kvPair(doc, "  Recommended Action", ind.recommendedAction);
          }

          // Evidence summary
          if (ind.evidence && typeof ind.evidence === "object") {
            const evidenceObj = ind.evidence as Record<string, unknown>;
            const evidenceEntries = Object.entries(evidenceObj).filter(
              ([, v]) => v !== null && v !== undefined
            );
            if (evidenceEntries.length > 0) {
              doc.font("Helvetica-Bold").text("  Supporting Evidence:");
              doc.font("Helvetica");
              for (const [key, val] of evidenceEntries) {
                const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                const valStr = typeof val === "object" ? JSON.stringify(val) : String(val);
                doc.text(`    ${label}: ${valStr}`, { indent: 10 });
              }
            }
          }
        }
      }
      doc.moveDown(0.3);

      // ── Investigation Timeline ──
      sectionHeader(doc, "5. Investigation Timeline");

      // Build timeline entries
      const timeline: { timestamp: string; label: string; detail: string }[] = [];
      timeline.push({
        timestamp: data.siuCase.createdAt.toISOString(),
        label: "Case Opened",
        detail: `SIU case opened. Assigned to ${data.siuCase.assignedTo.name ?? data.siuCase.assignedTo.email}.`,
      });

      for (const note of data.siuCase.notes) {
        timeline.push({
          timestamp: note.timestamp,
          label: "Note Added",
          detail: note.text,
        });
      }

      for (const ev of data.siuCase.evidence) {
        timeline.push({
          timestamp: ev.timestamp,
          label: `Evidence: ${ev.type}`,
          detail: ev.description + (ev.url ? ` (${ev.url})` : ""),
        });
      }

      if (data.siuCase.resolution) {
        timeline.push({
          timestamp: data.siuCase.updatedAt.toISOString(),
          label: `Resolved: ${STATUS_LABELS[data.siuCase.status] ?? data.siuCase.status}`,
          detail: data.siuCase.resolution,
        });
      }

      // Sort chronologically
      timeline.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      for (const entry of timeline) {
        doc.moveDown(0.2);
        doc
          .font("Helvetica-Bold")
          .fillColor("#475569")
          .text(`[${fmtDateTime(entry.timestamp)}] ${entry.label}`);
        doc.font("Helvetica").fillColor("#334155").text(entry.detail, { indent: 10 });
      }
      doc.moveDown(0.3);

      // ── Evidence Collected ──
      sectionHeader(doc, "6. Evidence Inventory");
      if (data.siuCase.evidence.length === 0) {
        doc.text("No additional evidence collected during investigation.");
      } else {
        for (let i = 0; i < data.siuCase.evidence.length; i++) {
          const ev = data.siuCase.evidence[i];
          doc.moveDown(0.2);
          doc.font("Helvetica-Bold").text(`${i + 1}. ${ev.type}`);
          doc.font("Helvetica");
          doc.text(`  Date: ${fmtDateTime(ev.timestamp)}`);
          doc.text(`  Description: ${ev.description}`);
          if (ev.url) {
            doc.text(`  Reference: ${ev.url}`);
          }
        }
      }
      doc.moveDown(0.3);

      // ── Investigation Notes ──
      sectionHeader(doc, "7. Investigation Notes");
      if (data.siuCase.notes.length === 0) {
        doc.text("No investigation notes recorded.");
      } else {
        for (const note of data.siuCase.notes) {
          doc.moveDown(0.2);
          doc
            .font("Helvetica-Bold")
            .fillColor("#475569")
            .text(`[${fmtDateTime(note.timestamp)}]`);
          doc.font("Helvetica").fillColor("#334155").text(note.text, { indent: 10 });
        }
      }
      doc.moveDown(0.3);

      // ── Resolution ──
      sectionHeader(doc, "8. Resolution");
      kvPair(doc, "Final Status", STATUS_LABELS[data.siuCase.status] ?? data.siuCase.status);
      if (data.siuCase.resolution) {
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").text("Resolution Summary:");
        doc.font("Helvetica").text(data.siuCase.resolution, { indent: 10 });
      } else {
        doc.text("Investigation is ongoing. No final resolution yet.");
      }
      doc.moveDown(0.5);

      // ── Footer ──
      drawHR(doc);
      doc.fontSize(9).fillColor("#94a3b8").text(
        "CONFIDENTIAL — This report is intended for internal use only and contains " +
        "information related to a fraud investigation. Do not distribute outside the organization.",
        { align: "center" }
      );
      doc.moveDown(0.3);
      doc.text(
        `Report generated on ${fmtDateTime(new Date())} by ${data.tenantName} via Quantana Shield.`,
        { align: "center" }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Public API ─────────────────────────────────────────

/**
 * Generate an SIU report PDF.
 * Returns the PDF buffer and a suggested filename.
 */
export async function generateSIUReport(
  caseId: string,
  tenantId: string,
  reportType: SIUReportType
): Promise<{ buffer: Buffer; filename: string; reportType: SIUReportType }> {
  const data = await fetchReportData(caseId, tenantId);

  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = data.siuCase.submission.insuredName
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  if (reportType === "DOI_FRAUD_REFERRAL") {
    const buffer = await generateDOIFraudReferral(data);
    return {
      buffer,
      filename: `doi-fraud-referral-${safeName}-${timestamp}.pdf`,
      reportType,
    };
  } else {
    const buffer = await generateInvestigationSummary(data);
    return {
      buffer,
      filename: `investigation-summary-${safeName}-${timestamp}.pdf`,
      reportType,
    };
  }
}
