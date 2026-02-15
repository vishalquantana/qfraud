import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveEntities } from "@/services/resolution-entity";

// ─── Typed mocks ──────────────────────────────────────────

const mockPrisma = vi.mocked(prisma, true);

// ─── Helpers ──────────────────────────────────────────────

const SUBMISSION_ID = "sub-current";
const TENANT_ID = "tenant-001";

function setupSubmission() {
  mockPrisma.submission.findUniqueOrThrow.mockResolvedValue({
    id: SUBMISSION_ID,
    tenantId: TENANT_ID,
  } as never);
}

/**
 * Create a mock document row for findFirst lookups.
 */
function makeDoc(
  submissionId: string,
  documentType: string,
  extractedData: Record<string, unknown> | null,
) {
  return {
    id: `doc-${submissionId}-${documentType.toLowerCase()}`,
    submissionId,
    tenantId: TENANT_ID,
    documentType,
    status: "ANALYZED",
    extractedData,
    createdAt: new Date("2025-06-01"),
  };
}

/**
 * Configure findFirst to return different docs depending on submissionId
 * and documentType. The map is keyed by `${submissionId}::${documentType}`.
 */
function mockFindFirst(
  map: Record<string, ReturnType<typeof makeDoc> | null>,
) {
  mockPrisma.document.findFirst.mockImplementation(((args: {
    where?: { submissionId?: string; documentType?: string };
  }) => {
    const subId = args?.where?.submissionId;
    const docType = args?.where?.documentType;
    const key = `${subId}::${docType}`;
    if (key in map) {
      return Promise.resolve(map[key]);
    }
    return Promise.resolve(null);
  }) as never);
}

// ─── Tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.fraudIndicator.create.mockResolvedValue({} as never);
  mockPrisma.document.findFirst.mockResolvedValue(null);
  mockPrisma.submission.count.mockResolvedValue(0);
});

