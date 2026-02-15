import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProcessSubmission, workerOnHandlers, mockWorkerClose } = vi.hoisted(
  () => ({
    mockProcessSubmission: vi.fn().mockResolvedValue(undefined),
    workerOnHandlers: {} as Record<string, (...args: unknown[]) => void>,
    mockWorkerClose: vi.fn().mockResolvedValue(undefined),
  })
);

vi.mock("@/services/pipeline", () => ({
  processSubmission: mockProcessSubmission,
}));

let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null;

vi.mock("bullmq", () => {
  class MockQueue {
    add = vi.fn();
    close = vi.fn();
  }
  class MockWorker {
    close = mockWorkerClose;
    constructor(
      _name: string,
      processor: (job: unknown) => Promise<unknown>,
      _opts?: unknown
    ) {
      capturedProcessor = processor;
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      workerOnHandlers[event] = handler;
      return this;
    }
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

import { createSubmissionWorker } from "@/lib/worker";

describe("submission worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  it("creates a worker that processes submissions", () => {
    createSubmissionWorker();
    expect(capturedProcessor).toBeDefined();
  });

  it("calls processSubmission with the submissionId from job data", async () => {
    createSubmissionWorker();

    const mockJob = {
      data: { submissionId: "sub-123", tenantId: "tenant-001" },
      updateProgress: vi.fn(),
    };

    await capturedProcessor!(mockJob);

    expect(mockProcessSubmission).toHaveBeenCalledWith("sub-123");
  });

  it("updates progress to 100 after processing", async () => {
    createSubmissionWorker();

    const mockJob = {
      data: { submissionId: "sub-456", tenantId: "tenant-002" },
      updateProgress: vi.fn(),
    };

    await capturedProcessor!(mockJob);

    expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
  });

  it("registers completed and failed event handlers", () => {
    createSubmissionWorker();

    expect(workerOnHandlers["completed"]).toBeDefined();
    expect(workerOnHandlers["failed"]).toBeDefined();
  });

  it("propagates errors from processSubmission so BullMQ can retry", async () => {
    createSubmissionWorker();
    mockProcessSubmission.mockRejectedValueOnce(new Error("DB timeout"));

    const mockJob = {
      data: { submissionId: "sub-err", tenantId: "tenant-001" },
      updateProgress: vi.fn(),
    };

    await expect(capturedProcessor!(mockJob)).rejects.toThrow("DB timeout");
  });
});
