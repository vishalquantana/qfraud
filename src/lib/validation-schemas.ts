import { z } from "zod/v4";

// ─── Shared Enums ──────────────────────────────────────

const VALID_ROLES = [
  "ADMIN",
  "SENIOR_UNDERWRITER",
  "UNDERWRITER",
  "SIU_INVESTIGATOR",
  "COMPLIANCE_OFFICER",
  "BROKER",
] as const;

const VALID_ACTIONS = ["approve", "decline", "request-info", "refer-to-siu"] as const;

const VALID_WEBHOOK_EVENTS = [
  "submission.processed",
  "submission.approved",
  "submission.declined",
  "submission.escalated",
  "fraud.flag_raised",
  "siu.case_created",
] as const;

// ─── Auth ──────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// ─── Submission Status Action ──────────────────────────

export const statusActionSchema = z.object({
  action: z.enum(VALID_ACTIONS),
  justification: z.string().optional(),
  infoNeededDetails: z.string().optional(),
});

// ─── Score Override ────────────────────────────────────

export const overrideScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  justification: z
    .string()
    .min(1)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Justification cannot be empty"),
});

// ─── Threshold Configuration ───────────────────────────

export const thresholdUpdateSchema = z.object({
  autoApproveBelow: z.number().min(0).max(100).optional(),
  autoEscalateAbove: z.number().min(0).max(100).optional(),
  siuReferralOnCritical: z.boolean().optional(),
});

// ─── API Key Management ────────────────────────────────

export const createApiKeySchema = z.object({
  name: z.string().min(1),
  permissions: z.array(z.string()).default([]),
});

// ─── User Management ───────────────────────────────────

export const createUserSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(VALID_ROLES),
});

export const updateUserSchema = z.object({
  role: z.enum(VALID_ROLES).optional(),
  isActive: z.boolean().optional(),
});

// ─── Pagination ────────────────────────────────────────

export const paginationSchema = z
  .object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(20),
  })
  .transform((data) => ({
    page: Math.max(1, data.page),
    limit: Math.min(100, Math.max(1, data.limit)),
  }));

// ─── Webhooks ──────────────────────────────────────────

export const createWebhookSchema = z.object({
  url: z.url(),
  events: z.array(z.enum(VALID_WEBHOOK_EVENTS)).min(1),
});

// ─── Type Exports ──────────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>;
export type StatusActionInput = z.infer<typeof statusActionSchema>;
export type OverrideScoreInput = z.infer<typeof overrideScoreSchema>;
export type ThresholdUpdateInput = z.infer<typeof thresholdUpdateSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
