import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  validateRevenue,
  validatePayroll,
  validateEmployeeCount,
  validateLossHistory,
  validatePropertyValues,
} from "@/services/validation-cross-doc";
import { SUBMISSION, TENANT } from "@/test/fixtures";

// ─── Typed mock references ──────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

// ─── Helpers ────────────────────────────────────────────

const SUB_ID = SUBMISSION.clean.id;
const TENANT_ID = TENANT.id;

const submissionRecord = {
  id: SUB_ID,
  tenantId: TENANT_ID,
};

/** Build a minimal ANALYZED document row returned by findFirst / findMany. */
function makeDoc(
  id: string,
  docType: string,
  extractedData: Record<string, unknown>,
) {
  return {
    id,
    submissionId: SUB_ID,
    tenantId: TENANT_ID,
    documentType: docType,
    status: "ANALYZED",
    extractedData,
    createdAt: new Date(),
  };
}

// ─── Global setup ───────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Default: submission lookup always succeeds
  mockPrisma.submission.findUniqueOrThrow.mockResolvedValue(
    submissionRecord as never,
  );

  // Default: no documents found (individual tests override)
  mockPrisma.document.findFirst.mockResolvedValue(null);
  mockPrisma.document.findMany.mockResolvedValue([]);

  // Default: fraudIndicator.create succeeds
  mockPrisma.fraudIndicator.create.mockResolvedValue({} as never);
});

// ═══════════════════════════════════════════════════════════
// 1. validateRevenue
// ═══════════════════════════════════════════════════════════

describe("validateRevenue", () => {
  // ── Skip scenarios ──────────────────────────────────────

  it("skips when ACORD 125 document is missing", async () => {
    // findFirst returns null for any docType lookup
    mockPrisma.document.findFirst.mockResolvedValue(null);

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when ACORD 125 has null annualRevenue", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { annualRevenue: null }) as never,
    );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when financial statement document is missing", async () => {
    // First call (ACORD_125) returns a doc, second call (FINANCIAL_STATEMENT) returns null
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(null);

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when financial statement has null revenue", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: null }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── No flag when variance <=15% ─────────────────────────

  it("does not flag when variance is within 15%", async () => {
    // 1,000,000 vs 900,000 => diff 100,000 / 1,000,000 = 10%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 900_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does not flag when variance is exactly 15%", async () => {
    // 1,000,000 vs 850,000 => diff 150,000 / 1,000,000 = 15%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 850_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── HIGH severity when variance 15-25% ──────────────────

  it("creates HIGH fraud indicator when variance is between 15% and 25%", async () => {
    // 1,000,000 vs 800,000 => diff 200,000 / 1,000,000 = 20%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 800_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      submissionId: SUB_ID,
      tenantId: TENANT_ID,
      category: "CROSS_DOC",
      indicatorName: "REVENUE_MISMATCH",
      severity: "HIGH",
      confidence: 0.85,
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.acordRevenue).toBe(1_000_000);
    expect(evidence.financialStatementRevenue).toBe(800_000);
    expect(evidence.variancePercent).toBe(20);
    expect(evidence.acordDocumentId).toBe("d1");
    expect(evidence.financialStatementDocumentId).toBe("d2");
  });

  it("creates HIGH when variance is exactly 25%", async () => {
    // 1,000,000 vs 750,000 => diff 250,000 / 1,000,000 = 25%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 750_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();
    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.severity).toBe("HIGH");
  });

  // ── CRITICAL severity when variance >25% ────────────────

  it("creates CRITICAL fraud indicator when variance exceeds 25%", async () => {
    // 10,000,000 vs 6,000,000 => diff 4,000,000 / 10,000,000 = 40%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 10_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 6_000_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      submissionId: SUB_ID,
      tenantId: TENANT_ID,
      category: "CROSS_DOC",
      indicatorName: "REVENUE_MISMATCH",
      severity: "CRITICAL",
      confidence: 0.85,
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.variancePercent).toBe(40);
    expect(evidence.acordRevenue).toBe(10_000_000);
    expect(evidence.financialStatementRevenue).toBe(6_000_000);
  });

  it("sets recommended action for broker clarification on HIGH severity", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 1_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 800_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain("broker");
  });

  it("sets recommended action for financial verification on CRITICAL severity", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 10_000_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 6_000_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain(
      "Request updated financial statements",
    );
  });

  // ── Zero revenue edge case ──────────────────────────────

  it("handles zero revenue gracefully (both zero) without creating indicator", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 0 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 0 }) as never,
      );

    await validateRevenue(SUB_ID);

    // maxVal === 0 => returns early
    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("handles zero ACORD revenue vs non-zero financial revenue gracefully", async () => {
    // 0 vs 500,000 => diff 500,000 / 500,000 = 100% => CRITICAL
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { annualRevenue: 0 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "FINANCIAL_STATEMENT", { revenue: 500_000 }) as never,
      );

    await validateRevenue(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();
    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.severity).toBe("CRITICAL");
  });
});

