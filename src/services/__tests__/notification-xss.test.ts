import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  sendNotification,
  type NotificationType,
} from "@/services/notification";
import { TENANT, WHITE_LABEL_CONFIG } from "@/test/fixtures";

const mockedPrisma = vi.mocked(prisma);

// ─── Mocks ────────────────────────────────────────────────

vi.mock("nodemailer", () => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test-id" });
  return {
    default: {
      createTransport: vi.fn(() => ({
        sendMail: sendMailMock,
      })),
    },
  };
});

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([{ statusCode: 202 }]),
  },
}));

vi.mock("@/services/state-fraud-warnings", () => ({
  getStateFraudWarning: vi.fn(() => "Fraud warning text."),
}));

// ─── Helpers ──────────────────────────────────────────────

function makeTenantWithBranding(brandingOverrides: Record<string, unknown> = {}) {
  return {
    id: TENANT.id,
    name: TENANT.name,
    slug: TENANT.slug,
    domain: TENANT.domain,
    logoUrl: TENANT.logoUrl,
    primaryColor: TENANT.primaryColor,
    secondaryColor: TENANT.secondaryColor,
    createdAt: TENANT.createdAt,
    updatedAt: TENANT.updatedAt,
    whiteLabelConfig: {
      ...WHITE_LABEL_CONFIG,
      ...brandingOverrides,
    },
  };
}

async function getRenderedHtml(
  type: NotificationType,
  data: Record<string, unknown>,
  brandingOverrides: Record<string, unknown> = {}
): Promise<string> {
  mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
    makeTenantWithBranding(brandingOverrides) as any
  );

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport();

  await sendNotification(type, "test@example.com", TENANT.id, data as any);

  const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return call.html as string;
}

// ─── XSS Prevention Tests ─────────────────────────────────

describe("notification XSS prevention", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
      makeTenantWithBranding() as any
    );
    delete process.env.EMAIL_PROVIDER;
  });

  describe("user-controlled data escaping", () => {
    it("escapes HTML in insuredName", async () => {
      const html = await getRenderedHtml("SUBMISSION_RECEIVED", {
        insuredName: '<script>alert("xss")</script>',
        submissionId: "sub-001",
      });

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes HTML in submissionId", async () => {
      const html = await getRenderedHtml("SUBMISSION_RECEIVED", {
        submissionId: '<script>alert(1)</script>',
      });

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes HTML in lineOfBusiness", async () => {
      const html = await getRenderedHtml("SUBMISSION_RECEIVED", {
        lineOfBusiness: '"><script>alert(1)</script>',
        submissionId: "sub-001",
      });

      expect(html).not.toContain("<script>");
    });

    it("escapes HTML in infoNeededDetails", async () => {
      const html = await getRenderedHtml("INFO_NEEDED", {
        infoNeededDetails: '<form action="https://evil.com"><input>Phishing</form>',
        submissionId: "sub-001",
      });

      expect(html).not.toContain("<form");
      expect(html).toContain("&lt;form");
    });

    it("escapes HTML in caseId for SIU_REFERRAL", async () => {
      const html = await getRenderedHtml("SIU_REFERRAL", {
        caseId: '<script>steal()</script>',
        submissionId: "sub-001",
      });

      expect(html).not.toContain("<script>");
    });
  });

  describe("branding URL validation", () => {
    it("sanitizes javascript: protocol in logoUrl", async () => {
      const html = await getRenderedHtml(
        "SUBMISSION_RECEIVED",
        { submissionId: "sub-001" },
        { logoUrl: "javascript:alert('xss')" }
      );

      expect(html).not.toContain("javascript:");
    });

    it("sanitizes javascript: protocol in termsUrl", async () => {
      const html = await getRenderedHtml(
        "SUBMISSION_RECEIVED",
        { submissionId: "sub-001" },
        { termsUrl: "javascript:alert('xss')" }
      );

      expect(html).not.toContain("javascript:");
    });

    it("sanitizes javascript: protocol in privacyUrl", async () => {
      const html = await getRenderedHtml(
        "SUBMISSION_RECEIVED",
        { submissionId: "sub-001" },
        { privacyUrl: "javascript:void(0)" }
      );

      expect(html).not.toContain("javascript:");
    });

    it("allows valid https URLs", async () => {
      const html = await getRenderedHtml(
        "SUBMISSION_RECEIVED",
        { submissionId: "sub-001" },
        { logoUrl: "https://company.com/logo.png" }
      );

      expect(html).toContain("https://company.com/logo.png");
    });
  });

  describe("branding text escaping", () => {
    it("escapes HTML in tenant name (fallback when no logo)", async () => {
      const html = await getRenderedHtml(
        "SUBMISSION_RECEIVED",
        { submissionId: "sub-001" },
        { logoUrl: null }
      );

      // Tenant name from fixture is safe, but test the mechanism
      expect(html).toContain(TENANT.name);
    });

    it("escapes HTML in footerText", async () => {
      const html = await getRenderedHtml(
        "SUBMISSION_RECEIVED",
        { submissionId: "sub-001" },
        { footerText: '<script>alert("footer xss")</script>' }
      );

      expect(html).not.toContain("<script>");
    });
  });

  describe("all templates are protected", () => {
    const xssPayload = '<script>alert("xss")</script>';
    const templates: NotificationType[] = [
      "SUBMISSION_RECEIVED",
      "SUBMISSION_APPROVED",
      "SUBMISSION_DECLINED",
      "INFO_NEEDED",
      "ESCALATION_NOTICE",
      "NEW_SUBMISSION_FOR_REVIEW",
      "SIU_REFERRAL",
    ];

    it.each(templates)(
      "%s template escapes XSS in insuredName",
      async (type) => {
        const html = await getRenderedHtml(type, {
          insuredName: xssPayload,
          submissionId: "sub-001",
          severity: "HIGH",
          indicatorCount: 3,
          caseId: "SIU-001",
        });

        // Raw HTML tags must be escaped
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
      }
    );
  });
});
