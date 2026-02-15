import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";
import {
  generateSIUReport,
  type SIUReportType,
} from "@/services/report-generation";

const VALID_REPORT_TYPES: SIUReportType[] = [
  "DOI_FRAUD_REFERRAL",
  "INVESTIGATION_SUMMARY",
];

const REPORT_TYPE_LABELS: Record<SIUReportType, string> = {
  DOI_FRAUD_REFERRAL: "State DOI Fraud Referral",
  INVESTIGATION_SUMMARY: "Internal Investigation Summary",
};

// ─── POST /api/siu-cases/:id/reports ────────────────────
// Generate a report PDF and store as evidence attachment

export const POST = withRole(
  ["SIU_INVESTIGATOR", "ADMIN"],
  async (ctx, params) => {
    const { req, auth, tenantId } = ctx;
    const caseId = params?.id;
    if (!caseId) {
      return NextResponse.json(
        { error: "Case ID required" },
        { status: 400 }
      );
    }

    let body: { reportType?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const reportType = body.reportType as SIUReportType;
    if (!reportType || !VALID_REPORT_TYPES.includes(reportType)) {
      return NextResponse.json(
        {
          error: `Invalid report type. Must be one of: ${VALID_REPORT_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Verify case exists and belongs to tenant
    const siuCase = await prisma.sIUCase.findFirst({
      where: withTenantFilter(tenantId, { id: caseId }),
    });
    if (!siuCase) {
      return NextResponse.json(
        { error: "SIU case not found" },
        { status: 404 }
      );
    }

    // Generate the PDF
    const { buffer, filename } = await generateSIUReport(
      caseId,
      tenantId,
      reportType
    );

    // Store as evidence attachment on the case
    const existingEvidence =
      (siuCase.evidence as Array<Record<string, unknown>>) ?? [];
    const newEvidence = {
      type: "report",
      url: filename,
      description: `${REPORT_TYPE_LABELS[reportType]} - Generated on ${new Date().toLocaleDateString("en-US")}`,
      timestamp: new Date().toISOString(),
      reportType,
    };

    await prisma.sIUCase.update({
      where: { id: caseId },
      data: {
        evidence: JSON.parse(
          JSON.stringify([...existingEvidence, newEvidence])
        ),
      },
    });

    // Audit log
    const userId = getUserId(auth);
    const ipAddress =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;

    await logAudit({
      tenantId,
      action: "SIU_REFERRAL",
      details: {
        caseId,
        action: "REPORT_GENERATED",
        reportType,
        filename,
      },
      userId,
      submissionId: siuCase.submissionId,
      ipAddress,
    });

    // Return the PDF as a downloadable response
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  }
);
