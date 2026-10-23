import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { GENERATE_QUEUE, type GenerateJobData } from "@nl/db";
import { failJob, processJob } from "./process";

const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
const concurrency = Number(process.env.GENERATION_CONCURRENCY || 3);

const worker = new Worker<GenerateJobData>(GENERATE_QUEUE, (job) => processJob(job.data.jobId), { connection, concurrency });

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`job ${job.data.jobId} attempt ${job.attemptsMade} failed: ${err.message}`);
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) await failJob(job.data.jobId, err.message);
});
worker.on("ready", () => console.log(`worker: listening on "${GENERATE_QUEUE}" (concurrency ${concurrency})`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    await connection.quit();
    process.exit(0);
  });
}
