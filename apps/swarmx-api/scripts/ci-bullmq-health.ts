/**
 * CI gate — BullMQ + Redis integration smoke test.
 *
 * Verifies that BullMQ can connect to the Redis service, enqueue a sentinel
 * job, confirm it is waiting, then obliterate the CI queue before exiting.
 *
 * Run: pnpm exec tsx scripts/ci-bullmq-health.ts
 * Required env: REDIS_URL (defaults to redis://127.0.0.1:6379)
 */
import { Queue } from "bullmq";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "swarmx-ci-health";

const q = new Queue(QUEUE_NAME, {
  connection: { url: REDIS_URL },
  defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
});

try {
  await q.add("ping", { ts: Date.now() });

  const waiting = await q.getWaitingCount();
  if (waiting === 0) {
    throw new Error(
      `BullMQ enqueue did not persist to Redis — getWaitingCount() returned 0 after add()`,
    );
  }

  await q.obliterate({ force: true });
  console.log(
    `PASS: BullMQ queue enqueue/drain cycle completed (redis: ${REDIS_URL}, waiting before drain: ${waiting})`,
  );
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${String(err)}`);
  process.exit(1);
} finally {
  await q.close().catch(() => {});
}
