import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getQueueStats } from "@/lib/queue";

interface ServiceStatus {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

// ─── GET /api/health ─────────────────────────────────────
// Health check endpoint — no auth required

export async function GET() {
  const services: Record<string, ServiceStatus> = {};
  let overallHealthy = true;

  // Check database
  const dbStart = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    services.database = {
      status: "healthy",
      latencyMs: Date.now() - dbStart,
    };
  } catch (err) {
    overallHealthy = false;
    services.database = {
      status: "unhealthy",
      latencyMs: Date.now() - dbStart,
      error: err instanceof Error ? err.message : "Database unreachable",
    };
  }

  // Check BullMQ queue
  const queueStart = Date.now();
  try {
    const stats = await getQueueStats();
    services.queue = {
      status: "healthy",
      latencyMs: Date.now() - queueStart,
      details: stats as unknown as Record<string, unknown>,
    };
  } catch (err) {
    services.queue = {
      status: "degraded",
      latencyMs: Date.now() - queueStart,
      error: err instanceof Error ? err.message : "Queue unreachable",
    };
  }

  // Check S3 (basic env check)
  const s3Configured = !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_ACCESS_KEY_ID
  );
  services.storage = {
    status: s3Configured ? "healthy" : "degraded",
    details: { configured: s3Configured },
  };

  // Check Gemini API (env check)
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  services.gemini = {
    status: geminiConfigured ? "healthy" : "degraded",
    details: { configured: geminiConfigured },
  };

  // Check email provider
  const emailProvider = process.env.EMAIL_PROVIDER || "smtp";
  const emailConfigured =
    emailProvider === "sendgrid"
      ? !!process.env.SENDGRID_API_KEY
      : !!(process.env.SMTP_HOST || process.env.SMTP_USER);
  services.email = {
    status: emailConfigured ? "healthy" : "degraded",
    details: { provider: emailProvider, configured: emailConfigured },
  };

  const status = overallHealthy ? "healthy" : "unhealthy";

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "0.1.0",
      services,
    },
    { status: overallHealthy ? 200 : 503 }
  );
}
