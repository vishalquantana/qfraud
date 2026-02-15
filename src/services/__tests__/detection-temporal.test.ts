import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { detectTemporalAnomalies } from "@/services/detection-temporal";

// ─── Typed mocks ──────────────────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

// ─── Helpers ──────────────────────────────────────────────

const SUBMISSION_ID = "sub-test";
const TENANT_ID = "tenant-001";

function setupSubmission(createdAt = new Date("2025-06-15")) {
  mockPrisma.submission.findUniqueOrThrow.mockResolvedValue({
    id: SUBMISSION_ID,
    tenantId: TENANT_ID,
    createdAt,
  } as never);
}

function makeDoc(
  documentType: string,
  extractedData: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `doc-${documentType.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
    submissionId: SUBMISSION_ID,
    tenantId: TENANT_ID,
    documentType,
    status: "ANALYZED",
    extractedData,
    fileName: `${documentType}.pdf`,
    createdAt: new Date("2025-06-01"),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.fraudIndicator.create.mockResolvedValue({} as never);
  // Default: no documents found
  mockPrisma.document.findFirst.mockResolvedValue(null);
  mockPrisma.document.findMany.mockResolvedValue([]);
});

describe("detectTemporalAnomalies", () => {
  // ── Coverage gap detection ───────────────────────────

  describe("coverage gap detection", () => {
    it("flags gaps >30 days between prior coverage end and requested effective date", async () => {
      setupSubmission();

      // ACORD 125 with requested effective date
      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-08-01",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // COI with prior coverage ending June 1 => 61-day gap to Aug 1
      const coiDoc = makeDoc("COI", {
        effectiveDate: "2024-06-01",
        expirationDate: "2025-06-01",
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([coiDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const gapCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "COVERAGE_GAP",
      );

      expect(gapCall).toBeDefined();
      const data = (gapCall![0] as { data: Record<string, unknown> }).data;
      expect(data.category).toBe("TEMPORAL");
      expect(data.severity).toBe("HIGH");
    });

    it("does not flag gaps of 30 days or less", async () => {
      setupSubmission();

      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-06-20",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // COI ending June 1 => 19-day gap to June 20
      const coiDoc = makeDoc("COI", {
        effectiveDate: "2024-06-01",
        expirationDate: "2025-06-01",
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([coiDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const gapCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "COVERAGE_GAP",
      );
      expect(gapCall).toBeUndefined();
    });

    it("does not flag when prior coverage overlaps the requested effective date", async () => {
      setupSubmission();

      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-06-15",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // COI ending July 1 => prior coverage extends past requested effective
      const coiDoc = makeDoc("COI", {
        effectiveDate: "2024-07-01",
        expirationDate: "2025-07-01",
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([coiDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const gapCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "COVERAGE_GAP",
      );
      expect(gapCall).toBeUndefined();
    });
  });

  // ── Claim timing clusters ────────────────────────────

  describe("claim timing clusters", () => {
    it("flags when >50% of claims occur within 60 days of policy boundaries", async () => {
      setupSubmission();

      // Policy period: 01/01/2024 - 01/01/2025
      // 4 claims total, 3 near boundaries (>50%)
      const lossRunDoc = makeDoc("LOSS_RUN", {
        policyPeriod: "01/01/2024 - 01/01/2025",
        claims: [
          { claimNumber: "C001", dateOfLoss: "01/15/2024", totalIncurred: 5000 }, // 14 days from inception
          { claimNumber: "C002", dateOfLoss: "02/20/2024", totalIncurred: 8000 }, // 50 days from inception
          { claimNumber: "C003", dateOfLoss: "12/05/2024", totalIncurred: 3000 }, // 27 days from expiration
          { claimNumber: "C004", dateOfLoss: "06/15/2024", totalIncurred: 7000 }, // middle of policy
        ],
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const clusterCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CLAIM_TIMING_CLUSTER",
      );

      expect(clusterCall).toBeDefined();
      const data = (clusterCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
    });

    it("does not flag when claims are evenly distributed throughout the policy period", async () => {
      setupSubmission();

      // Policy period: 01/01/2024 - 01/01/2025
      // Claims spread across the middle of the policy
      const lossRunDoc = makeDoc("LOSS_RUN", {
        policyPeriod: "01/01/2024 - 01/01/2025",
        claims: [
          { claimNumber: "C001", dateOfLoss: "04/15/2024", totalIncurred: 5000 },
          { claimNumber: "C002", dateOfLoss: "06/20/2024", totalIncurred: 8000 },
          { claimNumber: "C003", dateOfLoss: "08/10/2024", totalIncurred: 3000 },
          { claimNumber: "C004", dateOfLoss: "10/01/2024", totalIncurred: 7000 },
        ],
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const clusterCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CLAIM_TIMING_CLUSTER",
      );
      expect(clusterCall).toBeUndefined();
    });

    it("requires at least 3 claims to evaluate clustering", async () => {
      setupSubmission();

      const lossRunDoc = makeDoc("LOSS_RUN", {
        policyPeriod: "01/01/2024 - 01/01/2025",
        claims: [
          { claimNumber: "C001", dateOfLoss: "01/05/2024", totalIncurred: 5000 },
          { claimNumber: "C002", dateOfLoss: "01/10/2024", totalIncurred: 8000 },
        ],
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const clusterCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "CLAIM_TIMING_CLUSTER",
      );
      expect(clusterCall).toBeUndefined();
    });
  });

  // ── Document staleness ───────────────────────────────

  describe("document staleness", () => {
    it("flags inspection reports older than 6 months", async () => {
      setupSubmission(new Date("2025-06-15"));

      // Inspection photo created 8 months before submission
      const inspectionDoc = makeDoc(
        "INSPECTION_PHOTO",
        {},
        {
          createdAt: new Date("2024-10-01"), // ~8 months before June 2025
          fileName: "site_inspection.pdf",
        },
      );

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "INSPECTION_PHOTO") {
          return Promise.resolve([inspectionDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const stalenessCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DOCUMENT_STALENESS",
      );

      expect(stalenessCall).toBeDefined();
      const data = (stalenessCall![0] as { data: Record<string, unknown> })
        .data;
      expect(data.severity).toBe("MEDIUM");
    });

    it("flags MVRs older than 1 month", async () => {
      setupSubmission(new Date("2025-06-15"));

      const mvrDoc = makeDoc(
        "MVR",
        {},
        {
          createdAt: new Date("2025-04-01"), // ~2.5 months before submission
          fileName: "motor_vehicle_report.pdf",
        },
      );

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "MVR") {
          return Promise.resolve([mvrDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const stalenessCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DOCUMENT_STALENESS",
      );

      expect(stalenessCall).toBeDefined();
    });

    it("does not flag recent documents within allowed age", async () => {
      setupSubmission(new Date("2025-06-15"));

      const inspectionDoc = makeDoc(
        "INSPECTION_PHOTO",
        {},
        {
          createdAt: new Date("2025-03-01"), // ~3.5 months, within 6 months
          fileName: "site_inspection.pdf",
        },
      );

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "INSPECTION_PHOTO") {
          return Promise.resolve([inspectionDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const stalenessCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "DOCUMENT_STALENESS",
      );
      expect(stalenessCall).toBeUndefined();
    });
  });

  // ── Impossible dates ─────────────────────────────────

  describe("impossible dates", () => {
    it("flags COI expiration date before effective date", async () => {
      setupSubmission(new Date("2025-06-15"));

      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-07-01",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // COI with expiration BEFORE effective date
      const coiDoc = makeDoc("COI", {
        effectiveDate: "2025-07-01",
        expirationDate: "2025-01-01", // before effective
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([coiDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const impossibleCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "IMPOSSIBLE_DATE_COI",
      );

      expect(impossibleCall).toBeDefined();
      const data = (impossibleCall![0] as { data: Record<string, unknown> })
        .data;
      expect(data.severity).toBe("CRITICAL");
    });

    it("flags COI effective date far in the future (>1 year from submission)", async () => {
      setupSubmission(new Date("2025-06-15"));

      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-07-01",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // COI with effective date 2 years in the future
      const coiDoc = makeDoc("COI", {
        effectiveDate: "2027-07-01",
        expirationDate: "2028-07-01",
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([coiDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const futureCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "IMPOSSIBLE_DATE_FUTURE",
      );

      expect(futureCall).toBeDefined();
      const data = (futureCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("CRITICAL");
    });

    it("flags loss run effective date after the policy effective date", async () => {
      setupSubmission(new Date("2025-06-15"));

      // ACORD 125 effective date: July 1, 2025
      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-07-01",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // Loss run with period starting AFTER policy effective
      const lossRunDoc = makeDoc("LOSS_RUN", {
        policyPeriod: "08/01/2025 - 08/01/2026",
        claims: [],
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const lossRunCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "IMPOSSIBLE_DATE_LOSS_RUN",
      );

      expect(lossRunCall).toBeDefined();
      const data = (lossRunCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("CRITICAL");
    });

    it("does not flag valid date relationships", async () => {
      setupSubmission(new Date("2025-06-15"));

      const acord125Doc = makeDoc("ACORD_125", {
        effectiveDate: "2025-07-01",
      });

      mockPrisma.document.findFirst.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "ACORD_125") {
          return Promise.resolve(acord125Doc);
        }
        return Promise.resolve(null);
      }) as never);

      // Valid COI: effective before expiration, not far in future
      const coiDoc = makeDoc("COI", {
        effectiveDate: "2025-07-01",
        expirationDate: "2026-07-01",
      });

      // Valid loss run: period before policy effective
      const lossRunDoc = makeDoc("LOSS_RUN", {
        policyPeriod: "07/01/2024 - 07/01/2025",
        claims: [],
      });

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "COI") {
          return Promise.resolve([coiDoc]);
        }
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await detectTemporalAnomalies(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const impossibleCalls = createCalls.filter((call) => {
        const name = (call[0] as { data: { indicatorName: string } }).data
          .indicatorName;
        return name.startsWith("IMPOSSIBLE_DATE");
      });
      expect(impossibleCalls).toHaveLength(0);
    });
  });
});
