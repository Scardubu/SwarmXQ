import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  AssetLicense,
  VoiceArtifact,
  VoiceCapability,
  VoiceDescriptor,
  VoiceProviderState,
  VoiceSynthesisRequest,
  VoiceQualityTier,
} from "@swarmx/types/video-types";
import { loadEnv } from "../lib/env.js";

const VOICE_COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;

export const KOKORO_VOICE_MAP: Record<string, string> = {
  warm: "af_sarah",
  narrator: "am_michael",
  educational: "bm_george",
  cinematic: "bm_lewis",
  urgent: "am_adam",
  contrarian: "af_nicole",
  faceless_broll: "am_michael",
  default: "am_michael",
  calm: "af_sarah",
  energetic: "am_adam",
};

const KOKORO_SPEED_MAP: Record<string, number> = {
  warm: 0.95,
  narrator: 1,
  educational: 0.92,
  cinematic: 0.9,
  urgent: 1.1,
  contrarian: 1.02,
  faceless_broll: 1,
  default: 1,
  calm: 0.95,
  energetic: 1.1,
};

export interface VoiceProvider {
  id: string;
  probe(): Promise<VoiceCapability>;
  listVoices(locale?: string): Promise<VoiceDescriptor[]>;
  synthesize(request: VoiceSynthesisRequest, outputPath: string, signal?: AbortSignal): Promise<VoiceArtifact>;
  health(): Promise<{ providerId: string; state: VoiceProviderState; message: string }>;
}

function execFileChecked(command: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        ...(signal !== undefined ? { signal } : {}),
        timeout: VOICE_COMMAND_TIMEOUT_MS,
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

function execFileWithInput(command: string, args: string[], input: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        ...(signal !== undefined ? { signal } : {}),
        timeout: VOICE_COMMAND_TIMEOUT_MS,
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
    child.stdin?.end(input);
  });
}

async function commandAvailable(command: string, versionFlag: string): Promise<boolean> {
  try {
    await execFileChecked(command, [versionFlag]);
    return true;
  } catch {
    return false;
  }
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export function normalizeScriptForSpeech(text: string): string {
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/\[(?:HOOK|BODY|RESOLUTION|CTA)\]/gi, " ")
    .replace(/\[VISUAL:[^\]]*\]/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>{}[\]]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const balancedQuotes = stripped.replace(/(^|\s)"([^"]{1,140})(?=\s|$)/g, "$1$2");
  const withoutQuoteDebris = balancedQuotes
    .replace(/"\s*([.,!?;:])/g, "$1")
    .replace(/([.,!?;:])\s*"/g, "$1")
    .replace(/(^|\s)'([^']{1,80})(?=\s|$)/g, "$1$2")
    .replace(/([.!?]){2,}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutQuoteDebris) {
    throw Object.assign(new Error("Narration text is empty after normalization"), {
      code: "SCRIPT_NORMALIZATION_EMPTY",
    });
  }
  if (/[{}[\]<>]/.test(withoutQuoteDebris)) {
    throw Object.assign(new Error("Narration text still contains markup-like characters"), {
      code: "SCRIPT_NORMALIZATION_MARKUP",
    });
  }
  return withoutQuoteDebris.slice(0, 1_200);
}

async function probeAudio(path: string): Promise<{ sampleRateHz: number; channels: number; durationSeconds: number }> {
  const { stdout } = await execFileChecked("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels:format=duration",
    "-of", "json",
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: { sample_rate?: string; channels?: number }[];
    format?: { duration?: string };
  };
  const audio = parsed.streams?.[0];
  return {
    sampleRateHz: Number(audio?.sample_rate ?? 0),
    channels: Number(audio?.channels ?? 0),
    durationSeconds: Number(parsed.format?.duration ?? 0),
  };
}

function espeakLicense(): AssetLicense {
  return {
    state: "approved",
    sourceName: "eSpeak NG executable",
    sourceUrl: "https://github.com/espeak-ng/espeak-ng",
    allowedUses: ["local-render", "review-package"],
    attribution: "Speech generated locally with eSpeak NG fallback.",
  };
}

function piperLicense(modelPath: string): AssetLicense {
  return {
    state: "needs_review",
    sourceName: `Piper voice model ${basename(modelPath)}`,
    allowedUses: ["local-render"],
    attribution: "Piper voice model license must be reviewed before READY_TO_POST.",
  };
}

