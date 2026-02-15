import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  deleteExpiredData,
  deleteExpiredDataAllTenants,
} from "@/services/data-retention";
import { TENANT } from "@/test/fixtures";

const mockedPrisma = vi.mocked(prisma);
const mockLog = (createLogger as ReturnType<typeof vi.fn>).mock.results[0]
  ?.value ?? createLogger("data-retention");

// The global mock in setup.ts does not include document.count — add it here.
if (!mockedPrisma.document.count) {
  (mockedPrisma.document as Record<string, unknown>).count = vi.fn();
}

// ─── Tests ────────────────────────────────────────────────

describe("data-retention", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-attach document.count after resetAllMocks clears it
    if (!mockedPrisma.document.count) {
      (mockedPrisma.document as Record<string, unknown>).count = vi.fn();
    }
  });

  // ------------------------------------------------------------------
  // deleteExpiredData()
  // ------------------------------------------------------------------

  describe("deleteExpiredData", () => {
    function setupDefaultMocks(overrides?: {
      retentionYears?: number | null;
      expiredSubmissions?: number;
      expiredDocuments?: number;
      expiredAuditLogs?: number;
    }) {
      const configResult =
        overrides?.retentionYears === null
          ? null
          : { retentionYears: overrides?.retentionYears ?? 7 };

      mockedPrisma.complianceConfig.findUnique.mockResolvedValue(
        configResult as never
      );
      mockedPrisma.submission.count.mockResolvedValue(
        (overrides?.expiredSubmissions ?? 3) as never
      );
      (mockedPrisma.document.count as ReturnType<typeof vi.fn>).mockResolvedValue(
        (overrides?.expiredDocuments ?? 5) as never
      );
      mockedPrisma.auditLog.count.mockResolvedValue(
        (overrides?.expiredAuditLogs ?? 10) as never
      );
    }

    it("uses retentionYears from ComplianceConfig", async () => {
      setupDefaultMocks({ retentionYears: 3 });

      const result = await deleteExpiredData(TENANT.id);

      expect(result.retentionYears).toBe(3);
      expect(mockedPrisma.complianceConfig.findUnique).toHaveBeenCalledWith({
        where: { tenantId: TENANT.id },
        select: { retentionYears: true },
      });
    });

    it("defaults to 5 years when no ComplianceConfig exists", async () => {
      setupDefaultMocks({ retentionYears: null });

      const result = await deleteExpiredData(TENANT.id);

      expect(result.retentionYears).toBe(5);
    });

    it("calculates correct cutoff date", async () => {
      const retentionYears = 7;
      setupDefaultMocks({ retentionYears });

      const before = new Date();
      before.setFullYear(before.getFullYear() - retentionYears);

      const result = await deleteExpiredData(TENANT.id);

      const after = new Date();
      after.setFullYear(after.getFullYear() - retentionYears);

      // The cutoff should be between the before/after timestamps
      expect(result.cutoffDate.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(result.cutoffDate.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });

    it("counts expired submissions, documents, and audit logs", async () => {
      setupDefaultMocks({
        retentionYears: 5,
        expiredSubmissions: 12,
        expiredDocuments: 8,
        expiredAuditLogs: 25,
      });

      const result = await deleteExpiredData(TENANT.id);

      expect(result.expiredSubmissions).toBe(12);
      expect(result.expiredDocuments).toBe(8);
      expect(result.expiredAuditLogs).toBe(25);

      // Verify each count was called with the correct where clause
      expect(mockedPrisma.submission.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT.id, createdAt: { lt: expect.any(Date) } },
      });
      expect(mockedPrisma.document.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT.id, createdAt: { lt: expect.any(Date) } },
      });
      expect(mockedPrisma.auditLog.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT.id, createdAt: { lt: expect.any(Date) } },
      });
    });

    it("returns dryRun: true always", async () => {
      setupDefaultMocks();

      const result = await deleteExpiredData(TENANT.id);

      expect(result.dryRun).toBe(true);
    });

    it("returns the tenantId passed in", async () => {
      setupDefaultMocks();

      const result = await deleteExpiredData(TENANT.id);

      expect(result.tenantId).toBe(TENANT.id);
    });
  });

  // ------------------------------------------------------------------
  // deleteExpiredDataAllTenants()
  // ------------------------------------------------------------------

  describe("deleteExpiredDataAllTenants", () => {
    it("processes all tenants", async () => {
      const tenants = [
        { id: "tenant-a", name: "Tenant A" },
        { id: "tenant-b", name: "Tenant B" },
        { id: "tenant-c", name: "Tenant C" },
      ];

      mockedPrisma.tenant.findMany.mockResolvedValue(tenants as never);

      // Each tenant needs its own compliance config + count mocks
      mockedPrisma.complianceConfig.findUnique.mockResolvedValue({
        retentionYears: 5,
      } as never);
      mockedPrisma.submission.count.mockResolvedValue(0 as never);
      (mockedPrisma.document.count as ReturnType<typeof vi.fn>).mockResolvedValue(
        0 as never
      );
      mockedPrisma.auditLog.count.mockResolvedValue(0 as never);

      await deleteExpiredDataAllTenants();

      // findMany called once to retrieve all tenants
      expect(mockedPrisma.tenant.findMany).toHaveBeenCalledWith({
        select: { id: true, name: true },
      });

      // complianceConfig.findUnique called once per tenant
      expect(mockedPrisma.complianceConfig.findUnique).toHaveBeenCalledTimes(3);
    });

    it("continues processing when one tenant fails", async () => {
      const tenants = [
        { id: "tenant-ok-1", name: "OK Tenant 1" },
        { id: "tenant-fail", name: "Failing Tenant" },
        { id: "tenant-ok-2", name: "OK Tenant 2" },
      ];

      mockedPrisma.tenant.findMany.mockResolvedValue(tenants as never);

      // Return config for all tenants, but make submission.count fail
      // for the second tenant (tenant-fail)
      let callCount = 0;
      mockedPrisma.complianceConfig.findUnique.mockResolvedValue({
        retentionYears: 5,
      } as never);
      mockedPrisma.submission.count.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("DB connection lost"));
        }
        return Promise.resolve(0 as never);
      });
      (mockedPrisma.document.count as ReturnType<typeof vi.fn>).mockResolvedValue(
        0 as never
      );
      mockedPrisma.auditLog.count.mockResolvedValue(0 as never);

      await deleteExpiredDataAllTenants();

      // Should have attempted all 3 tenants
      expect(mockedPrisma.complianceConfig.findUnique).toHaveBeenCalledTimes(3);

      // Error logged for the failing tenant via structured logger
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ tenantName: "Failing Tenant" }),
        expect.any(String)
      );
    });

    it("handles empty tenant list gracefully", async () => {
      mockedPrisma.tenant.findMany.mockResolvedValue([] as never);

      // Should not throw
      await expect(deleteExpiredDataAllTenants()).resolves.toBeUndefined();

      // No further Prisma calls should have been made
      expect(mockedPrisma.complianceConfig.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.submission.count).not.toHaveBeenCalled();
    });
  });
});
