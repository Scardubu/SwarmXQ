import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { VideoJobRequest } from "../types/video.js";
import { outputDir, resolveOutputPath } from "./video-assets.js";
import { loadEnv } from "../lib/env.js";

const _ffenv = loadEnv();
const RENDER_COMMAND_TIMEOUT_MS = Math.min(
  900_000,
  Math.max(30_000, _ffenv.SWARMX_VIDEO_FFMPEG_TIMEOUT_MS || 240_000),
);
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const RENDER_TEMP_DIR = resolve(_ffenv.SWARMX_VIDEO_TEMP_DIR);

interface FfmpegRenderInput {
  jobId: string;
  request: VideoJobRequest;
  scriptText?: string;
  storyboardFrames: string[];
  signal?: AbortSignal;
}

// ── Visual Palette ─────────────────────────────────────────────────────────────

const TONE_BACKGROUNDS: Record<string, string> = {
  contrarian:  "0x0a0a0a",  // near black — harsh, high-contrast
  urgent:      "0x150505",  // very dark red
  educational: "0x070e1a",  // deep navy
  cinematic:   "0x0c0c0c",  // dark charcoal
  warm:        "0x100805",  // dark warm brown
  minimal:     "0x000000",  // pure black
};

const TONE_ACCENTS: Record<string, string> = {
  contrarian:  "0xff2222",  // sharp red
  urgent:      "0xff6600",  // orange
  educational: "0x3399ff",  // electric blue
  cinematic:   "0xddaa44",  // gold
  warm:        "0xff9966",  // peach
  minimal:     "0xffffff",  // white
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        ...(signal !== undefined ? { signal } : {}),
        timeout: RENDER_COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
          return;
        }
        resolve();
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
  const normalized = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\[(?:HOOK|BODY|RESOLUTION|CTA|VISUAL:[^\]]*)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 600);
}

// Scale font size down for long text so it stays readable in 720px wide frame.
function fontSizeForText(text: string, base: number): number {
  const len = text.length;
  if (len > 150) return Math.round(base * 0.62);
  if (len > 100) return Math.round(base * 0.75);
  if (len > 60)  return Math.round(base * 0.88);
  if (len <= 20) return Math.round(base * 1.25);
  return base;
}

// Build the filter_complex chain: fade in, per-card drawtext, progress bar, fade out.
function buildFilterComplex(
  fontFile: string,
  textFiles: string[],
  cardTexts: string[],
  duration: number,
  accentHex: string,
  styleConfig: CaptionStyleConfig,
): string {
  const slot = duration / textFiles.length;

  const textFilters = textFiles.map((file, index) => {
    const start = Math.floor(index * slot * 10) / 10;
    const end = index === textFiles.length - 1
      ? duration
      : Math.floor((index + 1) * slot * 10) / 10;

    const cardText = cardTexts[index] ?? "";
    const fontSize = fontSizeForText(cardText, styleConfig.baseFontSize);

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
      `enable='between(t,${start},${end})'`,
    ].join(":");
  });

  // Animated progress bar: grows from left to right over the full duration.
  // Accent color in hex without the 0x prefix for FFmpeg's color syntax.
  const accentRgb = accentHex.replace(/^0x/, "");
  const progressBar = `drawbox=x=0:y=ih-8:w=trunc(iw*t/${duration}):h=8:color=${accentRgb}@0.9:t=fill`;

  return [
    "format=yuv420p",
    `fade=t=in:st=0:d=0.4`,
    ...textFilters,
    progressBar,
    `fade=t=out:st=${Math.max(0, duration - 0.6)}:d=0.6`,
  ].join(",");
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function renderWithFfmpeg(input: FfmpegRenderInput): Promise<{ outputFilename: string }> {
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
    const textFiles: string[] = [];
    for (let i = 0; i < cards.length; i += 1) {
      const file = join(workDir, `card-${i}-${randomUUID()}.txt`);
      await writeFile(file, `${cards[i] ?? ""}\n`, "utf8");
      textFiles.push(file);
    }

    const narrationPath = join(workDir, "narration.wav");
    const hasEspeak = await commandAvailable("espeak-ng", "--version");
    if (!hasEspeak && loadEnv().SWARMX_VIDEO_ALLOW_SILENT_AUDIO !== "1") {
      throw Object.assign(new Error("espeak-ng is not available"), { code: "ESPEAK_UNAVAILABLE" });
    }
    if (hasEspeak) {
      const speedByVoice: Record<string, string> = {
        default:   "165",
        calm:      "145",
        energetic: "185",
        narrator:  "155",
      };
      await execFileChecked("espeak-ng", [
        "-w", narrationPath,
        "-s", speedByVoice[input.request.voice ?? "default"] ?? "165",
        narrationText(input, cards),
      ], input.signal);
    }

    const filterComplex = buildFilterComplex(
      fontFile,
      textFiles,
      cards,
      duration,
      accentColor,
      styleConfig,
    );

    const inputArgs = hasEspeak
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
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      tempOutputPath,
    ], input.signal);

    await rename(tempOutputPath, outputPath);
    renderCompleted = true;

    return { outputFilename };
  } finally {
    if (!renderCompleted) {
      await unlink(tempOutputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    }
    await rm(workDir, { recursive: true, force: true });
  }
}
