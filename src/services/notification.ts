import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";
import { getStateFraudWarning } from "@/services/state-fraud-warnings";

// ─── Types ─────────────────────────────────────────────────

export type NotificationType =
  | "SUBMISSION_RECEIVED"
  | "SUBMISSION_APPROVED"
  | "SUBMISSION_DECLINED"
  | "INFO_NEEDED"
  | "ESCALATION_NOTICE"
  | "NEW_SUBMISSION_FOR_REVIEW"
  | "SIU_REFERRAL";

export interface NotificationData {
  submissionId?: string;
  insuredName?: string;
  lineOfBusiness?: string;
  trackingUrl?: string;
  infoNeededDetails?: string;
  riskScore?: number;
  severity?: string;
  indicatorCount?: number;
  assignedTo?: string;
  caseId?: string;
  stateCode?: string;
}

interface WhiteLabelBranding {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  footerText: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  customEmailDomain: string | null;
  tenantName: string;
}

interface EmailContent {
  subject: string;
  html: string;
}

// ─── Email Provider ────────────────────────────────────────

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  fromAddress: string
): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER || "smtp";

  if (provider === "sendgrid") {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.error("SENDGRID_API_KEY not configured, skipping email");
      return;
    }
    sgMail.setApiKey(apiKey);
    await sgMail.send({
      to,
      from: fromAddress,
      subject,
      html,
    });
  } else {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "localhost",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASSWORD
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            }
          : undefined,
    });

    await transport.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
    });
  }
}

// ─── Branding ──────────────────────────────────────────────

async function getBranding(tenantId: string): Promise<WhiteLabelBranding> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { whiteLabelConfig: true },
  });

  const wl = tenant.whiteLabelConfig;
  return {
    logoUrl: wl?.logoUrl ?? tenant.logoUrl ?? null,
    primaryColor: wl?.primaryColor ?? "#1e40af",
    secondaryColor: wl?.secondaryColor ?? "#3b82f6",
    accentColor: wl?.accentColor ?? "#f59e0b",
    footerText: wl?.footerText ?? null,
    supportEmail: wl?.supportEmail ?? null,
    supportPhone: wl?.supportPhone ?? null,
    termsUrl: wl?.termsUrl ?? null,
    privacyUrl: wl?.privacyUrl ?? null,
    customEmailDomain: wl?.customEmailDomain ?? null,
    tenantName: tenant.name,
  };
}

function getFromAddress(branding: WhiteLabelBranding): string {
  if (branding.supportEmail) return branding.supportEmail;
  const domain = branding.customEmailDomain || "quantanashield.com";
  return `noreply@${domain}`;
}

// ─── Email Layout ──────────────────────────────────────────