describe("resolveEntities", () => {
  // ── Fuzzy name matching across submissions ───────────

  describe("same entity across multiple submissions (fuzzy name matching)", () => {
    it("flags when the same owner name appears in >2 submissions", async () => {
      setupSubmission();

      // Current submission has ACORD 125 with a business name.
      // Two other submissions have very similar names (within Levenshtein threshold 0.8).
      // "Acme Manufacturing" (normalized: "acme manufacturing", 18 chars)
      // vs "Acme Manufacturng" (normalized: "acme manufacturng", 17 chars) => dist=1, sim=1-1/18=0.944
      // vs "Acme Manufcturing" (normalized: "acme manufcturing", 17 chars) => dist=1, sim=1-1/18=0.944
      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "Acme Manufacturng" },
        { id: "sub-other-2", insuredName: "Acme Manufcturing" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      // Document lookup for all submissions
      mockFindFirst({
        // Current submission
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Acme Manufacturing",
          applicantName: "Acme Manufacturing",
          physicalAddress: "123 Main St, Springfield, IL 62701",
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
        // Other submission 1 => very similar name (1-char typo)
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Acme Manufacturng",
          applicantName: "Acme Manufacturng",
          physicalAddress: "456 Oak Ave, Chicago, IL 60601",
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: null,
        [`sub-other-1::COI`]: null,
        // Other submission 2 => very similar name (1-char typo)
        [`sub-other-2::ACORD_125`]: makeDoc("sub-other-2", "ACORD_125", {
          businessName: "Acme Manufcturing",
          applicantName: "Acme Manufcturing",
          physicalAddress: "789 Elm St, Peoria, IL 61602",
          mailingAddress: null,
        }),
        [`sub-other-2::ENTITY_DOC`]: null,
        [`sub-other-2::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ownerCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Repeated Owner Across Submissions",
      );

      expect(ownerCall).toBeDefined();
      const data = (ownerCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("CRITICAL");
      expect(data.category).toBe("ENTITY_INTEL");
    });

    it("does not flag when owner appears in only 1 other submission (total 2)", async () => {
      setupSubmission();

      // Only one other submission with a similar name (total = 2, need >2 for flag)
      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "Acme Manufacturng" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Acme Manufacturing",
          applicantName: null,
          physicalAddress: null,
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Acme Manufacturng",
          applicantName: null,
          physicalAddress: null,
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: null,
        [`sub-other-1::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const ownerCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Repeated Owner Across Submissions",
      );
      expect(ownerCall).toBeUndefined();
    });
  });

  // ── Similar address matching ─────────────────────────

  describe("similar addresses across submissions", () => {
    it("flags when the same address appears across unrelated submissions", async () => {
      setupSubmission();

      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "XYZ Industries" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      // Both submissions share a very similar address
      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Alpha Services LLC",
          applicantName: null,
          physicalAddress: "100 Commerce Drive, Suite 200, Chicago, IL 60601",
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Beta Holdings Inc",
          applicantName: null,
          physicalAddress: "100 Commerce Drive, Suite 200, Chicago, IL 60601",
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: null,
        [`sub-other-1::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const addressCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Shared Address Across Submissions",
      );

      expect(addressCall).toBeDefined();
      const data = (addressCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("HIGH");
      expect(data.category).toBe("ENTITY_INTEL");
    });

    it("flags when addresses are similar but not identical (fuzzy match)", async () => {
      setupSubmission();

      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "Other Corp" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      // Slightly different formatting but same address
      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Alpha Services LLC",
          applicantName: null,
          physicalAddress: "100 Commerce Dr, Ste 200, Chicago IL 60601",
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Beta Holdings Inc",
          applicantName: null,
          physicalAddress: "100 Commerce Drive, Suite 200, Chicago, IL 60601",
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: null,
        [`sub-other-1::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const addressCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Shared Address Across Submissions",
      );

      expect(addressCall).toBeDefined();
    });
  });

  // ── No false positives for clearly different entities ─

  describe("no false positives for clearly different entities", () => {
    it("does not flag completely different business names", async () => {
      setupSubmission();

      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "Sunshine Bakery" },
        { id: "sub-other-2", insuredName: "Downtown Auto Repair" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Pacific Northwest Lumber Co",
          applicantName: null,
          physicalAddress: "1000 Forest Road, Portland, OR 97201",
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Sunshine Bakery",
          applicantName: null,
          physicalAddress: "50 Baker Street, San Francisco, CA 94102",
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: null,
        [`sub-other-1::COI`]: null,
        [`sub-other-2::ACORD_125`]: makeDoc("sub-other-2", "ACORD_125", {
          businessName: "Downtown Auto Repair",
          applicantName: null,
          physicalAddress: "789 Motor Way, Detroit, MI 48201",
          mailingAddress: null,
        }),
        [`sub-other-2::ENTITY_DOC`]: null,
        [`sub-other-2::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;

      // No owner or address match expected
      const ownerCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Repeated Owner Across Submissions",
      );
      const addressCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Shared Address Across Submissions",
      );

      expect(ownerCall).toBeUndefined();
      expect(addressCall).toBeUndefined();
    });

    it("does not flag different addresses even in the same city", async () => {
      setupSubmission();

      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "Other LLC" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Alpha Services LLC",
          applicantName: null,
          physicalAddress: "100 Main Street, Chicago, IL 60601",
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Beta Holdings Inc",
          applicantName: null,
          physicalAddress: "5500 Michigan Avenue, Chicago, IL 60615",
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: null,
        [`sub-other-1::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const addressCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Shared Address Across Submissions",
      );
      expect(addressCall).toBeUndefined();
    });
  });

  // ── EIN matching ─────────────────────────────────────

  describe("duplicate EIN detection", () => {
    it("flags the same EIN appearing in another submission", async () => {
      setupSubmission();

      const otherSubmissions = [
        { id: "sub-other-1", insuredName: "Different Name LLC" },
      ];

      mockPrisma.submission.findMany.mockResolvedValue(
        otherSubmissions as never,
      );

      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Alpha Services LLC",
          applicantName: null,
          physicalAddress: null,
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: makeDoc(
          SUBMISSION_ID,
          "ENTITY_DOC",
          {
            entityName: "Alpha Services LLC",
            ein: "12-3456789",
            officers: [],
          },
        ),
        [`${SUBMISSION_ID}::COI`]: null,
        [`sub-other-1::ACORD_125`]: makeDoc("sub-other-1", "ACORD_125", {
          businessName: "Totally Different Corp",
          applicantName: null,
          physicalAddress: null,
          mailingAddress: null,
        }),
        [`sub-other-1::ENTITY_DOC`]: makeDoc("sub-other-1", "ENTITY_DOC", {
          entityName: "Totally Different Corp",
          ein: "12-3456789", // Same EIN!
          officers: [],
        }),
        [`sub-other-1::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      const createCalls = mockPrisma.fraudIndicator.create.mock.calls;
      const einCall = createCalls.find(
        (call) =>
          (call[0] as { data: { indicatorName: string } }).data
            .indicatorName === "Duplicate EIN Across Submissions",
      );

      expect(einCall).toBeDefined();
      const data = (einCall![0] as { data: Record<string, unknown> }).data;
      expect(data.severity).toBe("CRITICAL");
    });
  });

  // ── No identifiers ──────────────────────────────────

  describe("edge cases", () => {
    it("skips when no identifiers can be extracted from the current submission", async () => {
      setupSubmission();

      mockPrisma.submission.findMany.mockResolvedValue([] as never);

      // No documents at all
      mockPrisma.document.findFirst.mockResolvedValue(null);

      await resolveEntities(SUBMISSION_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });

    it("skips when no other submissions exist in the tenant", async () => {
      setupSubmission();

      mockPrisma.submission.findMany.mockResolvedValue([] as never);

      mockFindFirst({
        [`${SUBMISSION_ID}::ACORD_125`]: makeDoc(SUBMISSION_ID, "ACORD_125", {
          businessName: "Test Corp",
          applicantName: null,
          physicalAddress: "123 Test St",
          mailingAddress: null,
        }),
        [`${SUBMISSION_ID}::ENTITY_DOC`]: null,
        [`${SUBMISSION_ID}::COI`]: null,
      });

      await resolveEntities(SUBMISSION_ID);

      expect(mockPrisma.fraudIndicator.create).not.toHaveBeenCalled();
    });
  });
});
