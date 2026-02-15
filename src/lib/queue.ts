import { Queue } from "bullmq";

// ─── Queue Singleton ───────────────────────────────────────

const QUEUE_NAME = "submission-processing";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: {
        host: new URL(REDIS_URL).hostname || "localhost",
        port: parseInt(new URL(REDIS_URL).port || "6379", 10),
        maxRetriesPerRequest: null,
      },
    });
  }
  return queue;
}

/** Reset the queue singleton (for testing). */
export function resetQueue() {
  queue = null;
}

// ─── Job Types ─────────────────────────────────────────────

export interface SubmissionJobData {
  submissionId: string;
  tenantId: string;
}

export interface JobStatus {
  id: string;
  state: string;
  progress: number;
  failedReason: string | undefined;
  result: unknown;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

// ─── Public API ────────────────────────────────────────────

/**
 * Enqueue a submission for async processing.
 * Returns the created job (with id for status tracking).
 */
export async function enqueueSubmission(
  submissionId: string,
  tenantId: string
) {
  const q = getQueue();
  return q.add(
    "process-submission",
    { submissionId, tenantId } satisfies SubmissionJobData,
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    }
  );
}

/**
 * Get the status of a specific job by ID.
 */
export async function getJobStatus(
  jobId: string
): Promise<JobStatus | null> {
  const q = getQueue();
  const job = await q.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id!,
    state,
    progress: job.progress as number,
    failedReason: job.failedReason,
    result: job.returnvalue,
  };
}

/**
 * Get queue statistics (waiting, active, completed, failed, delayed).
 */
export async function getQueueStats(): Promise<QueueStats> {
  const q = getQueue();
  const counts = await q.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  );
  return counts as unknown as QueueStats;
}