// ═══════════════════════════════════════════════════════════
// 2. validatePayroll
// ═══════════════════════════════════════════════════════════

describe("validatePayroll", () => {
  // ── Skip scenarios ──────────────────────────────────────

  it("skips when ACORD 130 document is missing", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when ACORD 130 has null totalPayroll", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_130", { totalPayroll: null }) as never,
    );

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when payroll tax document is missing", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 2_500_000 }) as never,
      )
      .mockResolvedValueOnce(null);

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when payroll tax has null totalPayroll", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 2_500_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: null }) as never,
      );

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── No flag when difference <=2000 ──────────────────────

  it("does not flag when absolute difference is at most $2,000", async () => {
    // 500,000 vs 501,500 => diff 1,500 <= 2,000
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 500_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: 501_500 }) as never,
      );

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does not flag when difference is exactly $2,000", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 100_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: 102_000 }) as never,
      );

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── HIGH severity when >$2,000 but <=10% variance ──────

  it("creates HIGH fraud indicator when difference > $2,000 but variance <= 10%", async () => {
    // 500,000 vs 510,000 => diff 10,000 > 2,000, variance = 10,000/510,000 ~= 1.96% <= 10%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 500_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: 510_000 }) as never,
      );

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      submissionId: SUB_ID,
      tenantId: TENANT_ID,
      category: "CROSS_DOC",
      indicatorName: "PAYROLL_MISMATCH",
      severity: "HIGH",
      confidence: 0.85,
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.acordPayroll).toBe(500_000);
    expect(evidence.taxDocumentPayroll).toBe(510_000);
    expect(evidence.difference).toBe(10_000);
    expect(evidence.acordDocumentId).toBe("d1");
    expect(evidence.payrollTaxDocumentId).toBe("d2");
  });

  // ── CRITICAL severity when >10% variance ────────────────

  it("creates CRITICAL fraud indicator when variance exceeds 10%", async () => {
    // 500,000 vs 600,000 => diff 100,000, variance = 100,000/600,000 ~= 16.67%
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 500_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: 600_000 }) as never,
      );

    await validatePayroll(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      severity: "CRITICAL",
      indicatorName: "PAYROLL_MISMATCH",
      category: "CROSS_DOC",
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.difference).toBe(100_000);
    expect((evidence.variancePercent as number)).toBeGreaterThan(10);
  });

  it("sets recommended action for investigation on CRITICAL severity", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 500_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: 600_000 }) as never,
      );

    await validatePayroll(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain(
      "investigate potential payroll misrepresentation",
    );
  });

  it("sets recommended action for broker review on HIGH severity", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_130", { totalPayroll: 500_000 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "PAYROLL_TAX", { totalPayroll: 510_000 }) as never,
      );

    await validatePayroll(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain("broker");
  });
});

// ═══════════════════════════════════════════════════════════
// 3. validateEmployeeCount
// ═══════════════════════════════════════════════════════════

