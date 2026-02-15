import { NextResponse } from "next/server";
import { withTenant } from "@/lib/rbac";
import { getJobStatus } from "@/lib/queue";

// ─── GET /api/jobs/:id ───────────────────────────────────
// Returns the status of a processing job

export const GET = withTenant(async (_ctx, params) => {
  const jobId = params?.id;

  if (!jobId) {
    return NextResponse.json(
      { error: "Job ID required" },
      { status: 400 }
    );
  }

  const status = await getJobStatus(jobId);

  if (!status) {
    return NextResponse.json(
      { error: "Job not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: status });
});
