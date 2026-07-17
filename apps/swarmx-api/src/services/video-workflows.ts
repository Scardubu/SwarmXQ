/**
 * apps/swarmx-api/src/services/video-workflows.ts
 * VIDEO-ALPHA parameterized workflow generators.
 */

import type { ComfyNode, ComfyWorkflow, FrameMath, VideoMode, VideoResolution } from "@swarmx/types/video-types";
import { ModelOrchestrator } from "./model-orchestrator.js";
import { log } from "../lib/logger.js";

export interface WorkflowParams {
  seed: number;
  prompt: string;
  negativePrompt?: string;
  resolution: VideoResolution;
  totalFrames: number;
  outputFps: number;
  availableMb: number;
  interpolationFactor?: number;
  imageInputPath?: string;
}

const MAX_BATCH_FOR_RESOLUTION: Record<VideoResolution, number> = {
  "512x512": 8,
  "512x896": 4,
  "768x512": 4,
  "768x1344": 2,
};

const MIN_BATCH_SIZE = 2;
const MAX_BATCH_SIZE = parseInt(process.env["SWARMX_VIDEO_MAX_BATCH_SIZE"] ?? "8", 10);

function parseResolution(resolution: VideoResolution): { width: number; height: number } {
  const [widthRaw, heightRaw] = resolution.split("x").map((v) => parseInt(v, 10));
  let width = widthRaw ?? 512;
  let height = heightRaw ?? 512;
  if (Number.isNaN(width)) width = 512;
  if (Number.isNaN(height)) height = 512;
  return { width, height };
}

function computeBatchSize(resolution: VideoResolution, availableMb: number): number {
  const ceiling = MAX_BATCH_FOR_RESOLUTION[resolution];
  if (availableMb < 2000) return Math.max(MIN_BATCH_SIZE, Math.floor(ceiling / 2));
  return Math.max(MIN_BATCH_SIZE, Math.min(ceiling, MAX_BATCH_SIZE));
}

function buildFrameMath(params: WorkflowParams): FrameMath {
  const boundedOutputFps = Math.max(1, params.outputFps);
  const maxFramesByDuration = boundedOutputFps * Math.max(1, Math.ceil(params.totalFrames / boundedOutputFps));
  const boundedTotalFrames = Math.max(8, Math.min(params.totalFrames, maxFramesByDuration));

  return {
    totalFrames: boundedTotalFrames,
    batchSize: computeBatchSize(params.resolution, params.availableMb),
    interpolationFactor: params.interpolationFactor ?? 1,
    outputFps: boundedOutputFps,
  };
}

function teaCacheEnabled(availableMb: number): boolean {
  return process.env["SWARMX_COMFYUI_TEACACHE"] === "1" && availableMb > 6000;
}

function deterministicSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 42;
}

function baseNodes(params: WorkflowParams, mode: VideoMode): Record<string, ComfyNode> {
  const { width, height } = parseResolution(params.resolution);
  return {
    "1": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: params.prompt,
        clip: ["2", 1],
      },
    },
    "2": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: mode === "i2v" ? "wan2.1-i2v-14b-q4km.gguf" : "ltx-video-0.9.5-q4km.gguf",
        weight_dtype: "fp8_e4m3fn",
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: deterministicSeed(params.seed),
        steps: 20,
        cfg: 4.0,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
        model: ["2", 0],
        positive: ["1", 0],
        negative: ["4", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: params.negativePrompt ?? "blurry, watermark, text artifacts, low quality",
        clip: ["2", 1],
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width,
        height,
        batch_size: buildFrameMath(params).batchSize,
      },
    },
    "6": {
      class_type: "VHS_VideoCombine",
      inputs: {
        frame_rate: params.outputFps,
        loop_count: 0,
        format: "video/h264-mp4",
        filename_prefix: "swarmx_video",
        images: ["7", 0],
      },
    },
    "7": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["8", 0],
      },
    },
    "8": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "vae-ft-mse-840000-ema-pruned.safetensors",
      },
    },
    "9": {
      class_type: "TeaCache",
      inputs: {
        cache_device: teaCacheEnabled(params.availableMb) ? "cpu" : "none",
      },
    },
    "10": {
      class_type: "FreeMemory",
      inputs: {
        anything: ["3", 0],
      },
    },
  };
}

function workflow(version: string, modelTag: string, nodes: Record<string, ComfyNode>, frameMath: FrameMath): ComfyWorkflow {
  return {
    version,
    modelTag,
    nodeGraph: nodes,
    ramBudgetMb: Math.max(1000, Math.round(frameMath.batchSize * 700 + frameMath.totalFrames * 12)),
    frameMath,
  };
}

export function generateLTXWorkflow(params: WorkflowParams): ComfyWorkflow {
  const frameMath = buildFrameMath(params);
  const nodes = baseNodes(params, "t2v");
  nodes["13"] = {
    class_type: "FreeMemory",
    inputs: {
      anything: ["7", 0],
    },
  };
  return workflow("video-alpha-ltx-v1", "instruct-phi4-pro-q8-prod", nodes, frameMath);
}

export function generateWanT2VWorkflow(params: WorkflowParams): ComfyWorkflow {
  const frameMath = buildFrameMath(params);
  const nodes = baseNodes(params, "t2v");
  nodes["2"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "wan2.1-t2v-1.3b-q5km.gguf",
      weight_dtype: "fp8_e4m3fn",
    },
  };
  nodes["13"] = {
    class_type: "FreeMemory",
    inputs: {
      anything: ["7", 0],
    },
  };
  return workflow("video-alpha-wan-t2v-v1", "code-qwen25-pro-q5km-prod", nodes, frameMath);
}

export function generateWanI2VWorkflow(params: WorkflowParams): ComfyWorkflow {
  void ModelOrchestrator.getInstance().evictIncompatible("synth-wan-i2v-14b").catch(() => undefined);
  log.info("video single-14b lock enforced");

  const frameMath = buildFrameMath(params);
  const nodes = baseNodes(params, "i2v");
  nodes["2"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "wan2.1-i2v-14b-q4km.gguf",
      weight_dtype: "fp8_e4m3fn",
    },
  };
  nodes["11"] = {
    class_type: "LoadImage",
    inputs: {
      image: params.imageInputPath ?? "",
    },
  };
  nodes["12"] = {
    class_type: "ImageToVideoConditioning",
    inputs: {
      image: ["11", 0],
      frames: frameMath.totalFrames,
      conditioning: ["1", 0],
    },
  };
  nodes["3"] = {
    class_type: "KSampler",
    inputs: {
      seed: deterministicSeed(params.seed),
      steps: 20,
      cfg: 4.5,
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
      model: ["2", 0],
      positive: ["12", 0],
      negative: ["4", 0],
      latent_image: ["5", 0],
    },
  };
  nodes["13"] = {
    class_type: "FreeMemory",
    inputs: {
      anything: ["12", 0],
    },
  };
  return workflow("video-alpha-wan-i2v-v1", "reason-deepseekr1-pro-q5km-prod", nodes, frameMath);
}
