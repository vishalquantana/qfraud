import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRole, withTenantFilter } from "@/lib/rbac";
import { getUserId } from "@/lib/api-handler";
import { logAudit } from "@/services/audit-log";
import type { SIUCaseStatus } from "@/generated/prisma/client";

// ─── Valid SIU Case Statuses ──────────────────────────────

const VALID_STATUSES: SIUCaseStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "EVIDENCE_GATHERED",
  "CONFIRMED_FRAUD",
  "FALSE_POSITIVE",
  "INCONCLUSIVE",
];

// ─── GET /api/siu-cases/:id ───────────────────────────────

export const GET = withRole(
  ["SIU_INVESTIGATOR", "ADMIN"],
  async (ctx, params) => {
    const { tenantId } = ctx;
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Case ID required" },
        { status: 400 }
      );
    }

    const siuCase = await prisma.sIUCase.findFirst({
      where: withTenantFilter(tenantId, { id }),
      include: {
        submission: {
          select: {
            id: true,
            insuredName: true,
            lineOfBusiness: true,
            riskScore: true,
            severity: true,
            status: true,
            createdAt: true,
            submitter: { select: { id: true, name: true, email: true } },
          },
        },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    if (!siuCase) {
      return NextResponse.json(
        { error: "SIU case not found" },
        { status: 404 }
      );
    }

    // Get fraud indicators for this submission
    const indicators = await prisma.fraudIndicator.findMany({
      where: withTenantFilter(tenantId, {
        submissionId: siuCase.submissionId,
      }),
      orderBy: { severity: "asc" },
    });

    return NextResponse.json({
      data: {
        ...siuCase,
        indicators,
        indicatorCount: indicators.length,
      },
    });
  }
);

// ─── PATCH /api/siu-cases/:id ─────────────────────────────
// Update status, add notes, add evidence

export const PATCH = withRole(
  ["SIU_INVESTIGATOR", "ADMIN"],
  async (ctx, params) => {
    const { req, auth, tenantId } = ctx;
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Case ID required" },
        { status: 400 }
      );
    }

    let body: {
      status?: string;
      note?: string;
      evidence?: { type: string; url: string; description: string };
      resolution?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Validate the case exists
    const siuCase = await prisma.sIUCase.findFirst({
      where: withTenantFilter(tenantId, { id }),
    });

    if (!siuCase) {
      return NextResponse.json(
        { error: "SIU case not found" },
        { status: 404 }
      );
    }

    const userId = getUserId(auth);
    const ipAddress =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;

    const updateData: Record<string, unknown> = {};
    const auditDetails: Record<string, unknown> = {};

    // Status update
    if (body.status) {
      if (!VALID_STATUSES.includes(body.status as SIUCaseStatus)) {
        return NextResponse.json(
          {
            error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
          },
          { status: 400 }
        );
      }

      // Resolution required for terminal statuses
      if (
        (body.status === "CONFIRMED_FRAUD" || body.status === "FALSE_POSITIVE") &&
        !body.resolution?.trim() &&
        !siuCase.resolution
      ) {
        return NextResponse.json(
          { error: "Resolution text is required for this status" },
          { status: 400 }
        );
      }

      updateData.status = body.status;
      auditDetails.previousStatus = siuCase.status;
      auditDetails.newStatus = body.status;
    }

    // Add note
    if (body.note?.trim()) {
      const existingNotes = (siuCase.notes as Array<Record<string, unknown>>) ?? [];
      const newNote = {
        userId: userId ?? "system",
        text: body.note.trim(),
        timestamp: new Date().toISOString(),
      };
      updateData.notes = JSON.parse(
        JSON.stringify([...existingNotes, newNote])
      );
      auditDetails.noteAdded = true;
    }

    // Add evidence
    if (body.evidence) {
      const existingEvidence =
        (siuCase.evidence as Array<Record<string, unknown>>) ?? [];
      const newEvidence = {
        type: body.evidence.type,
        url: body.evidence.url,
        description: body.evidence.description,
        timestamp: new Date().toISOString(),
      };
      updateData.evidence = JSON.parse(
        JSON.stringify([...existingEvidence, newEvidence])
      );
      auditDetails.evidenceAdded = body.evidence.type;
    }

    // Resolution text
    if (body.resolution?.trim()) {
      updateData.resolution = body.resolution.trim();
      auditDetails.resolution = body.resolution.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No update fields provided" },
        { status: 400 }
      );
    }

    const updated = await prisma.sIUCase.update({
      where: { id },
      data: updateData,
      include: {
        submission: {
          select: { id: true, insuredName: true },
        },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    // Audit log
    await logAudit({
      tenantId,
      action: "SIU_REFERRAL",
      details: {
        caseId: id,
        action: "SIU_CASE_UPDATED",
        ...auditDetails,
      },
      userId,
      submissionId: siuCase.submissionId,
      ipAddress,
    });

    // If status changed to CONFIRMED_FRAUD or FALSE_POSITIVE, update indicator records
    if (
      body.status === "CONFIRMED_FRAUD" ||
      body.status === "FALSE_POSITIVE"
    ) {
      const isFalsePositive = body.status === "FALSE_POSITIVE";
      await prisma.fraudIndicator.updateMany({
        where: withTenantFilter(tenantId, {
          submissionId: siuCase.submissionId,
        }),
        data: {
          isOverridden: isFalsePositive,
          overriddenById: isFalsePositive ? userId : null,
          overrideJustification: isFalsePositive
            ? body.resolution?.trim() ?? "Marked as false positive by SIU investigation"
            : null,
        },
      });
    }

    return NextResponse.json({ data: updated });
  }
);
