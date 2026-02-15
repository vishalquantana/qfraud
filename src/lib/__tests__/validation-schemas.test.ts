import { describe, it, expect } from "vitest";
import { z } from "zod/v4";

import {
  loginSchema,
  statusActionSchema,
  overrideScoreSchema,
  thresholdUpdateSchema,
  createApiKeySchema,
  createUserSchema,
  updateUserSchema,
  paginationSchema,
  createWebhookSchema,
} from "@/lib/validation-schemas";

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------
describe("loginSchema", () => {
  it("accepts valid email and password", () => {
    const result = loginSchema.safeParse({ email: "user@test.com", password: "pass123" });
    expect(result.success).toBe(true);
  });

  it("rejects missing email", () => {
    const result = loginSchema.safeParse({ password: "pass123" });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "user@test.com" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "pass" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({ email: "user@test.com", password: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// statusActionSchema
// ---------------------------------------------------------------------------
describe("statusActionSchema", () => {
  it("accepts 'approve' without justification", () => {
    const result = statusActionSchema.safeParse({ action: "approve" });
    expect(result.success).toBe(true);
  });

  it("accepts 'decline' with justification", () => {
    const result = statusActionSchema.safeParse({
      action: "decline",
      justification: "Suspicious activity",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'request-info' with details", () => {
    const result = statusActionSchema.safeParse({
      action: "request-info",
      infoNeededDetails: "Need updated loss runs",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'refer-to-siu'", () => {
    const result = statusActionSchema.safeParse({ action: "refer-to-siu" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = statusActionSchema.safeParse({ action: "nuke" });
    expect(result.success).toBe(false);
  });

  it("rejects missing action", () => {
    const result = statusActionSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// overrideScoreSchema
// ---------------------------------------------------------------------------
describe("overrideScoreSchema", () => {
  it("accepts valid score and justification", () => {
    const result = overrideScoreSchema.safeParse({
      score: 50,
      justification: "Risk reassessment",
    });
    expect(result.success).toBe(true);
  });

  it("accepts score of 0", () => {
    const result = overrideScoreSchema.safeParse({
      score: 0,
      justification: "Clean submission",
    });
    expect(result.success).toBe(true);
  });

  it("accepts score of 100", () => {
    const result = overrideScoreSchema.safeParse({
      score: 100,
      justification: "Maximum risk",
    });
    expect(result.success).toBe(true);
  });

  it("rejects score below 0", () => {
    const result = overrideScoreSchema.safeParse({ score: -1, justification: "reason" });
    expect(result.success).toBe(false);
  });

  it("rejects score above 100", () => {
    const result = overrideScoreSchema.safeParse({ score: 101, justification: "reason" });
    expect(result.success).toBe(false);
  });

  it("rejects missing justification", () => {
    const result = overrideScoreSchema.safeParse({ score: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects empty justification", () => {
    const result = overrideScoreSchema.safeParse({ score: 50, justification: "  " });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric score", () => {
    const result = overrideScoreSchema.safeParse({ score: "fifty", justification: "reason" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// thresholdUpdateSchema
// ---------------------------------------------------------------------------
describe("thresholdUpdateSchema", () => {
  it("accepts valid threshold values", () => {
    const result = thresholdUpdateSchema.safeParse({
      autoApproveBelow: 20,
      autoEscalateAbove: 70,
      siuReferralOnCritical: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial updates", () => {
    const result = thresholdUpdateSchema.safeParse({ autoApproveBelow: 15 });
    expect(result.success).toBe(true);
  });

  it("rejects autoApproveBelow below 0", () => {
    const result = thresholdUpdateSchema.safeParse({ autoApproveBelow: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects autoApproveBelow above 100", () => {
    const result = thresholdUpdateSchema.safeParse({ autoApproveBelow: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects autoEscalateAbove below 0", () => {
    const result = thresholdUpdateSchema.safeParse({ autoEscalateAbove: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean siuReferralOnCritical", () => {
    const result = thresholdUpdateSchema.safeParse({ siuReferralOnCritical: "yes" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createApiKeySchema
// ---------------------------------------------------------------------------
describe("createApiKeySchema", () => {
  it("accepts valid name", () => {
    const result = createApiKeySchema.safeParse({ name: "Production Key" });
    expect(result.success).toBe(true);
  });

  it("accepts name with permissions array", () => {
    const result = createApiKeySchema.safeParse({
      name: "Limited Key",
      permissions: ["UNDERWRITER"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = createApiKeySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createApiKeySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("defaults permissions to empty array", () => {
    const result = createApiKeySchema.safeParse({ name: "Test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permissions).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// createUserSchema
// ---------------------------------------------------------------------------
describe("createUserSchema", () => {
  it("accepts valid user data", () => {
    const result = createUserSchema.safeParse({
      email: "new@acme.com",
      name: "New User",
      role: "UNDERWRITER",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = createUserSchema.safeParse({
      email: "not-email",
      name: "User",
      role: "ADMIN",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = createUserSchema.safeParse({
      email: "user@test.com",
      role: "ADMIN",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = createUserSchema.safeParse({
      email: "user@test.com",
      name: "User",
      role: "SUPER_ADMIN",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid roles", () => {
    const roles = [
      "ADMIN",
      "SENIOR_UNDERWRITER",
      "UNDERWRITER",
      "SIU_INVESTIGATOR",
      "COMPLIANCE_OFFICER",
      "BROKER",
    ];
    for (const role of roles) {
      const result = createUserSchema.safeParse({
        email: `${role.toLowerCase()}@test.com`,
        name: "Test",
        role,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// updateUserSchema
// ---------------------------------------------------------------------------
describe("updateUserSchema", () => {
  it("accepts role update", () => {
    const result = updateUserSchema.safeParse({ role: "ADMIN" });
    expect(result.success).toBe(true);
  });

  it("accepts isActive update", () => {
    const result = updateUserSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it("accepts both role and isActive", () => {
    const result = updateUserSchema.safeParse({ role: "UNDERWRITER", isActive: true });
    expect(result.success).toBe(true);
  });

  it("rejects invalid role", () => {
    const result = updateUserSchema.safeParse({ role: "INVALID" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paginationSchema
// ---------------------------------------------------------------------------
describe("paginationSchema", () => {
  it("parses valid page and limit", () => {
    const result = paginationSchema.safeParse({ page: "3", limit: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(25);
    }
  });

  it("defaults page to 1 and limit to 20", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("coerces string numbers", () => {
    const result = paginationSchema.safeParse({ page: "5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(5);
    }
  });

  it("clamps limit to max 100", () => {
    const result = paginationSchema.safeParse({ limit: "500" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it("clamps page to min 1", () => {
    const result = paginationSchema.safeParse({ page: "-5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// createWebhookSchema
// ---------------------------------------------------------------------------
describe("createWebhookSchema", () => {
  it("accepts valid URL and events", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/webhook",
      events: ["submission.processed"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = createWebhookSchema.safeParse({
      url: "not-a-url",
      events: ["submission.processed"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty events array", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/webhook",
      events: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing URL", () => {
    const result = createWebhookSchema.safeParse({
      events: ["submission.processed"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid event types", () => {
    const events = [
      "submission.processed",
      "submission.approved",
      "submission.declined",
      "submission.escalated",
      "fraud.flag_raised",
      "siu.case_created",
    ];
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/webhook",
      events,
    });
    expect(result.success).toBe(true);
  });
});
