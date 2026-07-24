import type { FastifyReply, FastifyRequest } from "fastify";
import { loadEnv, readSecretEnv } from "../lib/env.js";

function readVideoWriteToken(): string {
  return readSecretEnv("SWARMX_VIDEO_API_TOKEN");
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function isVideoAuthRequired(): boolean {
  return readVideoWriteToken().length > 0;
}

export async function requireVideoWriteAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isVideoAuthRequired()) {
    // In production with no token configured, fail closed — never allow open writes.
    // In development, allow through for local convenience.
    if (loadEnv().NODE_ENV === "production") {
      return reply.code(401).send({
        error: "unauthorized",
        message:
          "SWARMX_VIDEO_API_TOKEN is not configured. Video writes are blocked in production. Set the token to enable write access.",
      });
    }
    return;
  }

  const authHeader = request.headers.authorization;
  const bearerToken = Array.isArray(authHeader)
    ? readBearerToken(authHeader[0])
    : readBearerToken(authHeader);
  const apiKeyHeader = request.headers["x-video-api-key"];
  const apiKeyToken = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const candidate = bearerToken ?? apiKeyToken ?? "";
  const expectedToken = readVideoWriteToken();

  if (candidate !== expectedToken) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "Missing or invalid video write token",
    });
  }
}
