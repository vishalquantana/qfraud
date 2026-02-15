import { Worker, type Job } from "bullmq";
import { createLogger } from "@/lib/logger";
import { processSubmission } from "@/services/pipeline";
import type { SubmissionJobData } from "@/lib/queue";

const log = createLogger("worker");

const QUEUE_NAME = "submission-processing";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/**
 * Creates a BullMQ worker that processes submission jobs.
 * The worker picks jobs from the queue and runs the full pipeline.
 */
export function createSubmissionWorker(concurrency = 3): Worker {
  const worker = new Worker<SubmissionJobData>(
    QUEUE_NAME,
    async (job: Job<SubmissionJobData>) => {
      const { submissionId } = job.data;
      await processSubmission(submissionId);
      await job.updateProgress(100);
      return { submissionId, processedAt: new Date().toISOString() };
    },
    {
      connection: {
        host: new URL(REDIS_URL).hostname || "localhost",
        port: parseInt(new URL(REDIS_URL).port || "6379", 10),
        maxRetriesPerRequest: null,
      },
      concurrency,
    }
  );

  worker.on("completed", (job) => {
    log.info(
      { jobId: job.id, submissionId: job.data.submissionId },
      "job completed"
    );
  });

  worker.on("failed", (job, err) => {
    log.error(
      { err, jobId: job?.id, submissionId: job?.data.submissionId },
      "job failed"
    );
  });

  return worker;
}
