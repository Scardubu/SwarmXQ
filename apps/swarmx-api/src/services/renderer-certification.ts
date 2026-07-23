import type { CertificationTier, RendererCapabilityTier } from "@swarmx/types/video-types";
import { log } from "../lib/logger.js";

const SUCCESS_CHAIN_RANK: Partial<Record<CertificationTier, number>> = {
  TECHNICALLY_VALID: 1,
  CREATIVE_REVIEW_REQUIRED: 2,
  PRODUCTION_PACK_VALID: 3,
  READY_TO_POST: 4,
  PUBLISHING: 5,
  PUBLISHED_VERIFIED: 6,
};

const CERTIFICATION_CEILING: Record<RendererCapabilityTier, CertificationTier> = {
  ffmpeg_text_smoke: "TECHNICALLY_VALID",
  ffmpeg_kinetic_text: "PUBLISHED_VERIFIED",
  ffmpeg_faceless_broll: "PUBLISHED_VERIFIED",
  ffmpeg_cinematic_explainer: "PUBLISHED_VERIFIED",
  optional_adapter: "PRODUCTION_PACK_VALID",
};

export function getRendererCertificationCeiling(tier: RendererCapabilityTier): CertificationTier {
  return CERTIFICATION_CEILING[tier];
}

export function clampCertificationTier(
  desired: CertificationTier,
  tier: RendererCapabilityTier,
): CertificationTier {
  const desiredRank = SUCCESS_CHAIN_RANK[desired];
  if (desiredRank === undefined) return desired;
  const ceiling = CERTIFICATION_CEILING[tier];
  const ceilingRank = SUCCESS_CHAIN_RANK[ceiling] ?? 0;
  if (desiredRank <= ceilingRank) return desired;
  log.warn({
    code: "CERT_TIER_CLAMPED_BY_RENDERER",
    renderer: tier,
    requested: desired,
    clampedTo: ceiling,
  }, "certification tier clamped to renderer ceiling");
  return ceiling;
}

export function canPromoteTo(
  current: CertificationTier,
  target: CertificationTier,
  tier: RendererCapabilityTier,
): boolean {
  const currentRank = SUCCESS_CHAIN_RANK[current];
  const targetRank = SUCCESS_CHAIN_RANK[target];
  if (currentRank === undefined || targetRank === undefined) return false;
  if (targetRank <= currentRank) return false;
  const ceilingRank = SUCCESS_CHAIN_RANK[CERTIFICATION_CEILING[tier]] ?? 0;
  return targetRank <= ceilingRank;
}
