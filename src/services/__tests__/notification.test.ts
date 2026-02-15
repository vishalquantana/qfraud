import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  sendNotification,
  type NotificationType,
  type NotificationData,
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
  getStateFraudWarning: vi.fn(
    () =>
      "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit is guilty of a crime."
  ),
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

const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  "SUBMISSION_RECEIVED",
  "SUBMISSION_APPROVED",
  "SUBMISSION_DECLINED",
  "INFO_NEEDED",
  "ESCALATION_NOTICE",
  "NEW_SUBMISSION_FOR_REVIEW",
  "SIU_REFERRAL",
];

const BROKER_FACING_TYPES: NotificationType[] = [
  "SUBMISSION_RECEIVED",
  "SUBMISSION_APPROVED",
  "SUBMISSION_DECLINED",
  "INFO_NEEDED",
  "ESCALATION_NOTICE",
];

const INTERNAL_TYPES: NotificationType[] = [
  "NEW_SUBMISSION_FOR_REVIEW",
  "SIU_REFERRAL",
];

const sampleData: NotificationData = {
  submissionId: "sub-test-123",
  insuredName: "Test Corp LLC",
  lineOfBusiness: "General Liability",
  trackingUrl: "https://app.example.com/submissions/sub-test-123",
  infoNeededDetails: "Please provide updated financial statements.",
  riskScore: 85,
  severity: "CRITICAL",
  indicatorCount: 5,
  assignedTo: "Jane Underwriter",
  caseId: "SIU-2025-001",
  stateCode: "NY",
};

// ─── Tests ────────────────────────────────────────────────

