import type { FastifyReply, FastifyRequest } from "fastify";

const VIDEO_WRITE_TOKEN = process.env["SWARMX_VIDEO_API_TOKEN"]?.trim() ?? "";

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function isVideoAuthRequired(): boolean {
  return VIDEO_WRITE_TOKEN.length > 0;
}

export async function requireVideoWriteAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isVideoAuthRequired()) {
    return;
  }

  const authHeader = request.headers.authorization;
  const bearerToken = Array.isArray(authHeader)
    ? readBearerToken(authHeader[0])
    : readBearerToken(authHeader);
  const apiKeyHeader = request.headers["x-video-api-key"];
  const apiKeyToken = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const candidate = bearerToken ?? apiKeyToken ?? "";

  if (candidate !== VIDEO_WRITE_TOKEN) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "Missing or invalid video write token",
    });
  }
}
