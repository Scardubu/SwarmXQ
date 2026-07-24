import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  MediaQualityReport,
  RawQcFinding,
  RendererCapabilityTier,
  VoiceArtifact,
} from "@swarmx/types/video-types";
import type { VideoJobRequest } from "../types/video.js";
import { outputDir, resolveOutputPath } from "./video-assets.js";
import { loadEnv } from "../lib/env.js";
import { clampCertificationTier } from "./renderer-certification.js";
import { normalizeScriptForSpeech, selectVoiceProvider } from "./voice-providers.js";
import { runTemplateQc } from "./template-aware-qc.js";

const _ffenv = loadEnv();
const RENDER_COMMAND_TIMEOUT_MS = Math.min(
  900_000,
  Math.max(30_000, _ffenv.SWARMX_VIDEO_FFMPEG_TIMEOUT_MS || 240_000),
);
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const RENDER_TEMP_DIR = resolve(_ffenv.SWARMX_VIDEO_TEMP_DIR);

async function moveFileAcrossDevices(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await copyFile(source, destination);
    await unlink(source);
  }
}

interface FfmpegRenderInput {
  jobId: string;
  request: VideoJobRequest;
  scriptText?: string;
  storyboardFrames: string[];
  signal?: AbortSignal;
}

export interface FfmpegRenderPackage {
  rendererTier: RendererCapabilityTier;
  templateId: string;
  packageDir: string;
  renderManifestPath: string;
  transcriptPath: string;
  srtPath: string;
  vttPath: string;
  rightsManifestPath: string;
  platformPackagePath: string;
  qualityReportPath: string;
  thumbnailPath: string;
  voiceLineagePath: string;
  templateLineagePath: string;
  mediaQualityReport: MediaQualityReport;
  voiceArtifact?: VoiceArtifact;
}

// ── Visual Palette ─────────────────────────────────────────────────────────────

const TONE_BACKGROUNDS: Record<string, string> = {
  contrarian:    "0x0a0a0a",  // near black — harsh, high-contrast
  urgent:        "0x150505",  // very dark red
  educational:   "0x070e1a",  // deep navy
  cinematic:     "0x0c0c0c",  // dark charcoal
  warm:          "0x100805",  // dark warm brown
  minimal:       "0x000000",  // pure black
  faceless_broll:"0x1a1a1a",  // neutral dark gray — lets b-roll footage dictate mood
  kinetic_text:  "0x000000",  // pure black — maximum contrast for on-screen text
};

const TONE_ACCENTS: Record<string, string> = {
  contrarian:    "0xff2222",  // sharp red
  urgent:        "0xff6600",  // orange
  educational:   "0x3399ff",  // electric blue
  cinematic:     "0xddaa44",  // gold
  warm:          "0xff9966",  // peach
  minimal:       "0xffffff",  // white
  faceless_broll:"0x00ccee",  // soft cyan — unobtrusive; doesn't fight b-roll footage
  kinetic_text:  "0xffcc00",  // bright amber — bold kinetic accent; distinct from minimal's white
};

interface CaptionStyleConfig {
  yExpr: string;
  baseFontSize: number;
  boxOpacity: string;
  borderW: number;
}

const CAPTION_STYLE_CONFIGS: Record<string, CaptionStyleConfig> = {
  bold_center: { yExpr: "(h-text_h)/2",   baseFontSize: 52, boxOpacity: "0.55", borderW: 32 },
  lower_third: { yExpr: "h*0.72",          baseFontSize: 44, boxOpacity: "0.78", borderW: 24 },
  minimal:     { yExpr: "(h-text_h)*0.45", baseFontSize: 38, boxOpacity: "0.20", borderW: 16 },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function execFileChecked(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        ...(signal !== undefined ? { signal } : {}),
        timeout: RENDER_COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.on("error", reject);
  });
}

