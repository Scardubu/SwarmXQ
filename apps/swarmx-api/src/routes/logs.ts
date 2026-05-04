import type { FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const LOG_DIR = process.env["SWARMX_LOG_DIR"] ?? "/var/log/swarmx";

export async function logsRouter(server: FastifyInstance): Promise<void> {
  server.get("/files", async () => {
    try {
      const files = (await readdir(LOG_DIR)).filter((f) => f.endsWith(".log") || f.endsWith(".jsonl"));
      return files.map((f) => ({ name: f, path: path.join(LOG_DIR, f) }));
    } catch {
      return [];
    }
  });
}