describe("notification service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return tenant with white label config
    mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
      makeTenantWithBranding() as any
    );
    // Reset env
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SENDGRID_API_KEY;
  });

  // ------------------------------------------------------------------
  // All 7 notification templates render without error
  // ------------------------------------------------------------------

  describe("template rendering", () => {
    it.each(ALL_NOTIFICATION_TYPES)(
      "renders the %s template without throwing",
      async (type) => {
        await expect(
          sendNotification(type, "test@example.com", TENANT.id, sampleData)
        ).resolves.toBeUndefined();
      }
    );

    it("renders all templates with minimal data (no optional fields)", async () => {
      for (const type of ALL_NOTIFICATION_TYPES) {
        await expect(
          sendNotification(type, "test@example.com", TENANT.id, {})
        ).resolves.toBeUndefined();
      }
    });

    it("renders SUBMISSION_RECEIVED with submission details", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification(
        "SUBMISSION_RECEIVED",
        "broker@test.com",
        TENANT.id,
        sampleData
      );

      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "broker@test.com",
          subject: expect.stringContaining("Submission Received"),
          html: expect.stringContaining("sub-test-123"),
        })
      );
    });
  });

  // ------------------------------------------------------------------
  // Broker-facing templates do NOT include fraud scores/detection details
  // ------------------------------------------------------------------

  describe("broker-facing templates security", () => {
    it.each(BROKER_FACING_TYPES)(
      "%s does NOT include fraud score in the HTML",
      async (type) => {
        const nodemailer = await import("nodemailer");
        const transport = nodemailer.default.createTransport();

        await sendNotification(type, "broker@test.com", TENANT.id, {
          ...sampleData,
          riskScore: 85,
          severity: "CRITICAL",
          indicatorCount: 5,
        });

        const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const html = call.html as string;

        // Broker-facing emails should NOT contain risk scores or detection details
        expect(html).not.toContain("85"); // risk score value
        expect(html).not.toContain("riskScore");
        expect(html).not.toContain("Risk Severity");
        expect(html).not.toContain("Fraud Indicators");
      }
    );

    it("SUBMISSION_APPROVED does not reveal why a submission was approved", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("SUBMISSION_APPROVED", "broker@test.com", TENANT.id, {
        ...sampleData,
        riskScore: 5,
      });

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).not.toContain("CRITICAL");
      expect(html).not.toContain("indicator");
      expect(html).not.toContain("fraud");
    });

    it("ESCALATION_NOTICE uses neutral language (no fraud terminology)", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("ESCALATION_NOTICE", "broker@test.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("Under Review");
      expect(html).not.toContain("Fraud");
      expect(html).not.toContain("CRITICAL");
      expect(html).not.toContain("indicator");
    });
  });

  // ------------------------------------------------------------------
  // SIU referral template includes severity and indicator count
  // ------------------------------------------------------------------

  describe("SIU referral template", () => {
    it("includes severity in the HTML", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("SIU_REFERRAL", "siu@test.com", TENANT.id, {
        ...sampleData,
        severity: "CRITICAL",
        indicatorCount: 7,
      });

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("CRITICAL");
    });

    it("includes indicator count in the HTML", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("SIU_REFERRAL", "siu@test.com", TENANT.id, {
        ...sampleData,
        indicatorCount: 7,
      });

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("7 flagged");
    });

    it("includes SIU case ID when provided", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("SIU_REFERRAL", "siu@test.com", TENANT.id, {
        ...sampleData,
        caseId: "SIU-2025-999",
      });

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("SIU-2025-999");
    });

    it("includes 'Immediate attention required' urgency message", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("SIU_REFERRAL", "siu@test.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("Immediate attention required");
    });

    it("subject line contains 'SIU Referral'", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("SIU_REFERRAL", "siu@test.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.subject).toContain("SIU Referral");
      expect(call.subject).toContain("Immediate Attention Required");
    });
  });

  // ------------------------------------------------------------------
  // NEW_SUBMISSION_FOR_REVIEW includes risk details for internal users
  // ------------------------------------------------------------------

  describe("NEW_SUBMISSION_FOR_REVIEW template", () => {
    it("includes severity for internal reviewers", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      await sendNotification("NEW_SUBMISSION_FOR_REVIEW", "uw@test.com", TENANT.id, {
        ...sampleData,
        severity: "HIGH",
        indicatorCount: 3,
      });

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("HIGH");
      expect(html).toContain("3 flagged");
    });
  });

  // ------------------------------------------------------------------
  // White-label branding applied
  // ------------------------------------------------------------------

  describe("white-label branding", () => {
    it("applies primary color from white label config", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ primaryColor: "#ff0000" }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("#ff0000");
    });

    it("includes the logo URL when configured", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ logoUrl: "https://mycompany.com/logo.png" }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("https://mycompany.com/logo.png");
    });

    it("includes footer text when configured", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ footerText: "Custom Footer - All rights reserved" }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("Custom Footer - All rights reserved");
    });

    it("includes support email in the footer", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ supportEmail: "help@mycompany.com" }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("help@mycompany.com");
    });

    it("includes support phone in the footer", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ supportPhone: "1-888-555-0000" }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("1-888-555-0000");
    });

    it("includes terms and privacy URLs when configured", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({
          termsUrl: "https://mycompany.com/terms",
          privacyUrl: "https://mycompany.com/privacy",
        }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain("https://mycompany.com/terms");
      expect(html).toContain("https://mycompany.com/privacy");
      expect(html).toContain("Terms of Use");
      expect(html).toContain("Privacy Policy");
    });

    it("uses custom email domain for from address", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({
          supportEmail: null,
          customEmailDomain: "custom-domain.com",
        }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.from).toBe("noreply@custom-domain.com");
    });

    it("uses supportEmail as from address when available", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ supportEmail: "support@acme.com" }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.from).toBe("support@acme.com");
    });

    it("falls back to default domain when no custom domain or support email", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({
          supportEmail: null,
          customEmailDomain: null,
        }) as any
      );

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.from).toBe("noreply@quantanashield.com");
    });

    it("falls back to tenant name when no logo URL is configured", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();

      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue(
        makeTenantWithBranding({ logoUrl: null }) as any
      );
      // Also set tenant.logoUrl to null
      mockedPrisma.tenant.findUniqueOrThrow.mockResolvedValue({
        ...makeTenantWithBranding({ logoUrl: null }),
        logoUrl: null,
      } as any);

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      const call = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const html = call.html as string;

      expect(html).toContain(TENANT.name);
    });
  });

  // ------------------------------------------------------------------
  // SendGrid vs SMTP provider switching
  // ------------------------------------------------------------------

  describe("email provider switching", () => {
    it("uses SMTP by default when EMAIL_PROVIDER is not set", async () => {
      const nodemailer = await import("nodemailer");

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      expect(nodemailer.default.createTransport).toHaveBeenCalled();
    });

    it("uses SMTP when EMAIL_PROVIDER is 'smtp'", async () => {
      process.env.EMAIL_PROVIDER = "smtp";
      const nodemailer = await import("nodemailer");

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      expect(nodemailer.default.createTransport).toHaveBeenCalled();
    });

    it("uses SendGrid when EMAIL_PROVIDER is 'sendgrid'", async () => {
      process.env.EMAIL_PROVIDER = "sendgrid";
      process.env.SENDGRID_API_KEY = "SG.test-api-key";

      const sgMail = await import("@sendgrid/mail");

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      expect(sgMail.default.setApiKey).toHaveBeenCalledWith("SG.test-api-key");
      expect(sgMail.default.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          subject: expect.stringContaining("Submission Received"),
        })
      );
    });

    it("skips email silently when SendGrid is configured but API key is missing", async () => {
      process.env.EMAIL_PROVIDER = "sendgrid";
      delete process.env.SENDGRID_API_KEY;

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should not throw
      await expect(
        sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData)
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  // ------------------------------------------------------------------
  // Notification failure doesn't throw (graceful degradation)
  // ------------------------------------------------------------------

  describe("graceful error handling", () => {
    it("does NOT throw when email sending fails", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();
      (transport.sendMail as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("SMTP connection refused")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData)
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it("logs the error when sending fails", async () => {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport();
      (transport.sendMail as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("SMTP timeout")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send SUBMISSION_RECEIVED notification"),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("does NOT throw when branding lookup fails", async () => {
      mockedPrisma.tenant.findUniqueOrThrow.mockRejectedValue(
        new Error("Tenant not found")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData)
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it("does NOT throw when SendGrid send fails", async () => {
      process.env.EMAIL_PROVIDER = "sendgrid";
      process.env.SENDGRID_API_KEY = "SG.test-api-key";

      const sgMail = await import("@sendgrid/mail");
      (sgMail.default.send as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("SendGrid rate limited")
      );

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        sendNotification("SUBMISSION_RECEIVED", "test@example.com", TENANT.id, sampleData)
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });
});
