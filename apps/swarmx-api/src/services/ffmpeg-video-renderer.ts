import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoJobRequest } from "../types/video.js";
import { outputDir, resolveOutputPath } from "./video-assets.js";

const RENDER_COMMAND_TIMEOUT_MS = Math.min(
  900_000,
  Math.max(30_000, Number.parseInt(process.env["SWARMX_VIDEO_FFMPEG_TIMEOUT_MS"] ?? "240000", 10) || 240_000),
);
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;

interface FfmpegRenderInput {
  jobId: string;
  request: VideoJobRequest;
  scriptText?: string;
  storyboardFrames: string[];
  signal?: AbortSignal;
}

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

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileChecked(command, ["-version"]);
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
  const quotedTitle = request.prompt.match(/(?:titled|called)\s+["'“”‘’]([^"'“”‘’]+)["'“”‘’]/i)?.[1];
  if (quotedTitle?.trim()) return quotedTitle.trim();
  return request.prompt
    .replace(/\s+/g, " ")
    .replace(/^create\s+(?:a|an)\s+/i, "")
    .slice(0, 80)
    .trim() || "SwarmXQ Video";
}

function renderCards(input: FfmpegRenderInput): string[] {
  const title = titleFromRequest(input.request);
  const audience = input.request.audience?.trim() || "people who need this now";
  const tone = input.request.tone ?? "educational";
  const style = input.request.style?.replace(/_/g, " ") ?? "faceless broll";
  const captionStyle = input.request.captionStyle?.replace(/_/g, " ") ?? "bold center";
  const scriptLines = (input.scriptText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const frameLines = input.storyboardFrames.map((line) => line.trim()).filter(Boolean);

  return [
    title,
    firstNonEmpty(scriptLines, `Stop scrolling. This ${tone} short is for ${audience}.`),
    `Format: ${style}. Captions: ${captionStyle}.`,
    firstNonEmpty(frameLines.slice(0, 1), "Habit 1: protect one distraction-free block."),
    firstNonEmpty(frameLines.slice(1, 2), "Habit 2: write the next action before you start."),
    firstNonEmpty(frameLines.slice(2, 3), "Habit 3: reset your environment before every session."),
    "Try one today. Save this for your next focused work block.",
  ];
}

function narrationText(input: FfmpegRenderInput, cards: string[]): string {
  const script = input.scriptText?.trim();
  if (script) return script;
  return cards.join(". ");
}

function drawTextFilter(fontFile: string, textFiles: string[], duration: number): string {
  const slot = duration / textFiles.length;
  const filters = textFiles.map((file, index) => {
    const start = Math.floor(index * slot * 10) / 10;
    const end = index === textFiles.length - 1
      ? duration
      : Math.floor((index + 1) * slot * 10) / 10;
    return [
      `drawtext=fontfile=${fontFile}`,
      `textfile=${file}`,
      "fontcolor=white",
      "fontsize=48",
      "line_spacing=14",
      "box=1",
      "boxcolor=black@0.42",
      "boxborderw=28",
      "x=(w-text_w)/2",
      "y=(h-text_h)/2",
      `enable='between(t,${start},${end})'`,
    ].join(":");
  });

  return [
    "format=yuv420p",
    "fade=t=in:st=0:d=0.35",
    ...filters,
    `fade=t=out:st=${Math.max(0, duration - 0.5)}:d=0.5`,
  ].join(",");
}

export async function renderWithFfmpeg(input: FfmpegRenderInput): Promise<{ outputFilename: string }> {
  if (!(await commandAvailable("ffmpeg"))) {
    throw Object.assign(new Error("ffmpeg is not available"), {
      code: "FFMPEG_UNAVAILABLE",
    });
  }
  if (!(await commandAvailable("ffprobe"))) {
    throw Object.assign(new Error("ffprobe is not available"), {
      code: "FFPROBE_UNAVAILABLE",
    });
  }

  const fontFile = discoverFont();
  const duration = clampDuration(input.request.targetDurationSeconds);
  const cards = renderCards(input);
  const workDir = await mkdtemp(join(tmpdir(), `swarmx-video-${input.jobId}-`));
  const outputFilename = `video_${input.jobId}.mp4`;
  const outputPath = resolveOutputPath(outputFilename);

  try {
    await mkdir(outputDir(), { recursive: true });
    const textFiles: string[] = [];
    for (let i = 0; i < cards.length; i += 1) {
      const file = join(workDir, `card-${i}-${randomUUID()}.txt`);
      await writeFile(file, `${cards[i] ?? ""}\n`, "utf8");
      textFiles.push(file);
    }

    const narrationPath = join(workDir, "narration.wav");
    const hasEspeak = await commandAvailable("espeak-ng");
    if (!hasEspeak && process.env["SWARMX_VIDEO_ALLOW_SILENT_AUDIO"] !== "1") {
      throw Object.assign(new Error("espeak-ng is not available"), {
        code: "ESPEAK_UNAVAILABLE",
      });
    }
    if (hasEspeak) {
      const speedByVoice: Record<string, string> = {
        default: "165",
        calm: "145",
        energetic: "185",
        narrator: "155",
      };
      await execFileChecked("espeak-ng", [
        "-w",
        narrationPath,
        "-s",
        speedByVoice[input.request.voice ?? "default"] ?? "165",
        narrationText(input, cards),
      ], input.signal);
    }

    const filter = drawTextFilter(fontFile, textFiles, duration);
    const inputArgs = hasEspeak
      ? ["-i", narrationPath]
      : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];

    await execFileChecked("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x111827:s=720x1280:r=24:d=${duration}`,
      ...inputArgs,
      "-filter_complex",
      `[0:v]${filter}[v]`,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-shortest",
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ], input.signal);

    return { outputFilename };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