describe("validateEmployeeCount", () => {
  // ── Skip scenarios ──────────────────────────────────────

  it("skips when neither ACORD 125 nor ACORD 130 document exists", async () => {
    // findFirst returns null for all doc type lookups
    mockPrisma.document.findFirst.mockResolvedValue(null);

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when ACORD 125 has no numberOfEmployees and ACORD 130 has no classifications", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: null }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "ACORD_130", {
          payrollByClassification: [],
        }) as never,
      )
      .mockResolvedValueOnce(null); // PAYROLL_TAX not reached

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when payroll tax document is missing", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 50 }) as never,
      )
      .mockResolvedValueOnce(null) // ACORD_130
      .mockResolvedValueOnce(null); // PAYROLL_TAX

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when payroll tax has null employeeCount", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 50 }) as never,
      )
      .mockResolvedValueOnce(null) // ACORD_130
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: null }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── No flag when difference <=2 ─────────────────────────

  it("does not flag when employee count difference is at most 2", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 50 }) as never,
      )
      .mockResolvedValueOnce(null) // ACORD_130
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 48 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does not flag when difference is exactly 2", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 20 }) as never,
      )
      .mockResolvedValueOnce(null) // ACORD_130
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 22 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── HIGH severity when difference >2 ────────────────────

  it("creates HIGH fraud indicator when difference exceeds 2 (ACORD 125 source)", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 50 }) as never,
      )
      .mockResolvedValueOnce(null) // ACORD_130
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 30 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      submissionId: SUB_ID,
      tenantId: TENANT_ID,
      category: "CROSS_DOC",
      indicatorName: "EMPLOYEE_COUNT_MISMATCH",
      severity: "HIGH",
      confidence: 0.8,
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.applicationEmployeeCount).toBe(50);
    expect(evidence.applicationSource).toBe("ACORD 125");
    expect(evidence.applicationDocumentId).toBe("d1");
    expect(evidence.payrollTaxEmployeeCount).toBe(30);
    expect(evidence.payrollTaxDocumentId).toBe("d3");
    expect(evidence.difference).toBe(20);
  });

  // ── Falls back to ACORD 130 payroll classifications ─────

  it("falls back to ACORD 130 payroll classifications when ACORD 125 has no employee count", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: null }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "ACORD_130", {
          payrollByClassification: [
            { classCode: "3632", description: "Machine Shop", payroll: 1_500_000, employeeCount: 30 },
            { classCode: "8810", description: "Clerical", payroll: 1_000_000, employeeCount: 20 },
          ],
        }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 30 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    const evidence = callArg.data.evidence as Record<string, unknown>;
    // 30 + 20 = 50 from ACORD 130 classifications
    expect(evidence.applicationEmployeeCount).toBe(50);
    expect(evidence.applicationSource).toBe("ACORD 130");
    expect(evidence.applicationDocumentId).toBe("d2");
    expect(evidence.payrollTaxEmployeeCount).toBe(30);
    expect(evidence.difference).toBe(20);
  });

  it("prefers ACORD 125 numberOfEmployees over ACORD 130 classification totals", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 45 }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "ACORD_130", {
          payrollByClassification: [
            { classCode: "3632", description: "Machine Shop", payroll: 1_500_000, employeeCount: 30 },
            { classCode: "8810", description: "Clerical", payroll: 1_000_000, employeeCount: 20 },
          ],
        }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 30 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    const evidence = callArg.data.evidence as Record<string, unknown>;
    // Uses ACORD 125's 45, not ACORD 130's 50
    expect(evidence.applicationEmployeeCount).toBe(45);
    expect(evidence.applicationSource).toBe("ACORD 125");
  });

  it("skips when ACORD 130 classification employee counts sum to zero", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: null }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d2", "ACORD_130", {
          payrollByClassification: [
            { classCode: "3632", description: "Machine Shop", payroll: 1_500_000, employeeCount: 0 },
            { classCode: "8810", description: "Clerical", payroll: 1_000_000, employeeCount: null },
          ],
        }) as never,
      )
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 10 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    // total from classifications is 0, so applicationCount stays null => early return
    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("includes description with source name and counts", async () => {
    mockPrisma.document.findFirst
      .mockResolvedValueOnce(
        makeDoc("d1", "ACORD_125", { numberOfEmployees: 50 }) as never,
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        makeDoc("d3", "PAYROLL_TAX", { employeeCount: 30 }) as never,
      );

    await validateEmployeeCount(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.description).toContain("ACORD 125");
    expect(callArg.data.description).toContain("50");
    expect(callArg.data.description).toContain("30");
    expect(callArg.data.description).toContain("20");
  });
});

