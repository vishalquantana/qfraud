import { prisma } from "@/lib/prisma";
import { logAudit, type AuditAction } from "@/services/audit-log";
import type { Mock } from "vitest";

const mockCreate = prisma.auditLog.create as Mock;

describe("audit-log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "audit-1" });
  });

  // ─── logAudit ──────────────────────────────────────────

  describe("logAudit", () => {
    it("creates audit log with all required fields", async () => {
      await logAudit({
        tenantId: "tenant-1",
        action: "SUBMISSION_CREATED",
        details: { message: "New submission" },
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-1",
          action: "SUBMISSION_CREATED",
          details: { message: "New submission" },
          userId: undefined,
          submissionId: undefined,
          ipAddress: undefined,
        },
      });
    });

    it("creates audit log with optional userId", async () => {
      await logAudit({
        tenantId: "tenant-1",
        action: "USER_LOGIN",
        details: { source: "dashboard" },
        userId: "user-42",
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-42",
          }),
        })
      );
    });

    it("creates audit log with optional submissionId", async () => {
      await logAudit({
        tenantId: "tenant-1",
        action: "FRAUD_FLAG_RAISED",
        details: { flagType: "duplicate" },
        submissionId: "sub-99",
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            submissionId: "sub-99",
          }),
        })
      );
    });

    it("creates audit log with optional ipAddress", async () => {
      await logAudit({
        tenantId: "tenant-1",
        action: "SUBMISSION_APPROVED",
        details: { approvedBy: "admin" },
        ipAddress: "192.168.1.100",
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipAddress: "192.168.1.100",
          }),
        })
      );
    });

    it("creates audit log without optional fields (undefined)", async () => {
      await logAudit({
        tenantId: "tenant-1",
        action: "PROCESSING_STARTED",
        details: { step: "ocr" },
      });

      const callData = mockCreate.mock.calls[0][0].data;
      expect(callData.userId).toBeUndefined();
      expect(callData.submissionId).toBeUndefined();
      expect(callData.ipAddress).toBeUndefined();
    });

    it("converts null optional fields to undefined", async () => {
      await logAudit({
        tenantId: "tenant-1",
        action: "PROCESSING_COMPLETED",
        details: { duration: 1200 },
        userId: null,
        submissionId: null,
        ipAddress: null,
      });

      const callData = mockCreate.mock.calls[0][0].data;
      expect(callData.userId).toBeUndefined();
      expect(callData.submissionId).toBeUndefined();
      expect(callData.ipAddress).toBeUndefined();
    });

    it("serializes details via JSON.parse(JSON.stringify())", async () => {
      const details = {
        nested: { deep: true },
        date: new Date("2026-01-15T00:00:00.000Z"),
        count: 42,
      };

      await logAudit({
        tenantId: "tenant-1",
        action: "FRAUD_FLAG_RAISED",
        details,
      });

      const callData = mockCreate.mock.calls[0][0].data;
      // JSON.parse(JSON.stringify()) converts Date to string
      expect(callData.details).toEqual({
        nested: { deep: true },
        date: "2026-01-15T00:00:00.000Z",
        count: 42,
      });
    });

    it("strips undefined values from details during serialization", async () => {
      const details = {
        present: "yes",
        missing: undefined,
      };

      await logAudit({
        tenantId: "tenant-1",
        action: "SCORE_OVERRIDE",
        details,
      });

      const callData = mockCreate.mock.calls[0][0].data;
      // JSON.parse(JSON.stringify()) drops undefined keys
      expect(callData.details).toEqual({ present: "yes" });
      expect("missing" in callData.details).toBe(false);
    });

    it("passes correct action type for each AuditAction", async () => {
      const actions: AuditAction[] = [
        "SUBMISSION_CREATED",
        "DOCUMENT_UPLOADED",
        "PROCESSING_STARTED",
        "PROCESSING_COMPLETED",
        "FRAUD_FLAG_RAISED",
        "SUBMISSION_APPROVED",
        "SUBMISSION_DECLINED",
        "SUBMISSION_ESCALATED",
        "SIU_REFERRAL",
        "SCORE_OVERRIDE",
        "THRESHOLD_CHANGED",
        "USER_LOGIN",
      ];

      for (const action of actions) {
        mockCreate.mockClear();
        await logAudit({
          tenantId: "tenant-1",
          action,
          details: {},
        });

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ action }),
          })
        );
      }
    });

    it("returns the created audit log record", async () => {
      mockCreate.mockResolvedValue({ id: "audit-123", action: "USER_LOGIN" });

      const result = await logAudit({
        tenantId: "tenant-1",
        action: "USER_LOGIN",
        details: {},
      });

      expect(result).toEqual({ id: "audit-123", action: "USER_LOGIN" });
    });

    it("propagates errors from prisma.auditLog.create", async () => {
      mockCreate.mockRejectedValue(new Error("Database connection failed"));

      await expect(
        logAudit({
          tenantId: "tenant-1",
          action: "SUBMISSION_CREATED",
          details: {},
        })
      ).rejects.toThrow("Database connection failed");
    });
  });
});