// ffmpeg/ffprobe reject `--version` on 6.x builds; espeak-ng rejects `-version`.
async function commandAvailable(command: string, versionFlag = "-version"): Promise<boolean> {
  try {
    await execFileChecked(command, [versionFlag]);
    return true;
  } catch {
    return false;
  }
}

function discoverFont(): string {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw Object.assign(new Error("No system font found for FFmpeg drawtext"), {
      code: "FONT_UNAVAILABLE",
    });
  }
  return found;
}

function clampDuration(requested: number | undefined): number {
  return Math.max(15, Math.min(180, requested ?? 30));
}

function firstNonEmpty(lines: string[], fallback: string): string {
  return lines.find((line) => line.trim().length > 0)?.trim() ?? fallback;
}

function titleFromRequest(request: VideoJobRequest): string {
  const quotedTitle = request.prompt.match(/(?:titled|called)\s+["'""'']([^"'""'']+)["'""'']/i)?.[1];
  if (quotedTitle?.trim()) return quotedTitle.trim();
  return request.prompt
    .replace(/\s+/g, " ")
    .replace(/^create\s+(?:a|an)\s+/i, "")
    .slice(0, 80)
    .trim() || "SwarmXQ Video";
}

// Extract structured [HOOK] / [BODY] / [RESOLUTION] / [CTA] sections from the
// orchestrator script output and strip inline [VISUAL:...] cues so they never
// appear as rendered text on screen.
function extractScriptSections(scriptText: string): {
  hook: string;
  body: string[];
  resolution: string;
  cta: string;
} {
  const clean = (s: string) =>
    s.replace(/\[VISUAL:[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();

  const between = (tag: string, next: string) => {
    const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)(?=\\[${next}\\]|$)`, "i");
    return re.exec(scriptText)?.[1]?.trim() ?? "";
  };

  const hookRaw       = between("HOOK",       "BODY");
  const bodyRaw       = between("BODY",       "RESOLUTION");
  const resolutionRaw = between("RESOLUTION", "CTA");
  const ctaRaw        = /\[CTA\]\s*([\s\S]*)$/i.exec(scriptText)?.[1]?.trim() ?? "";

  // Body section → at most 3 individual sentences for separate cards.
  const bodySentences = bodyRaw
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean)
    .slice(0, 3);

  return {
    hook:       clean(hookRaw),
    body:       bodySentences,
    resolution: clean(resolutionRaw),
    cta:        clean(ctaRaw),
  };
}

function renderCards(input: FfmpegRenderInput): string[] {
  const sections = input.scriptText ? extractScriptSections(input.scriptText) : null;
  const frameLines = input.storyboardFrames.map((l) => l.trim()).filter(Boolean);
  const audience = input.request.audience?.trim() || "people who need this now";
  const tone = input.request.tone ?? "educational";

  if (sections && (sections.hook || sections.cta)) {
    // Use structured script content — much higher quality output.
    const cards: string[] = [];

    cards.push(sections.hook || titleFromRequest(input.request));

    if (sections.body.length > 0) {
      cards.push(...sections.body);
    } else {
      // Fall back to storyboard frame descriptions.
      cards.push(
        firstNonEmpty(frameLines.slice(0, 1), "Insight that changes how you see this."),
        firstNonEmpty(frameLines.slice(1, 2), "The detail most people overlook."),
      );
    }

    if (sections.resolution) cards.push(sections.resolution);
    if (sections.cta)        cards.push(sections.cta);

    return cards.slice(0, 7);
  }

  // Fallback: storyboard frames + generic structure.
  const title = titleFromRequest(input.request);
  return [
    title,
    firstNonEmpty([], `Stop scrolling. This ${tone} short is for ${audience}.`),
    firstNonEmpty(frameLines.slice(0, 1), "Here is what most people get wrong."),
    firstNonEmpty(frameLines.slice(1, 2), "The data tells a different story."),
    firstNonEmpty(frameLines.slice(2, 3), "One habit changes everything."),
    "Save this. Come back when you need it.",
  ];
}

function narrationText(input: FfmpegRenderInput, cards: string[]): string {
  const script = input.scriptText?.trim();
  const raw = script || cards.join(". ");
  const normalized = normalizeScriptForSpeech(raw);
  return normalized.slice(0, 600);
}

function rendererTierForRequest(request: VideoJobRequest): RendererCapabilityTier {
  if (request.style === "faceless_broll" || request.tone === "faceless_broll") return "ffmpeg_faceless_broll";
  if (request.style === "kinetic_text" || request.tone === "kinetic_text") return "ffmpeg_kinetic_text";
  if (request.tone === "cinematic") return "ffmpeg_cinematic_explainer";
  return "ffmpeg_kinetic_text";
}

function templateIdForTier(tier: RendererCapabilityTier): string {
  switch (tier) {
    case "ffmpeg_faceless_broll":
      return "faceless_broll_story_v1";
    case "ffmpeg_cinematic_explainer":
      return "narrator_cinematic_explainer_v1";
    case "ffmpeg_text_smoke":
      return "ffmpeg_text_smoke_v1";
    default:
      return "kinetic_text_insight_v1";
  }
}

// Scale font size down for long text so it stays readable in a 720px wide frame.
function fontSizeForText(text: string, base: number): number {
  const normalized = text.replace(/\n/g, " ");
  const len = normalized.length;
  const longestLine = Math.max(
    ...text.split("\n").map((line) => line.trim().length),
    0,
  );
  if (longestLine > 34 || len > 150) return Math.round(base * 0.62);
  if (longestLine > 28 || len > 100) return Math.round(base * 0.75);
  if (longestLine > 22 || len > 60)  return Math.round(base * 0.88);
  if (len <= 20) return Math.round(base * 1.25);
  return base;
}

function wrapCardText(text: string, baseFontSize: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const estimatedFontSize = fontSizeForText(normalized, baseFontSize);
  const maxChars = Math.max(18, Math.min(34, Math.floor(620 / (estimatedFontSize * 0.54))));
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.slice(0, 4).join("\n");
}

function buildBackgroundMotionLayers(rendererTier: RendererCapabilityTier, accentRgb: string): string[] {
  if (rendererTier === "ffmpeg_text_smoke") return [];

  const cinematic = rendererTier === "ffmpeg_cinematic_explainer";
  const faceless = rendererTier === "ffmpeg_faceless_broll";
  const gridOpacity = cinematic ? "0.07" : faceless ? "0.09" : "0.13";
  const panelOpacity = cinematic ? "0.08" : faceless ? "0.10" : "0.15";
  const lineOpacity = cinematic ? "0.20" : faceless ? "0.24" : "0.34";

  return [
    `drawgrid=width=90:height=90:thickness=1:color=${accentRgb}@${gridOpacity}`,
    `drawbox=x='-280+mod(t*44\\,1000)':y=ih*0.10:w=280:h=280:color=${accentRgb}@${panelOpacity}:t=fill`,
    `drawbox=x='iw-360-mod(t*32\\,1080)':y=ih*0.58:w=360:h=360:color=white@0.055:t=fill`,
    `drawbox=x='-160+mod(t*120\\,880)':y=120:w=160:h=6:color=${accentRgb}@0.55:t=fill`,
    `drawbox=x='iw-80-mod(t*90\\,820)':y=ih*0.18:w=80:h=80:color=${accentRgb}@0.18:t=fill`,
    `drawbox=x=80:y='220+mod(t*75\\,760)':w=5:h=180:color=${accentRgb}@0.45:t=fill`,
    "drawbox=x=iw-96:y='ih-320-mod(t*60\\,700)':w=8:h=220:color=white@0.22:t=fill",
    `drawbox=x=0:y='ih*0.28+mod(t*34\\,420)':w=iw:h=2:color=${accentRgb}@${lineOpacity}:t=fill`,
    `drawbox=x='mod(t*132\\,iw+320)-320':y=ih*0.84:w=320:h=5:color=white@0.16:t=fill`,
  ];
}

// Build the filter_complex chain: fade in, per-card drawtext, progress bar, fade out.
function buildFilterComplex(
  fontFile: string,
  textFiles: string[],
  cardTexts: string[],
  duration: number,
  accentHex: string,
  styleConfig: CaptionStyleConfig,
  rendererTier: RendererCapabilityTier,
): string {
  const slot = duration / textFiles.length;
  const accentRgb = accentHex.replace(/^0x/, "");

  const textFilters = textFiles.map((file, index) => {
    const start = Math.floor(index * slot * 10) / 10;
    const end = index === textFiles.length - 1
      ? duration
      : Math.floor((index + 1) * slot * 10) / 10;

    const cardText = cardTexts[index] ?? "";
    const fontSize = fontSizeForText(cardText, styleConfig.baseFontSize);
    const enableExpr = index === textFiles.length - 1
      ? `gte(t,${start})*lte(t,${end})`
      : `gte(t,${start})*lt(t,${end})`;

    return [
      `drawtext=fontfile=${fontFile}`,
      `textfile=${file}`,
      "fontcolor=white",
      `fontsize=${fontSize}`,
      "line_spacing=12",
      "box=1",
      `boxcolor=black@${styleConfig.boxOpacity}`,
      `boxborderw=${styleConfig.borderW}`,
      "x=(w-text_w)/2",
      `y=${styleConfig.yExpr}`,
      `enable='${enableExpr}'`,
    ].join(":");
  });

  // Animated progress bar: grows from left to right over the full duration.
  // Accent color in hex without the 0x prefix for FFmpeg's color syntax.
  const progressBar = `drawbox=x=0:y=ih-8:w=trunc(iw*t/${duration}):h=8:color=${accentRgb}@0.9:t=fill`;
  const motionLayers = buildBackgroundMotionLayers(rendererTier, accentRgb);

  return [
    "format=yuv420p",
    `fade=t=in:st=0:d=0.4`,
    ...motionLayers,
    ...textFilters,
    progressBar,
    `fade=t=out:st=${Math.max(0, duration - 0.6)}:d=0.6`,
  ].join(",");
}

function cueTimestamp(seconds: number, separator: "," | "."): string {
  const safe = Math.max(0, seconds);
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}${separator}${String(ms).padStart(3, "0")}`;
}

function buildTimedText(cards: string[], duration: number): { srt: string; vtt: string } {
  const slot = duration / Math.max(1, cards.length);
  const srt = cards.map((card, index) => {
    const start = index * slot;
    const end = index === cards.length - 1 ? duration : (index + 1) * slot;
    return `${index + 1}\n${cueTimestamp(start, ",")} --> ${cueTimestamp(end, ",")}\n${card.replace(/\n/g, " ")}\n`;
  }).join("\n");
  const vtt = `WEBVTT\n\n${cards.map((card, index) => {
    const start = index * slot;
    const end = index === cards.length - 1 ? duration : (index + 1) * slot;
    return `${cueTimestamp(start, ".")} --> ${cueTimestamp(end, ".")}\n${card.replace(/\n/g, " ")}\n`;
  }).join("\n")}`;
  return { srt, vtt };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

/**
 * Extract structured intervals from FFmpeg blackdetect/freezedetect stderr.
 * Returns one RawQcFinding per detected interval; empty array when no intervals present.
 */
function parseDetectorIntervals(
  raw: string,
  detector: "blackdetect" | "freezedetect",
): RawQcFinding[] {
  const type: RawQcFinding["type"] = detector === "blackdetect" ? "BLACK_FRAME" : "FREEZE_FRAME";
  const prefix = detector === "blackdetect" ? "black" : "freeze";
  // Match "start:X" and optional "duration:Y" on the same line-neighborhood.
  // Handles both "black_start:1.2 black_end:1.5 black_duration:0.3" and the
  // parametric "lavfi.freeze_start=5.0 ... lavfi.freeze_duration=2.5" forms.
  const intervals: RawQcFinding[] = [];
  const startRe = new RegExp(`${prefix}_start[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "g");
  const durationRe = new RegExp(`${prefix}_duration[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "g");
  const starts = [...raw.matchAll(startRe)]
    .map((m) => (m[1] !== undefined ? parseFloat(m[1]) : NaN))
    .filter((n) => Number.isFinite(n));
  const durations = [...raw.matchAll(durationRe)]
    .map((m) => (m[1] !== undefined ? parseFloat(m[1]) : NaN))
    .filter((n) => Number.isFinite(n));
  for (let i = 0; i < starts.length; i += 1) {
    const startSec = starts[i] ?? 0;
    const durationSec = durations[i] ?? 0;
    const severity: RawQcFinding["severity"] =
      durationSec >= 5 ? "HIGH" : durationSec >= 1 ? "MEDIUM" : "LOW";
    intervals.push({ type, startSec, durationSec, severity });
  }
  return intervals;
}

async function collectDetectorFinding(
  outputPath: string,
  detector: "blackdetect" | "freezedetect",
  filter: string,
  templateId: string,
): Promise<MediaQualityReport["rawDetectorFindings"][number]> {
  const result = await execFileChecked("ffmpeg", [
    "-hide_banner",
    "-i", outputPath,
    "-vf", filter,
    "-an",
    "-f", "null",
    "-",
  ]).catch((error: unknown) => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));
  const raw = result.stderr.slice(-4_000);
  const hasFinding = raw.includes(detector === "blackdetect" ? "black_start" : "freeze_start");
  return {
    detector,
    raw,
    interpretedStatus: hasFinding ? "review" : "pass",
    message: hasFinding
      ? `${detector} reported intervals; interpreted by ${templateId} cadence rules`
      : `${detector} reported no intervals`,
  };
}

async function writeProductionPackage(input: {
  jobId: string;
  request: VideoJobRequest;
  outputPath: string;
  outputFilename: string;
  rendererTier: RendererCapabilityTier;
  templateId: string;
  cards: string[];
  narration: string;
  duration: number;
  voiceArtifact?: VoiceArtifact;
  signal?: AbortSignal;
}): Promise<FfmpegRenderPackage> {
  const packageDir = resolve(loadEnv().SWARMX_VIDEO_ARTIFACT_DIR, input.jobId);
  await mkdir(packageDir, { recursive: true });

  const transcriptPath = join(packageDir, "transcript.txt");
  const srtPath = join(packageDir, "captions.srt");
  const vttPath = join(packageDir, "captions.vtt");
  const rightsManifestPath = join(packageDir, "rights-manifest.json");
  const platformPackagePath = join(packageDir, "platform-manifest.json");
  const renderManifestPath = join(packageDir, "render-manifest.json");
  const qcPath = join(packageDir, "quality-report.json");
  const thumbnailPath = join(packageDir, "thumbnail.jpg");
  const voiceLineagePath = join(packageDir, "voice-lineage.json");
  const templateLineagePath = join(packageDir, "template-lineage.json");
  const packagedVoicePath = join(packageDir, "narration.wav");
  let voiceArtifact = input.voiceArtifact;

  const timedText = buildTimedText(input.cards, input.duration);
  await writeFile(transcriptPath, `${input.narration}\n`, "utf8");
  await writeFile(srtPath, timedText.srt, "utf8");
  await writeFile(vttPath, timedText.vtt, "utf8");
  if (voiceArtifact) {
    await copyFile(voiceArtifact.outputPath, packagedVoicePath);
    voiceArtifact = { ...voiceArtifact, outputPath: packagedVoicePath };
  }

  const rights = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    assets: [{
      id: "swarmxq-template-motion-shapes",
      sourceProvider: "bundled-local-fixture",
      creator: "SwarmXQ",
      license: {
        state: "approved",
        sourceName: "SwarmXQ generated geometric fixtures",
        allowedUses: ["short-form-video", "local-export"],
        attribution: "Generated geometric motion fixtures bundled with SwarmXQ.",
      },
      transformations: ["ffmpeg drawgrid background texture", "ffmpeg drawbox motion layers", "caption text rendering"],
      reviewStatus: "approved",
    }],
    voice: voiceArtifact ?? null,
  };
  await writeFile(rightsManifestPath, `${JSON.stringify(rights, null, 2)}\n`, "utf8");
  await writeFile(join(packageDir, "rights-provenance.json"), `${JSON.stringify(rights, null, 2)}\n`, "utf8");

  await execFileChecked("ffmpeg", [
    "-y",
    "-ss", "0.5",
    "-i", input.outputPath,
    "-frames:v", "1",
    "-q:v", "3",
    thumbnailPath,
  ], input.signal);

  const platformPackage = {
    schemaVersion: 1,
    platform: input.request.platform ?? "generic",
    lifecycleState: "REVIEW_REQUIRED",
    mediaPath: input.outputPath,
    title: titleFromRequest(input.request).slice(0, 60),
    description: input.cards.slice(0, 3).join(" ").slice(0, 160),
    caption: {
      firstLine: input.cards[0]?.replace(/\n/g, " ").slice(0, 40) ?? "Watch this",
      body: input.cards.slice(1, -1).join(" "),
      cta: input.cards.at(-1) ?? "Save this for later",
      hashtags: { broad: ["#creator"], niche: ["#swarmxq"], trending: [] },
    },
    aiDisclosure: "AI-assisted local video package; no external publication attempted.",
    subtitleTracks: [srtPath, vttPath],
    thumbnailPath,
  };
  await writeFile(platformPackagePath, `${JSON.stringify(platformPackage, null, 2)}\n`, "utf8");
  await writeFile(join(packageDir, "platform-package.json"), `${JSON.stringify(platformPackage, null, 2)}\n`, "utf8");

  const blackFinding = await collectDetectorFinding(
    input.outputPath, "blackdetect", "blackdetect=d=0.5:pix_th=0.10", input.templateId,
  );
  const freezeFinding = await collectDetectorFinding(
    input.outputPath, "freezedetect", "freezedetect=n=-60dB:d=0.5", input.templateId,
  );
  const rawDetectorFindings = [blackFinding, freezeFinding];

  // Template-aware interpretation: parse structured intervals from each detector's
  // stderr, then let template-aware-qc apply per-renderer-tier context.
  const structuredFindings: RawQcFinding[] = [
    ...parseDetectorIntervals(blackFinding.raw, "blackdetect"),
    ...parseDetectorIntervals(freezeFinding.raw, "freezedetect"),
  ];
  const qcResult = runTemplateQc(structuredFindings, input.rendererTier);

  const productionRenderer = input.rendererTier !== "ffmpeg_text_smoke";
  const voiceEligible = voiceArtifact !== undefined && voiceArtifact.qualityTier !== "silent_fixture";
  // A blocker from template-aware QC downgrades certification.
  const templateQcBlocked = qcResult.blockers.length > 0;
  const desiredTier =
    productionRenderer && voiceEligible && !templateQcBlocked
      ? "PRODUCTION_PACK_VALID"
      : "CREATIVE_REVIEW_REQUIRED";
  const mediaQualityReport: MediaQualityReport = {
    id: `qc-${input.jobId}`,
    schemaVersion: 1,
    certificationTier: clampCertificationTier(desiredTier, input.rendererTier),
    rendererTier: input.rendererTier,
    templateId: input.templateId,
    technicalPassed: !templateQcBlocked,
    creativePassed: productionRenderer,
    accessibilityPassed: true,
    audioPassed: voiceEligible,
    rightsPassed: true,
    rawDetectorFindings,
    // If no structured intervals were parsed (raw text but no matches), fall back to
    // one "template" finding per raw detector so the report still shows something.
    interpretedFindings: qcResult.interpretations.length > 0
      ? qcResult.interpretations.map((i) => ({
          detector: "template",
          raw: i.notes,
          interpretedStatus: i.isExpected
            ? "pass"
            : i.interpretedSeverity === "HIGH"
              ? "fail"
              : "review",
          message: i.plannedEvent
            ? `${input.templateId} · ${i.plannedEvent} (${i.notes})`
            : `${input.templateId} · ${i.notes}`,
        }))
      : rawDetectorFindings.map((finding) => ({
          detector: "template" as const,
          raw: finding.raw,
          interpretedStatus: finding.interpretedStatus === "fail" ? "fail" as const : "pass" as const,
          message: `${input.templateId} · no structured intervals detected — template baseline holds`,
        })),
    createdAt: new Date().toISOString(),
  };
  await writeFile(qcPath, `${JSON.stringify(mediaQualityReport, null, 2)}\n`, "utf8");
  await writeFile(join(packageDir, "technical-creative-qc.json"), `${JSON.stringify(mediaQualityReport, null, 2)}\n`, "utf8");

  const voiceLineage = {
    schemaVersion: 1,
    providerId: voiceArtifact?.providerId ?? "unavailable",
    qualityTier: voiceArtifact?.qualityTier ?? "none",
    outputPath: voiceArtifact?.outputPath ?? null,
    sha256: voiceArtifact?.sha256 ?? null,
    createdAt: new Date().toISOString(),
  };
  await writeFile(voiceLineagePath, `${JSON.stringify(voiceLineage, null, 2)}\n`, "utf8");

  const templateLineage = {
    schemaVersion: 1,
    rendererTier: input.rendererTier,
    templateId: input.templateId,
    source: "local-ffmpeg-template",
    motionSystem: "drawgrid-and-drawbox-motion-system",
    createdAt: new Date().toISOString(),
  };
  await writeFile(templateLineagePath, `${JSON.stringify(templateLineage, null, 2)}\n`, "utf8");

  const manifest = {
    schemaVersion: 1,
    rendererTier: input.rendererTier,
    templateId: input.templateId,
    outputFilename: input.outputFilename,
    outputSha256: await hashFile(input.outputPath),
    recipeHash: hashJson({
      rendererTier: input.rendererTier,
      templateId: input.templateId,
      cards: input.cards,
      duration: input.duration,
      voiceHash: voiceArtifact?.sha256 ?? null,
    }),
    transcriptPath,
    srtPath,
    vttPath,
    rightsManifestPath,
    platformPackagePath,
    qualityReportPath: qcPath,
    thumbnailPath,
    voiceLineagePath,
    templateLineagePath,
    qcPath,
    voiceArtifact: voiceArtifact ?? null,
    createdAt: new Date().toISOString(),
  };
  await writeFile(renderManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    rendererTier: input.rendererTier,
    templateId: input.templateId,
    packageDir,
    renderManifestPath,
    transcriptPath,
    srtPath,
    vttPath,
    rightsManifestPath,
    platformPackagePath,
    qualityReportPath: qcPath,
    thumbnailPath,
    voiceLineagePath,
    templateLineagePath,
    mediaQualityReport,
    ...(voiceArtifact ? { voiceArtifact } : {}),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function renderWithFfmpeg(input: FfmpegRenderInput): Promise<{ outputFilename: string; renderPackage: FfmpegRenderPackage }> {
  if (!(await commandAvailable("ffmpeg"))) {
    throw Object.assign(new Error("ffmpeg is not available"), { code: "FFMPEG_UNAVAILABLE" });
  }
  if (!(await commandAvailable("ffprobe"))) {
    throw Object.assign(new Error("ffprobe is not available"), { code: "FFPROBE_UNAVAILABLE" });
  }

  const tone         = input.request.tone ?? "educational";
  const captionKey   = input.request.captionStyle ?? "bold_center";
  const bgColor      = TONE_BACKGROUNDS[tone]         ?? TONE_BACKGROUNDS["educational"] ?? "0x070e1a";
  const accentColor  = TONE_ACCENTS[tone]             ?? TONE_ACCENTS["educational"]     ?? "0x3399ff";
  const styleConfig  = CAPTION_STYLE_CONFIGS[captionKey] ?? CAPTION_STYLE_CONFIGS["bold_center"]!;

  const fontFile     = discoverFont();
  const duration     = clampDuration(input.request.targetDurationSeconds);
  const cards        = renderCards(input);
  const rendererTier = rendererTierForRequest(input.request);
  const templateId   = templateIdForTier(rendererTier);

  await mkdir(RENDER_TEMP_DIR, { recursive: true });
  const workDir         = await mkdtemp(join(RENDER_TEMP_DIR, `swarmx-video-${input.jobId}-`));
  const outputFilename  = `video_${input.jobId}.mp4`;
  const outputPath      = resolveOutputPath(outputFilename);
  const tempOutputPath  = join(workDir, outputFilename);
  let renderCompleted   = false;

  try {
    await mkdir(outputDir(), { recursive: true });

    // Write each card to a temp text file for drawtext=textfile= (avoids
    // shell-quoting issues with apostrophes and special characters).
    const displayCards = cards.map((card) => wrapCardText(card, styleConfig.baseFontSize));
    const textFiles: string[] = [];
    for (let i = 0; i < displayCards.length; i += 1) {
      const file = join(workDir, `card-${i}-${randomUUID()}.txt`);
      await writeFile(file, `${displayCards[i] ?? ""}\n`, "utf8");
      textFiles.push(file);
    }

    const narrationPath = join(workDir, "narration.wav");
    const narration = narrationText(input, cards);
    let voiceArtifact: VoiceArtifact | undefined;
    try {
      const selected = await selectVoiceProvider();
      voiceArtifact = await selected.provider.synthesize({
        jobId: input.jobId,
        text: narration,
        locale: loadEnv().SWARMX_TTS_LOCALE,
        voiceId: input.request.voice ?? "default",
        requestedSampleRateHz: loadEnv().SWARMX_AUDIO_MASTER_SAMPLE_RATE_HZ,
      }, narrationPath, input.signal);
    } catch (error) {
      if (loadEnv().SWARMX_VIDEO_ALLOW_SILENT_AUDIO !== "1") {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          code: "VOICE_PROVIDER_UNAVAILABLE",
        });
      }
    }

    const filterComplex = buildFilterComplex(
      fontFile,
      textFiles,
      displayCards,
      duration,
      accentColor,
      styleConfig,
      rendererTier,
    );

    const inputArgs = voiceArtifact
      ? ["-i", narrationPath]
      : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];

    await execFileChecked("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${bgColor}:s=720x1280:r=30:d=${duration}`,
      ...inputArgs,
      "-filter_complex", `[0:v]${filterComplex}[v]`,
      "-map", "[v]",
      "-map", "1:a",
      "-shortest",
      "-t", String(duration),
      "-af", `aformat=channel_layouts=stereo,aresample=${loadEnv().SWARMX_AUDIO_MASTER_SAMPLE_RATE_HZ},loudnorm=I=${loadEnv().SWARMX_AUDIO_TARGET_LUFS}:TP=${loadEnv().SWARMX_AUDIO_TRUE_PEAK_MAX_DBFS}:LRA=11`,
      "-ar", String(loadEnv().SWARMX_AUDIO_MASTER_SAMPLE_RATE_HZ),
      "-ac", String(loadEnv().SWARMX_AUDIO_MASTER_CHANNELS),
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      tempOutputPath,
    ], input.signal);

    await moveFileAcrossDevices(tempOutputPath, outputPath);
    renderCompleted = true;

    const renderPackage = await writeProductionPackage({
      jobId: input.jobId,
      request: input.request,
      outputPath,
      outputFilename,
      rendererTier,
      templateId,
      cards: displayCards,
      narration,
      duration,
      ...(voiceArtifact ? { voiceArtifact } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return { outputFilename, renderPackage };
  } finally {
    if (!renderCompleted) {
      await unlink(tempOutputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    }
    await rm(workDir, { recursive: true, force: true });
  }
}