// ═══════════════════════════════════════════════════════════
// 4. validateLossHistory
// ═══════════════════════════════════════════════════════════

describe("validateLossHistory", () => {
  // ── Skip scenarios ──────────────────────────────────────

  it("skips when ACORD 125 document is missing", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when no loss run documents exist", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );
    mockPrisma.document.findMany.mockResolvedValue([]);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── CRITICAL when ACORD 125 says no losses but loss runs have claims ──

  it("creates CRITICAL fraud indicator when ACORD 125 denies losses but loss runs have claims", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );

    const lossRunDoc = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: 3,
      claims: [
        { date: "2024-01-15", amount: 45000, status: "closed", description: "Slip and fall" },
        { date: "2024-06-20", amount: 120000, status: "open", description: "Equipment damage" },
        { date: "2024-09-10", amount: 75000, status: "closed", description: "Employee injury" },
      ],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRunDoc] as never);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      submissionId: SUB_ID,
      tenantId: TENANT_ID,
      category: "CROSS_DOC",
      indicatorName: "LOSS_HISTORY_OMISSION",
      severity: "CRITICAL",
      confidence: 0.9,
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.lossDisclosure).toBe(false);
    expect(evidence.lossRunClaimCount).toBe(3);
    expect(evidence.acordDocumentId).toBe("d1");
    expect(evidence.lossRunDocumentIds).toEqual(["d2"]);
  });

  it("aggregates claims across multiple loss run documents", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );

    const lossRun1 = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: 2,
      claims: [
        { date: "2024-01-15", amount: 45000 },
        { date: "2024-06-20", amount: 120000 },
      ],
    });
    const lossRun2 = makeDoc("d3", "LOSS_RUN", {
      totalClaimCount: 1,
      claims: [{ date: "2024-09-10", amount: 75000 }],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRun1, lossRun2] as never);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.lossRunClaimCount).toBe(3);
    expect(evidence.lossRunDocumentIds).toEqual(["d2", "d3"]);
  });

  it("uses claims.length when totalClaimCount is absent", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );

    const lossRunDoc = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: null,
      claims: [
        { date: "2024-01-15", amount: 45000 },
        { date: "2024-06-20", amount: 120000 },
      ],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRunDoc] as never);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.lossRunClaimCount).toBe(2);
  });

  // ── No flag when disclosure matches ─────────────────────

  it("does not flag when ACORD 125 discloses losses and loss runs have claims", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: true }) as never,
    );

    const lossRunDoc = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: 3,
      claims: [
        { date: "2024-01-15", amount: 45000 },
        { date: "2024-06-20", amount: 120000 },
        { date: "2024-09-10", amount: 75000 },
      ],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRunDoc] as never);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does not flag when ACORD 125 says no losses and loss runs have zero claims", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );

    const lossRunDoc = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: 0,
      claims: [],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRunDoc] as never);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does not flag when lossDisclosure is null (unknown)", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: null }) as never,
    );

    const lossRunDoc = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: 5,
      claims: [{ date: "2024-01-15", amount: 45000 }],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRunDoc] as never);

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("includes recommended action mentioning concealment investigation", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );

    const lossRunDoc = makeDoc("d2", "LOSS_RUN", {
      totalClaimCount: 1,
      claims: [{ date: "2024-01-15", amount: 10000 }],
    });
    mockPrisma.document.findMany.mockResolvedValue([lossRunDoc] as never);

    await validateLossHistory(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain("concealment");
  });

  it("skips loss run documents without extractedData", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_125", { lossDisclosure: false }) as never,
    );

    const lossRunNoData = {
      ...makeDoc("d2", "LOSS_RUN", {}),
      extractedData: null,
    };
    const lossRunWithData = makeDoc("d3", "LOSS_RUN", {
      totalClaimCount: 2,
      claims: [
        { date: "2024-01-15", amount: 45000 },
        { date: "2024-06-20", amount: 120000 },
      ],
    });
    mockPrisma.document.findMany.mockResolvedValue(
      [lossRunNoData, lossRunWithData] as never,
    );

    await validateLossHistory(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();
    const evidence = mockPrisma.fraudIndicator.create.mock.calls[0][0].data
      .evidence as Record<string, unknown>;
    expect(evidence.lossRunClaimCount).toBe(2);
    // Only the doc with data contributes to documentIds
    expect(evidence.lossRunDocumentIds).toEqual(["d3"]);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. validatePropertyValues
// ═══════════════════════════════════════════════════════════

describe("validatePropertyValues", () => {
  // ── Skip scenarios ──────────────────────────────────────

  it("skips when ACORD 140 document is missing", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when ACORD 140 has no property locations", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", { propertyLocations: [] }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips when ACORD 140 has null propertyLocations", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", { propertyLocations: null }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips locations with null buildingValue", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "123 Main St",
            buildingValue: null,
            contentsValue: 100_000,
            businessIncomeValue: 50_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("skips locations with zero buildingValue", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "123 Main St",
            buildingValue: 0,
            contentsValue: 100_000,
            businessIncomeValue: 50_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── No flag when insured/assessed ratio < 2x ───────────

  it("does not flag when total insured to assessed ratio is below 2x", async () => {
    // buildingValue: 1,000,000
    // assessed = 1,000,000 * 0.7 = 700,000
    // totalInsured = 1,000,000 + 0 + 0 = 1,000,000
    // ratio = 1,000,000 / 700,000 = 1.43x < 2x
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "123 Main St",
            buildingValue: 1_000_000,
            contentsValue: 0,
            businessIncomeValue: 0,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("does not flag when ratio is just under 2x with contents and BI values", async () => {
    // buildingValue: 500,000
    // assessed = 500,000 * 0.7 = 350,000
    // totalInsured = 500,000 + 150,000 + 0 = 650,000
    // ratio = 650,000 / 350,000 = 1.857x < 2x
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "456 Oak Ave",
            buildingValue: 500_000,
            contentsValue: 150_000,
            businessIncomeValue: 0,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  // ── HIGH when ratio 2-3x ────────────────────────────────

  it("creates HIGH fraud indicator when ratio is between 2x and 3x", async () => {
    // buildingValue: 500,000
    // assessed = 500,000 * 0.7 = 350,000
    // totalInsured = 500,000 + 200,000 + 100,000 = 800,000
    // ratio = 800,000 / 350,000 = 2.286x => HIGH
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "789 Elm Blvd",
            buildingValue: 500_000,
            contentsValue: 200_000,
            businessIncomeValue: 100_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      submissionId: SUB_ID,
      tenantId: TENANT_ID,
      documentId: "d1",
      category: "CROSS_DOC",
      indicatorName: "PROPERTY_VALUE_ANOMALY",
      severity: "HIGH",
      confidence: 0.7,
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect(evidence.buildingValue).toBe(500_000);
    expect(evidence.contentsValue).toBe(200_000);
    expect(evidence.businessIncomeValue).toBe(100_000);
    expect(evidence.totalInsuredValue).toBe(800_000);
    expect(evidence.estimatedAssessedValue).toBe(350_000);
    expect(evidence.assessmentRatio).toBe(0.7);
    expect(evidence.propertyAddress).toBe("789 Elm Blvd");
    expect(evidence.acord140DocumentId).toBe("d1");
    expect((evidence.insuredToAssessedRatio as number)).toBeGreaterThanOrEqual(2);
    expect((evidence.insuredToAssessedRatio as number)).toBeLessThan(3);
  });

  // ── CRITICAL when ratio >= 3x ───────────────────────────

  it("creates CRITICAL fraud indicator when ratio is 3x or greater", async () => {
    // buildingValue: 500,000
    // assessed = 500,000 * 0.7 = 350,000
    // totalInsured = 500,000 + 400,000 + 200,000 = 1,100,000
    // ratio = 1,100,000 / 350,000 = 3.14x => CRITICAL
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "100 High Value Dr",
            buildingValue: 500_000,
            contentsValue: 400_000,
            businessIncomeValue: 200_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data).toMatchObject({
      severity: "CRITICAL",
      indicatorName: "PROPERTY_VALUE_ANOMALY",
      category: "CROSS_DOC",
    });

    const evidence = callArg.data.evidence as Record<string, unknown>;
    expect((evidence.insuredToAssessedRatio as number)).toBeGreaterThanOrEqual(3);
  });

  it("creates CRITICAL at exactly 3x ratio", async () => {
    // buildingValue: 700,000
    // assessed = 700,000 * 0.7 = 490,000
    // totalInsured needs to be exactly 3 * 490,000 = 1,470,000
    // totalInsured = buildingValue + contentsValue + businessIncomeValue = 700,000 + 500,000 + 270,000 = 1,470,000
    // ratio = 1,470,000 / 490,000 = 3.0x
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "Exact 3x St",
            buildingValue: 700_000,
            contentsValue: 500_000,
            businessIncomeValue: 270_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledOnce();
    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.severity).toBe("CRITICAL");
  });

  // ── Multiple locations ──────────────────────────────────

  it("creates indicators for each location that exceeds the threshold", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "OK Location",
            buildingValue: 1_000_000,
            contentsValue: 0,
            businessIncomeValue: 0,
            // ratio = 1M / 700k = 1.43x => no flag
          },
          {
            address: "High Location",
            buildingValue: 500_000,
            contentsValue: 300_000,
            businessIncomeValue: 100_000,
            // totalInsured = 900k, assessed = 350k, ratio = 2.57x => HIGH
          },
          {
            address: "Critical Location",
            buildingValue: 500_000,
            contentsValue: 400_000,
            businessIncomeValue: 200_000,
            // totalInsured = 1,100k, assessed = 350k, ratio = 3.14x => CRITICAL
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    // Should create 2 indicators (one HIGH, one CRITICAL)
    expect(mockPrisma.fraudIndicator.create).toHaveBeenCalledTimes(2);

    const firstCall = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(firstCall.data.severity).toBe("HIGH");
    expect(
      (firstCall.data.evidence as Record<string, unknown>).propertyAddress,
    ).toBe("High Location");

    const secondCall = mockPrisma.fraudIndicator.create.mock.calls[1][0];
    expect(secondCall.data.severity).toBe("CRITICAL");
    expect(
      (secondCall.data.evidence as Record<string, unknown>).propertyAddress,
    ).toBe("Critical Location");
  });

  it("handles null contentsValue and businessIncomeValue as zero", async () => {
    // buildingValue: 500,000, others null
    // assessed = 500,000 * 0.7 = 350,000
    // totalInsured = 500,000 + 0 + 0 = 500,000
    // ratio = 500,000 / 350,000 = 1.43x => no flag
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "Sparse Data Location",
            buildingValue: 500_000,
            contentsValue: null,
            businessIncomeValue: null,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
  });

  it("sets recommended action for appraisal on CRITICAL severity", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "Over-insured Place",
            buildingValue: 500_000,
            contentsValue: 400_000,
            businessIncomeValue: 200_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain("property appraisal");
  });

  it("sets recommended action for benchmark review on HIGH severity", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: "Somewhat Over-insured Place",
            buildingValue: 500_000,
            contentsValue: 200_000,
            businessIncomeValue: 100_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.recommendedAction).toContain(
      "tax assessor benchmarks",
    );
  });

  it("includes address in description or falls back to 'unknown address'", async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(
      makeDoc("d1", "ACORD_140", {
        propertyLocations: [
          {
            address: null,
            buildingValue: 500_000,
            contentsValue: 400_000,
            businessIncomeValue: 200_000,
          },
        ],
      }) as never,
    );

    await validatePropertyValues(SUB_ID);

    const callArg = mockPrisma.fraudIndicator.create.mock.calls[0][0];
    expect(callArg.data.description).toContain("unknown address");
  });
});