function kokoroLicense(): AssetLicense {
  return {
    state: "approved",
    sourceName: "Kokoro-82M local microservice",
    sourceUrl: "https://huggingface.co/hexgrad/Kokoro-82M",
    allowedUses: ["local-render", "review-package", "short-form-video"],
    attribution: "Speech generated locally with the Kokoro TTS provider.",
  };
}

abstract class BaseVoiceProvider implements VoiceProvider {
  abstract id: string;
  abstract qualityTier: VoiceQualityTier;
  abstract probe(): Promise<VoiceCapability>;
  abstract listVoices(locale?: string): Promise<VoiceDescriptor[]>;
  abstract synthesize(request: VoiceSynthesisRequest, outputPath: string, signal?: AbortSignal): Promise<VoiceArtifact>;

  async health(): Promise<{ providerId: string; state: VoiceProviderState; message: string }> {
    const capability = await this.probe();
    return {
      providerId: this.id,
      state: capability.state,
      message: capability.reason ?? "provider probed",
    };
  }

  protected async artifactBase(
    request: VoiceSynthesisRequest,
    outputPath: string,
    providerVersion: string | undefined,
    descriptor: VoiceDescriptor,
    normalizedText: string,
    generationLatencyMs: number,
    fallbackReason?: string,
  ): Promise<VoiceArtifact> {
    const probe = await probeAudio(outputPath);
    return {
      providerId: this.id,
      ...(providerVersion ? { providerVersion } : {}),
      voiceId: descriptor.voiceId,
      displayName: descriptor.displayName,
      locale: descriptor.locale,
      qualityTier: descriptor.qualityTier,
      license: descriptor.license,
      consentRequired: descriptor.consentRequired,
      consentState: descriptor.consentRequired ? "missing" : "not_required",
      textHash: sha256Text(normalizedText),
      normalizedText,
      pronunciationDictionaryVersion: loadEnv().SWARMX_TTS_PRONUNCIATION_DICTIONARY_VERSION,
      requestedSampleRateHz: request.requestedSampleRateHz,
      actualSampleRateHz: probe.sampleRateHz,
      channels: probe.channels,
      durationSeconds: probe.durationSeconds,
      outputPath,
      sha256: await sha256File(outputPath),
      generationLatencyMs,
      ...(fallbackReason ? { fallbackReason } : {}),
      lineage: {
        sourceKind: "generated",
        parentAssetIds: [],
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export class KokoroVoiceProvider extends BaseVoiceProvider {
  id = "kokoro";
  qualityTier: VoiceQualityTier = "neural_local";

  async probe(): Promise<VoiceCapability> {
    const env = loadEnv();
    try {
      const response = await fetch(`${env.SWARMX_TTS_URL}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        return {
          providerId: this.id,
          state: "unavailable",
          qualityTier: this.qualityTier,
          supportsStreaming: false,
          supportsCancellation: true,
          requiresExternalDownload: true,
          reason: `Kokoro health probe returned ${response.status}`,
          action: "Start python -m swarmx.services.kokoro_tts_server after installing kokoro",
          probedAt: new Date().toISOString(),
        };
      }
      const body = await response.json().catch(() => ({})) as { engine?: string; status?: string };
      const serviceReady = body.engine === "kokoro";
      return {
        providerId: this.id,
        state: serviceReady ? "available" : "degraded",
        qualityTier: this.qualityTier,
        supportsStreaming: false,
        supportsCancellation: true,
        requiresExternalDownload: false,
        ...(serviceReady ? {} : {
          reason: "Kokoro service is reachable but did not report the kokoro engine",
          action: "Check Kokoro service logs and installed Python package",
        }),
        probedAt: new Date().toISOString(),
      };
    } catch {
      return {
        providerId: this.id,
        state: "unavailable",
        qualityTier: this.qualityTier,
        supportsStreaming: false,
        supportsCancellation: true,
        requiresExternalDownload: true,
        reason: `Kokoro TTS service is not reachable at ${env.SWARMX_TTS_URL}`,
        action: "Install kokoro in the Python environment and start python -m swarmx.services.kokoro_tts_server",
        probedAt: new Date().toISOString(),
      };
    }
  }

  async listVoices(locale = loadEnv().SWARMX_TTS_LOCALE): Promise<VoiceDescriptor[]> {
    const uniqueVoices = [...new Set(Object.values(KOKORO_VOICE_MAP))].sort();
    return uniqueVoices.map((voiceId) => ({
      providerId: this.id,
      voiceId,
      displayName: `Kokoro ${voiceId}`,
      locale,
      qualityTier: this.qualityTier,
      license: kokoroLicense(),
      consentRequired: false,
    }));
  }

  async synthesize(request: VoiceSynthesisRequest, outputPath: string, signal?: AbortSignal): Promise<VoiceArtifact> {
    const env = loadEnv();
    await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    const normalizedText = normalizeScriptForSpeech(request.text);
    const requestedVoice = request.voiceId ?? "default";
    const voiceId = KOKORO_VOICE_MAP[requestedVoice] ?? requestedVoice;
    const voices = await this.listVoices(request.locale);
    const descriptor = voices.find((voice) => voice.voiceId === voiceId) ?? voices.find((voice) => voice.voiceId === KOKORO_VOICE_MAP.default) ?? voices[0]!;
    const started = Date.now();
    const response = await fetch(`${env.SWARMX_TTS_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: normalizedText,
        voice: voiceId,
        speed: KOKORO_SPEED_MAP[requestedVoice] ?? 1,
      }),
      signal: signal ?? AbortSignal.timeout(VOICE_COMMAND_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Kokoro TTS failed with HTTP ${response.status}`), {
        code: "KOKORO_TTS_FAILED",
      });
    }
    const body = await response.json() as { wav_b64?: unknown };
    if (typeof body.wav_b64 !== "string" || body.wav_b64.length === 0) {
      throw Object.assign(new Error("Kokoro TTS response did not include wav_b64"), {
        code: "KOKORO_TTS_INVALID_RESPONSE",
      });
    }
    await writeFile(outputPath, Buffer.from(body.wav_b64, "base64"));
    return this.artifactBase(request, outputPath, "kokoro-82m", descriptor, normalizedText, Date.now() - started);
  }
}

export class PiperVoiceProvider extends BaseVoiceProvider {
  id = "piper";
  qualityTier: VoiceQualityTier = "neural_local";

  async probe(): Promise<VoiceCapability> {
    const env = loadEnv();
    const hasCommand = await commandAvailable("piper", "--version");
    if (!hasCommand) {
      return {
        providerId: this.id,
        state: "unavailable",
        qualityTier: this.qualityTier,
        supportsStreaming: false,
        supportsCancellation: true,
        requiresExternalDownload: true,
        reason: "piper executable not found",
        action: "Install Piper and configure SWARMX_TTS_PIPER_MODEL_PATH",
        probedAt: new Date().toISOString(),
      };
    }
    if (!env.SWARMX_TTS_PIPER_MODEL_PATH) {
      return {
        providerId: this.id,
        state: "degraded",
        qualityTier: this.qualityTier,
        supportsStreaming: false,
        supportsCancellation: true,
        requiresExternalDownload: true,
        reason: "SWARMX_TTS_PIPER_MODEL_PATH is not configured",
        action: "Download a reviewed Piper voice model and set SWARMX_TTS_PIPER_MODEL_PATH",
        probedAt: new Date().toISOString(),
      };
    }
    return {
      providerId: this.id,
      state: "available",
      qualityTier: this.qualityTier,
      supportsStreaming: false,
      supportsCancellation: true,
      requiresExternalDownload: false,
      probedAt: new Date().toISOString(),
    };
  }

  async listVoices(locale = loadEnv().SWARMX_TTS_LOCALE): Promise<VoiceDescriptor[]> {
    const modelPath = loadEnv().SWARMX_TTS_PIPER_MODEL_PATH ?? "unconfigured";
    return [{
      providerId: this.id,
      voiceId: `piper:${basename(modelPath)}`,
      displayName: `Piper ${basename(modelPath)}`,
      locale,
      qualityTier: this.qualityTier,
      license: piperLicense(modelPath),
      consentRequired: false,
    }];
  }

  async synthesize(request: VoiceSynthesisRequest, outputPath: string, signal?: AbortSignal): Promise<VoiceArtifact> {
    const env = loadEnv();
    if (!env.SWARMX_TTS_PIPER_MODEL_PATH) {
      throw Object.assign(new Error("SWARMX_TTS_PIPER_MODEL_PATH is required for Piper synthesis"), {
        code: "PIPER_MODEL_MISSING",
      });
    }
    await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    const normalizedText = normalizeScriptForSpeech(request.text);
    const [descriptor] = await this.listVoices(request.locale);
    const started = Date.now();
    await execFileWithInput("piper", [
      "--model", env.SWARMX_TTS_PIPER_MODEL_PATH,
      "--output_file", outputPath,
    ], normalizedText, signal);
    return this.artifactBase(request, outputPath, undefined, descriptor!, normalizedText, Date.now() - started);
  }
}

export class EspeakVoiceProvider extends BaseVoiceProvider {
  id = "espeak-ng";
  qualityTier: VoiceQualityTier = "synthetic_fallback";

  async probe(): Promise<VoiceCapability> {
    const hasCommand = await commandAvailable("espeak-ng", "--version");
    return {
      providerId: this.id,
      state: hasCommand ? "available" : "unavailable",
      qualityTier: this.qualityTier,
      supportsStreaming: false,
      supportsCancellation: true,
      requiresExternalDownload: false,
      ...(hasCommand ? {} : { reason: "espeak-ng executable not found", action: "Install espeak-ng or configure Piper" }),
      probedAt: new Date().toISOString(),
    };
  }

  async listVoices(locale = loadEnv().SWARMX_TTS_LOCALE): Promise<VoiceDescriptor[]> {
    return ["default", "calm", "energetic", "narrator"].map((voiceId) => ({
      providerId: this.id,
      voiceId,
      displayName: `eSpeak ${voiceId}`,
      locale,
      qualityTier: this.qualityTier,
      license: espeakLicense(),
      consentRequired: false,
    }));
  }

  async synthesize(request: VoiceSynthesisRequest, outputPath: string, signal?: AbortSignal): Promise<VoiceArtifact> {
    const normalizedText = normalizeScriptForSpeech(request.text);
    const voices = await this.listVoices(request.locale);
    const descriptor = voices.find((voice) => voice.voiceId === request.voiceId) ?? voices[0]!;
    const speedByVoice: Record<string, string> = {
      default: "165",
      calm: "145",
      energetic: "185",
      narrator: "155",
    };
    const started = Date.now();
    await execFileChecked("espeak-ng", [
      "-w", outputPath,
      "-s", speedByVoice[descriptor.voiceId] ?? "165",
      normalizedText,
    ], signal);
    return this.artifactBase(
      request,
      outputPath,
      undefined,
      descriptor,
      normalizedText,
      Date.now() - started,
      "local neural provider unavailable or not selected",
    );
  }
}

export function voiceProviders(): VoiceProvider[] {
  return [new KokoroVoiceProvider(), new PiperVoiceProvider(), new EspeakVoiceProvider()];
}

export async function selectVoiceProvider(): Promise<{ provider: VoiceProvider; capability: VoiceCapability; fallbackReason?: string }> {
  const env = loadEnv();
  const providers = voiceProviders();
  const preferred = env.SWARMX_TTS_PROVIDER;
  const preferredProviderId = preferred === "espeak" ? "espeak-ng" : preferred;
  const ordered = preferred === "auto"
    ? providers
    : providers.filter((provider) => provider.id === preferredProviderId);

  for (const provider of ordered) {
    const capability = await provider.probe();
    if (capability.state === "available") {
      const fallbackReason = provider.id === "espeak-ng"
        ? "Kokoro/Piper neural providers unavailable; using explicit espeak-ng fallback"
        : undefined;
      return { provider, capability, ...(fallbackReason ? { fallbackReason } : {}) };
    }
    if (preferred !== "auto") {
      throw Object.assign(new Error(capability.reason ?? `${provider.id} unavailable`), {
        code: "VOICE_PROVIDER_UNAVAILABLE",
      });
    }
  }

  throw Object.assign(new Error("No usable voice provider available"), {
    code: "VOICE_PROVIDER_UNAVAILABLE",
  });
}