function wrapInLayout(
  body: string,
  branding: WhiteLabelBranding
): string {
  const logo = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.tenantName}" style="max-height:48px;margin-bottom:16px;" />`
    : `<h2 style="color:${branding.primaryColor};margin:0 0 16px;">${branding.tenantName}</h2>`;

  const footerLinks: string[] = [];
  if (branding.termsUrl)
    footerLinks.push(`<a href="${branding.termsUrl}" style="color:${branding.secondaryColor};">Terms of Use</a>`);
  if (branding.privacyUrl)
    footerLinks.push(`<a href="${branding.privacyUrl}" style="color:${branding.secondaryColor};">Privacy Policy</a>`);

  const footerLinksHtml = footerLinks.length
    ? `<p style="margin:8px 0 0;">${footerLinks.join(" | ")}</p>`
    : "";

  const footerText = branding.footerText
    ? `<p style="margin:0;">${branding.footerText}</p>`
    : "";

  const supportInfo =
    branding.supportEmail || branding.supportPhone
      ? `<p style="margin:8px 0 0;">Contact us: ${[branding.supportEmail, branding.supportPhone].filter(Boolean).join(" | ")}</p>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background-color:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background-color:${branding.primaryColor};padding:24px 32px;">
            ${logo}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="background-color:#f1f5f9;padding:16px 32px;font-size:12px;color:#64748b;text-align:center;">
            ${footerText}
            ${supportInfo}
            ${footerLinksHtml}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Templates ─────────────────────────────────────────────
// Broker-facing templates never reveal fraud scores or detection logic.

function buildSubmissionReceived(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const trackingLink = data.trackingUrl
    ? `<p><a href="${data.trackingUrl}" style="display:inline-block;padding:12px 24px;background-color:${branding.primaryColor};color:#ffffff;text-decoration:none;border-radius:6px;">Track Your Submission</a></p>`
    : "";

  const body = `
    <h1 style="color:#1e293b;font-size:20px;margin:0 0 16px;">Submission Received</h1>
    <p style="color:#475569;line-height:1.6;">Thank you for your submission. We have received your documents and will begin processing shortly.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
      ${data.lineOfBusiness ? `<tr><td style="padding:8px 0;color:#64748b;">Line of Business</td><td style="padding:8px 0;color:#1e293b;">${data.lineOfBusiness}</td></tr>` : ""}
    </table>
    <p style="color:#475569;line-height:1.6;">You will receive updates as your submission is reviewed.</p>
    ${trackingLink}
    <div style="background-color:#f1f5f9;border:1px solid #cbd5e1;padding:16px;margin:24px 0 0;border-radius:6px;">
      <p style="margin:0 0 8px;color:#475569;font-weight:600;font-size:13px;">Fraud Warning Notice</p>
      <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">${getStateFraudWarning(data.stateCode ?? null)}</p>
    </div>`;

  return {
    subject: `Submission Received - ${data.insuredName || data.submissionId || "New Submission"}`,
    html: wrapInLayout(body, branding),
  };
}

function buildSubmissionApproved(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const body = `
    <h1 style="color:#16a34a;font-size:20px;margin:0 0 16px;">Submission Approved</h1>
    <p style="color:#475569;line-height:1.6;">Your submission has been reviewed and approved.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
    </table>
    <p style="color:#475569;line-height:1.6;">Your assigned underwriter will follow up with next steps.</p>`;

  return {
    subject: `Submission Approved - ${data.insuredName || data.submissionId || ""}`,
    html: wrapInLayout(body, branding),
  };
}

function buildSubmissionDeclined(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const body = `
    <h1 style="color:#dc2626;font-size:20px;margin:0 0 16px;">Submission Declined</h1>
    <p style="color:#475569;line-height:1.6;">After careful review, we are unable to proceed with this submission at this time.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
    </table>
    <p style="color:#475569;line-height:1.6;">If you have questions, please contact your underwriter or our support team for further details.</p>`;

  return {
    subject: `Submission Update - ${data.insuredName || data.submissionId || ""}`,
    html: wrapInLayout(body, branding),
  };
}

function buildInfoNeeded(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const details = data.infoNeededDetails
    ? `<div style="background-color:#fff7ed;border-left:4px solid #f97316;padding:12px 16px;margin:16px 0;border-radius:4px;">
        <p style="margin:0;color:#9a3412;font-weight:600;">Information Requested:</p>
        <p style="margin:8px 0 0;color:#475569;">${data.infoNeededDetails}</p>
      </div>`
    : "";

  const trackingLink = data.trackingUrl
    ? `<p><a href="${data.trackingUrl}" style="display:inline-block;padding:12px 24px;background-color:${branding.accentColor};color:#ffffff;text-decoration:none;border-radius:6px;">View Submission &amp; Upload Documents</a></p>`
    : "";

  const body = `
    <h1 style="color:#ea580c;font-size:20px;margin:0 0 16px;">Additional Information Needed</h1>
    <p style="color:#475569;line-height:1.6;">We need additional information to continue processing your submission.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
    </table>
    ${details}
    <p style="color:#475569;line-height:1.6;">Please provide the requested information at your earliest convenience to avoid delays.</p>
    ${trackingLink}`;

  return {
    subject: `Action Required: Additional Information Needed - ${data.insuredName || data.submissionId || ""}`,
    html: wrapInLayout(body, branding),
  };
}

function buildEscalationNotice(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const body = `
    <h1 style="color:${branding.primaryColor};font-size:20px;margin:0 0 16px;">Submission Under Review</h1>
    <p style="color:#475569;line-height:1.6;">Your submission is currently being reviewed by our underwriting team.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
    </table>
    <p style="color:#475569;line-height:1.6;">You will be notified once a decision has been made. No action is needed from you at this time.</p>`;

  return {
    subject: `Submission Under Review - ${data.insuredName || data.submissionId || ""}`,
    html: wrapInLayout(body, branding),
  };
}

function buildNewSubmissionForReview(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const body = `
    <h1 style="color:${branding.primaryColor};font-size:20px;margin:0 0 16px;">New Submission for Review</h1>
    <p style="color:#475569;line-height:1.6;">A new submission has been assigned to you for review.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
      ${data.lineOfBusiness ? `<tr><td style="padding:8px 0;color:#64748b;">Line of Business</td><td style="padding:8px 0;color:#1e293b;">${data.lineOfBusiness}</td></tr>` : ""}
      ${data.indicatorCount !== undefined ? `<tr><td style="padding:8px 0;color:#64748b;">Fraud Indicators</td><td style="padding:8px 0;color:#1e293b;">${data.indicatorCount} flagged</td></tr>` : ""}
      ${data.severity ? `<tr><td style="padding:8px 0;color:#64748b;">Risk Severity</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.severity}</td></tr>` : ""}
    </table>
    ${data.trackingUrl ? `<p><a href="${data.trackingUrl}" style="display:inline-block;padding:12px 24px;background-color:${branding.primaryColor};color:#ffffff;text-decoration:none;border-radius:6px;">Review Submission</a></p>` : ""}`;

  return {
    subject: `New Submission for Review: ${data.insuredName || data.submissionId || ""} [${data.severity || ""}]`,
    html: wrapInLayout(body, branding),
  };
}

function buildSIUReferral(
  data: NotificationData,
  branding: WhiteLabelBranding
): EmailContent {
  const body = `
    <h1 style="color:#7c3aed;font-size:20px;margin:0 0 16px;">SIU Referral: Investigation Required</h1>
    <p style="color:#475569;line-height:1.6;">A submission has been referred to the Special Investigations Unit for further investigation.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Submission ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.submissionId || "N/A"}</td></tr>
      ${data.caseId ? `<tr><td style="padding:8px 0;color:#64748b;">SIU Case ID</td><td style="padding:8px 0;color:#1e293b;font-weight:600;">${data.caseId}</td></tr>` : ""}
      ${data.insuredName ? `<tr><td style="padding:8px 0;color:#64748b;">Insured Name</td><td style="padding:8px 0;color:#1e293b;">${data.insuredName}</td></tr>` : ""}
      ${data.indicatorCount !== undefined ? `<tr><td style="padding:8px 0;color:#64748b;">Fraud Indicators</td><td style="padding:8px 0;color:#dc2626;font-weight:600;">${data.indicatorCount} flagged</td></tr>` : ""}
      ${data.severity ? `<tr><td style="padding:8px 0;color:#64748b;">Risk Severity</td><td style="padding:8px 0;color:#dc2626;font-weight:600;">${data.severity}</td></tr>` : ""}
    </table>
    <div style="background-color:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin:16px 0;border-radius:4px;">
      <p style="margin:0;color:#991b1b;font-weight:600;">Priority: Immediate attention required</p>
    </div>
    ${data.trackingUrl ? `<p><a href="${data.trackingUrl}" style="display:inline-block;padding:12px 24px;background-color:#7c3aed;color:#ffffff;text-decoration:none;border-radius:6px;">View SIU Case</a></p>` : ""}`;

  return {
    subject: `SIU Referral: ${data.insuredName || data.submissionId || ""} - Immediate Attention Required`,
    html: wrapInLayout(body, branding),
  };
}

// ─── Template Dispatcher ───────────────────────────────────

const TEMPLATE_BUILDERS: Record<
  NotificationType,
  (data: NotificationData, branding: WhiteLabelBranding) => EmailContent
> = {
  SUBMISSION_RECEIVED: buildSubmissionReceived,
  SUBMISSION_APPROVED: buildSubmissionApproved,
  SUBMISSION_DECLINED: buildSubmissionDeclined,
  INFO_NEEDED: buildInfoNeeded,
  ESCALATION_NOTICE: buildEscalationNotice,
  NEW_SUBMISSION_FOR_REVIEW: buildNewSubmissionForReview,
  SIU_REFERRAL: buildSIUReferral,
};

// ─── Public API ────────────────────────────────────────────

export async function sendNotification(
  type: NotificationType,
  recipientEmail: string,
  tenantId: string,
  data: NotificationData = {}
): Promise<void> {
  try {
    const branding = await getBranding(tenantId);
    const builder = TEMPLATE_BUILDERS[type];
    const { subject, html } = builder(data, branding);
    const fromAddress = getFromAddress(branding);

    await sendEmail(recipientEmail, subject, html, fromAddress);
  } catch (error) {
    // Notification failures should not break the main workflow
    console.error(
      `Failed to send ${type} notification to ${recipientEmail}:`,
      error
    );
  }
}
