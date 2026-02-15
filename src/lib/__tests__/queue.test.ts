import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bullmq before imports
const mockAdd = vi.fn().mockResolvedValue({ id: "job-1", name: "process-submission" });
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockGetJob = vi.fn();
const mockGetJobCounts = vi.fn().mockResolvedValue({
  waiting: 0,
  active: 0,
  completed: 0,
  failed: 0,
  delayed: 0,
});

vi.mock("bullmq", () => {
  class MockQueue {
    add = mockAdd;
    close = mockClose;
    getJob = mockGetJob;
    getJobCounts = mockGetJobCounts;
    constructor() {}
  }
  class MockWorker {
    on = vi.fn();
    close = mockClose;
    constructor() {}
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

import {
  enqueueSubmission,
  getJobStatus,
  getQueueStats,
  resetQueue,
} from "@/lib/queue";

describe("submission queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueue();
  });

  describe("enqueueSubmission", () => {
    it("adds a job to the queue with correct data", async () => {
      const result = await enqueueSubmission("sub-123", "tenant-001");

      expect(mockAdd).toHaveBeenCalledWith(
        "process-submission",
        { submissionId: "sub-123", tenantId: "tenant-001" },
        expect.objectContaining({
          attempts: 3,
          backoff: expect.objectContaining({ type: "exponential" }),
          removeOnComplete: expect.any(Object),
          removeOnFail: expect.any(Object),
        })
      );
      expect(result).toEqual(
        expect.objectContaining({ id: "job-1" })
      );
    });

    it("returns the created job", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-42", name: "process-submission" });

      const result = await enqueueSubmission("sub-456", "tenant-002");

      expect(result.id).toBe("job-42");
    });
  });

  describe("getJobStatus", () => {
    it("returns job state and progress when job exists", async () => {
      mockGetJob.mockResolvedValueOnce({
        id: "job-1",
        getState: vi.fn().mockResolvedValue("active"),
        progress: 50,
        failedReason: undefined,
        returnvalue: undefined,
      });

      const status = await getJobStatus("job-1");

      expect(status).toEqual({
        id: "job-1",
        state: "active",
        progress: 50,
        failedReason: undefined,
        result: undefined,
      });
    });

    it("returns null when job does not exist", async () => {
      mockGetJob.mockResolvedValueOnce(null);

      const status = await getJobStatus("nonexistent");

      expect(status).toBeNull();
    });

    it("includes failedReason for failed jobs", async () => {
      mockGetJob.mockResolvedValueOnce({
        id: "job-fail",
        getState: vi.fn().mockResolvedValue("failed"),
        progress: 0,
        failedReason: "Database connection lost",
        returnvalue: undefined,
      });

      const status = await getJobStatus("job-fail");

      expect(status?.state).toBe("failed");
      expect(status?.failedReason).toBe("Database connection lost");
    });
  });

  describe("getQueueStats", () => {
    it("returns queue job counts", async () => {
      mockGetJobCounts.mockResolvedValueOnce({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      });

      const stats = await getQueueStats();

      expect(stats).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      });
    });
  });
});
