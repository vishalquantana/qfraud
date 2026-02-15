import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { analyzeBrokerLetter } from "@/services/analysis-broker-letter-nlp";

// ─── Mock dependencies ───────────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

// Mock S3
const mockGetFromS3 = vi.fn();
vi.mock("@/lib/s3", () => ({
  getFromS3: (...args: unknown[]) => mockGetFromS3(...args),
}));

// Mock pdf-parse — the service does `const { PDFParse } = await import("pdf-parse")`
// and then `new PDFParse(...)`, so we need a proper constructor function.
const mockGetText = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock("pdf-parse", () => {
  return {
    PDFParse: function MockPDFParse() {
      return {
        getText: mockGetText,
        destroy: mockDestroy,
      };
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────

const SUBMISSION_ID = "sub-test";
const TENANT_ID = "tenant-001";
const DOC_ID = "doc-broker-letter";

function setupSubmission() {
  mockPrisma.submission.findUniqueOrThrow.mockResolvedValue({
    id: SUBMISSION_ID,
    tenantId: TENANT_ID,
  } as never);
}

function makeBrokerDoc(id = DOC_ID) {
  return {
    id,
    submissionId: SUBMISSION_ID,
    tenantId: TENANT_ID,
    documentType: "BROKER_SUBMISSION",
    status: "ANALYZED",
    s3Key: `tenant-001/sub-test/${id}/letter.pdf`,
    fileName: "broker_letter.pdf",
    createdAt: new Date("2025-06-01"),
    extractedData: {},
  };
}

function setupBrokerDoc(text: string) {
  mockPrisma.document.findMany.mockImplementation(((args: {
    where?: { documentType?: string };
  }) => {
    if (args?.where?.documentType === "BROKER_SUBMISSION") {
      return Promise.resolve([makeBrokerDoc()]);
    }
    // For loss run docs (concealment check)
    if (args?.where?.documentType === "LOSS_RUN") {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as never);

  mockGetFromS3.mockResolvedValue(Buffer.from("fake-pdf"));
  mockGetText.mockResolvedValue({ text });
}

// ─── Tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.fraudIndicator.create.mockResolvedValue({} as never);
  mockPrisma.document.findMany.mockResolvedValue([]);
});

describe("analyzeBrokerLetter", () => {
  // ── Pressure language detection ──────────────────────

  describe("pressure language detection", () => {
    it("detects urgency phrases like 'must bind immediately'", async () => {
      setupSubmission();
      setupBrokerDoc(
        "Dear Underwriter, we need this processed immediately. The client needs a quick response as the current policy is expiring today. Please bind coverage ASAP.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const pressureCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_PRESSURE_LANGUAGE",
      );

      expect(pressureCall).toBeDefined();
      const data = (pressureCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("MEDIUM");
      expect(data.category).toBe("NLP");
    });

    it("detects 'expiring today' as urgency language", async () => {
      setupSubmission();
      setupBrokerDoc(
        "The insured's current policy is expiring today and we need coverage bound immediately. Time is of the essence.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const pressureCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_PRESSURE_LANGUAGE",
      );

      expect(pressureCall).toBeDefined();
    });

    it("detects 'last-minute' and 'critical deadline' language", async () => {
      setupSubmission();
      setupBrokerDoc(
        "This is a last-minute submission due to a critical deadline. We cannot wait any longer for a decision.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const pressureCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_PRESSURE_LANGUAGE",
      );

      expect(pressureCall).toBeDefined();
    });
  });

  // ── Concealment pattern detection ────────────────────

  describe("concealment pattern detection", () => {
    it("flags when broker letter omits mention of significant claims found in loss runs", async () => {
      setupSubmission();

      // Letter with no mention of losses at all
      const letterText =
        "Dear Underwriter, please find enclosed the application for ABC Manufacturing LLC. The insured is a well-established business with strong operations and excellent management. We look forward to your favorable consideration. Please let us know if you need any additional information.";

      mockGetFromS3.mockResolvedValue(Buffer.from("fake-pdf"));
      mockGetText.mockResolvedValue({ text: letterText });

      // Loss run doc with significant claims
      const lossRunDoc = {
        id: "doc-lossrun",
        submissionId: SUBMISSION_ID,
        tenantId: TENANT_ID,
        documentType: "LOSS_RUN",
        status: "ANALYZED",
        extractedData: {
          claims: [
            { claimNumber: "C001", totalIncurred: 50000, dateOfLoss: "2024-01-15" },
            { claimNumber: "C002", totalIncurred: 75000, dateOfLoss: "2024-06-20" },
          ],
        },
        createdAt: new Date("2025-06-01"),
      };

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "BROKER_SUBMISSION") {
          return Promise.resolve([makeBrokerDoc()]);
        }
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const concealmentCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_LOSS_CONCEALMENT",
      );

      expect(concealmentCall).toBeDefined();
      const data = (concealmentCall![0] as { data: Record<string, unknown> })
        .data;
      expect(data.severity).toBe("CRITICAL");
      expect(data.category).toBe("NLP");
    });

    it("does not flag concealment when broker letter mentions losses", async () => {
      setupSubmission();

      const letterText =
        "Dear Underwriter, the insured had a prior loss history including two claims in 2024. The loss runs are attached for your review.";

      mockGetFromS3.mockResolvedValue(Buffer.from("fake-pdf"));
      mockGetText.mockResolvedValue({ text: letterText });

      const lossRunDoc = {
        id: "doc-lossrun",
        submissionId: SUBMISSION_ID,
        tenantId: TENANT_ID,
        documentType: "LOSS_RUN",
        status: "ANALYZED",
        extractedData: {
          claims: [
            { claimNumber: "C001", totalIncurred: 50000, dateOfLoss: "2024-01-15" },
          ],
        },
        createdAt: new Date("2025-06-01"),
      };

      mockPrisma.document.findMany.mockImplementation(((args: {
        where?: { documentType?: string };
      }) => {
        if (args?.where?.documentType === "BROKER_SUBMISSION") {
          return Promise.resolve([makeBrokerDoc()]);
        }
        if (args?.where?.documentType === "LOSS_RUN") {
          return Promise.resolve([lossRunDoc]);
        }
        return Promise.resolve([]);
      }) as never);

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const concealmentCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_LOSS_CONCEALMENT",
      );
      expect(concealmentCall).toBeUndefined();
    });
  });

  // ── Manipulation language detection ──────────────────

  describe("manipulation language detection", () => {
    it("detects 'don't worry about' and 'ignore' patterns", async () => {
      setupSubmission();
      setupBrokerDoc(
        "Please don't worry about the gap in coverage history. You can ignore the prior loss run discrepancies. Let's push this through quickly.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const manipulationCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_MANIPULATION_LANGUAGE",
      );

      expect(manipulationCall).toBeDefined();
      const data = (manipulationCall![0] as { data: Record<string, unknown> })
        .data;
      expect(data.severity).toBe("HIGH");
      expect(data.category).toBe("NLP");
    });

    it("detects 'make an exception' and 'bypass' patterns", async () => {
      setupSubmission();
      setupBrokerDoc(
        "I know this account has some issues, but I'd appreciate it if you could make an exception for this client. We need to bypass the usual review process.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const manipulationCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_MANIPULATION_LANGUAGE",
      );

      expect(manipulationCall).toBeDefined();
    });

    it("detects 'skip the usual' and 'fast-track' patterns", async () => {
      setupSubmission();
      setupBrokerDoc(
        "We need to fast-track this application. Can we skip the standard review and just bind coverage?",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const manipulationCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_MANIPULATION_LANGUAGE",
      );

      expect(manipulationCall).toBeDefined();
    });

    it("detects 'just a formality' and 'overlook' language", async () => {
      setupSubmission();
      setupBrokerDoc(
        "The inspection report is just a formality. Please overlook the minor discrepancy in the financials.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const manipulationCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_MANIPULATION_LANGUAGE",
      );

      expect(manipulationCall).toBeDefined();
    });
  });

  // ── Clean letter (no indicators) ─────────────────────

  describe("clean letters", () => {
    it("produces no fraud indicators for professional, standard language", async () => {
      setupSubmission();
      setupBrokerDoc(
        "Dear Underwriter, please find enclosed the completed application for ABC Manufacturing LLC. The insured has been in operation since 2005 and maintains a strong safety program. Attached you will find the ACORD 125, financial statements, and loss runs for your review. We believe this is a well-managed risk and appreciate your consideration. Please do not hesitate to contact us if you require additional information.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });

    it("produces no indicators when no broker documents exist", async () => {
      setupSubmission();
      mockPrisma.document.findMany.mockResolvedValue([]);

      await analyzeBrokerLetter(SUBMISSION_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });
  });

  // ── Declination language detection ───────────────────

  describe("declination evidence detection", () => {
    it("detects language about prior declinations and non-renewals", async () => {
      setupSubmission();
      setupBrokerDoc(
        "The insured was previously declined by two carriers and received a non-renewal from their current provider. We have had difficulty finding coverage in the standard market.",
      );

      await analyzeBrokerLetter(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const declinationCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "BROKER_DECLINATION_EVIDENCE",
      );

      expect(declinationCall).toBeDefined();
      const data = (declinationCall![0] as { data: Record<string, unknown> })
        .data;
      expect(data.severity).toBe("HIGH");
    });
  });
});
