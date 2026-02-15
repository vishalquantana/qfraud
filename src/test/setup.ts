import { vi } from "vitest";

// Mock Prisma globally
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), upsert: vi.fn() },
    submission: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    document: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    fraudIndicator: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    thresholdConfig: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
    siuCase: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    sIUCase: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    apiKey: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    webhookSubscription: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    whiteLabelConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    complianceConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
