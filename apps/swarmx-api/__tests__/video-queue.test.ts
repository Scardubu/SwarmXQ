import { vi, describe, test, expect, beforeEach } from "vitest";
import type { VideoJobError } from "../src/types/video.js";

// Mock BullMQ before any import that pulls in video-queue (which imports Queue at module level)
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
    changePriority: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn(),
}));

import { resetEnvForTesting } from "../src/lib/env.js";
import {
  _resetRegistryForTesting,
  setBullMQRuntimeEnabled,
  enqueue,
  getJob,
  listJobs,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  dequeueNext,
  runningCount,
  queuedCount,
} from "../src/services/video-queue.js";

const nonRetryableError: VideoJobError = {
  code: "RENDER_FAILED",
  message: "render failed",
  retryable: false,
};
const retryableError: VideoJobError = {
  code: "TIMEOUT",
  message: "timed out",
  retryable: true,
};

beforeEach(() => {
  resetEnvForTesting();
  _resetRegistryForTesting();
  setBullMQRuntimeEnabled(false);
});

describe("enqueue", () => {
  test("creates job with status=queued and overallProgress=0", () => {
    const job = enqueue({ prompt: "make a video" });
    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.overallProgress).toBe(0);
    expect(job.retryCount).toBe(0);
    expect(job.request.prompt).toBe("make a video");
  });

  test("returns existing non-terminal job for same clientRequestId (idempotency)", () => {
    const req = { prompt: "test", clientRequestId: "req-abc" };
    const job1 = enqueue(req);
    const job2 = enqueue(req);
    expect(job2.id).toBe(job1.id);
  });

  test("creates new job after matching clientRequestId job reaches terminal state", () => {
    const req = { prompt: "test", clientRequestId: "req-xyz" };
    const job1 = enqueue(req);
    startJob(job1.id);
    completeJob(job1.id, undefined);
    // job1 is now completed (terminal) — next enqueue should create a new job
    const job2 = enqueue(req);
    expect(job2.id).not.toBe(job1.id);
    expect(job2.status).toBe("queued");
  });

  test("throws when the queue is full (MAX_QUEUE_SIZE active jobs)", () => {
    for (let i = 0; i < 20; i++) {
      enqueue({ prompt: `job ${i}` });
    }
    expect(() => enqueue({ prompt: "overflow" })).toThrow(/queue is full/i);
  });
});

describe("getJob", () => {
  test("returns the job by id", () => {
    const job = enqueue({ prompt: "find me" });
    expect(getJob(job.id)).toBe(job);
  });

  test("returns undefined for unknown id", () => {
    expect(getJob("non-existent-id")).toBeUndefined();
  });
});

describe("startJob", () => {
  test("transitions queued → running and sets startedAt", () => {
    const job = enqueue({ prompt: "run me" });
    const started = startJob(job.id);
    expect(started).not.toBeNull();
    expect(started?.status).toBe("running");
    expect(started?.startedAt).toBeDefined();
  });

  test("returns null when concurrency is saturated (SINGLE-VIDEO LOCK)", () => {
    const job1 = enqueue({ prompt: "first" });
    const job2 = enqueue({ prompt: "second" });
    startJob(job1.id); // running=1
    const result = startJob(job2.id); // running >= concurrency(1) → null
    expect(result).toBeNull();
    expect(getJob(job2.id)?.status).toBe("queued");
  });

  test("returns null for non-existent job id", () => {
    expect(startJob("no-such-id")).toBeNull();
  });
});

describe("completeJob", () => {
  test("transitions running → completed with overallProgress=100", () => {
    const job = enqueue({ prompt: "finish me" });
    startJob(job.id);
    const done = completeJob(job.id, undefined);
    expect(done.status).toBe("completed");
    expect(done.overallProgress).toBe(100);
    expect(done.completedAt).toBeDefined();
    expect(done.currentStage).toBeUndefined();
  });
});

describe("failJob", () => {
  test("non-retryable error transitions to failed and stores error", () => {
    const job = enqueue({ prompt: "fail me" });
    startJob(job.id);
    const failed = failJob(job.id, nonRetryableError);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("RENDER_FAILED");
  });

  test("retryable error when retryCount < MAX_RETRIES requeues the job", () => {
    const job = enqueue({ prompt: "retry me" });
    startJob(job.id);
    // retryCount=0, MAX_RETRIES=1 (default) → 0 < 1 → requeue
    const requeued = failJob(job.id, retryableError);
    expect(requeued.status).toBe("queued");
    expect(requeued.retryCount).toBe(1);
    expect(requeued.overallProgress).toBe(0);
  });
});

describe("cancelJob", () => {
  test("cancels a queued job and returns true", () => {
    const job = enqueue({ prompt: "cancel me" });
    expect(cancelJob(job.id)).toBe(true);
    expect(getJob(job.id)?.status).toBe("cancelled");
  });

  test("returns false for a job already in terminal state", () => {
    const job = enqueue({ prompt: "already done" });
    startJob(job.id);
    completeJob(job.id, undefined);
    expect(cancelJob(job.id)).toBe(false);
    expect(getJob(job.id)?.status).toBe("completed");
  });
});

describe("listJobs", () => {
  test("returns all jobs in the registry", () => {
    enqueue({ prompt: "a" });
    enqueue({ prompt: "b" });
    const { jobs, total } = listJobs();
    expect(total).toBe(2);
    expect(jobs).toHaveLength(2);
  });

  test("filters by status when provided", () => {
    const job1 = enqueue({ prompt: "a" });
    enqueue({ prompt: "b" });
    startJob(job1.id); // job1 → running
    const { jobs: queued, total } = listJobs({ status: "queued" });
    expect(total).toBe(1);
    expect(queued[0]?.status).toBe("queued");
  });
});

describe("runningCount and queuedCount", () => {
  test("track job counts correctly across state transitions", () => {
    expect(runningCount()).toBe(0);
    expect(queuedCount()).toBe(0);

    const job = enqueue({ prompt: "count me" });
    expect(queuedCount()).toBe(1);
    expect(runningCount()).toBe(0);

    startJob(job.id);
    expect(queuedCount()).toBe(0);
    expect(runningCount()).toBe(1);

    completeJob(job.id, undefined);
    expect(queuedCount()).toBe(0);
    expect(runningCount()).toBe(0);
  });
});

describe("dequeueNext", () => {
  test("returns the queued job when running=0", () => {
    const job = enqueue({ prompt: "dequeue me" });
    const next = dequeueNext();
    expect(next?.id).toBe(job.id);
  });

  test("returns undefined when queue is empty", () => {
    expect(dequeueNext()).toBeUndefined();
  });

  test("returns undefined when concurrency is saturated", () => {
    const job1 = enqueue({ prompt: "running" });
    enqueue({ prompt: "waiting" });
    startJob(job1.id); // running=1
    expect(dequeueNext()).toBeUndefined();
  });
});
