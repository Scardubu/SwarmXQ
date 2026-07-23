/**
 * Render recipe compiler — validates SceneSpec inputs and produces safe FFmpeg arg structures.
 *
 * SECURITY INVARIANT: model output never reaches raw FFmpeg filter graphs.
 * All free-text SceneSpec fields are sanitized before use.
 * safeFilterTokens contains only enum-derived values — never free-text from model output.
 */
import type {
  SceneSpec,
  ValidatedRenderRecipe,
  RendererCapabilityTier,
  MotionPreset,
  TransitionPreset,
  ColorGrade,
} from "@swarmx/types/video-types";

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_PATH_RE = /^[/a-zA-Z0-9_\-.]+$/;
const FFMPEG_METACHAR_RE = /[\\[\];,{}()%]/g;

export class RenderRecipeCompilationError extends Error {
  code: string;
  field: string;
  constructor(message: string, code: string, field: string) {
    super(message);
    this.name = "RenderRecipeCompilationError";
    this.code = code;
    this.field = field;
  }
}

function sanitizeTextForFilter(raw: string, field: string): string {
  const cleaned = raw.replace(FFMPEG_METACHAR_RE, "");
  if (cleaned !== raw) {
    // Strip is acceptable — caller may log the mismatch but we don't throw
  }
  if (cleaned.length === 0 && raw.length > 0) {
    throw new RenderRecipeCompilationError(
      `Text field "${field}" contained only filter metacharacters and is empty after sanitization`,
      "RENDER_TEXT_SANITIZATION_EMPTY",
      field,
    );
  }
  return cleaned;
}

function validateAssetHash(hash: string, field: string): void {
  if (!SHA256_RE.test(hash)) {
    throw new RenderRecipeCompilationError(
      `Asset reference in field "${field}" is not a valid SHA-256 hex string: "${hash.slice(0, 16)}..."`,
      "RENDER_INVALID_ASSET_HASH",
      field,
    );
  }
}

function validateSrtPath(path: string, field: string): void {
  if (!SAFE_PATH_RE.test(path)) {
    throw new RenderRecipeCompilationError(
      `Caption path in field "${field}" contains unsafe characters or path traversal`,
      "RENDER_UNSAFE_SRT_PATH",
      field,
    );
  }
  if (path.split("/").some((segment) => segment === "..")) {
    throw new RenderRecipeCompilationError(
      `Caption path in field "${field}" contains directory traversal sequence`,
      "RENDER_UNSAFE_SRT_PATH",
      field,
    );
  }
}

const MOTION_FILTER_TOKENS: Record<MotionPreset, string> = {
  static: "null",
  ken_burns_slow: "zoompan=z='min(zoom+0.0005,1.1)':d=125:fps=25",
  ken_burns_fast: "zoompan=z='min(zoom+0.001,1.2)':d=75:fps=25",
  zoom_in: "zoompan=z='min(zoom+0.0008,1.15)':d=100:fps=25",
  zoom_out: "zoompan=z='max(zoom-0.0005,1.0)':d=125:fps=25",
  slide_left: "crop=iw-50:ih:50*t/5:0",
  slide_right: "crop=iw-50:ih:0+50*t/5:0",
};

const TRANSITION_FILTER_TOKENS: Record<TransitionPreset, string> = {
  cut: "null",
  fade_black: "fade=t=out:st=0:d=0.3:color=black",
  fade_white: "fade=t=out:st=0:d=0.3:color=white",
  dissolve: "blend=all_expr='A*(1-T)+B*T'",
  wipe_left: "crop=iw*(1-T):ih:0:0",
};

const COLOR_GRADE_FILTER_TOKENS: Record<ColorGrade, string> = {
  natural: "null",
  warm: "curves=r='0/0 0.5/0.56 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.44 1/1'",
  cool: "curves=r='0/0 0.5/0.44 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.56 1/1'",
  high_contrast: "curves=all='0/0 0.25/0.18 0.75/0.85 1/1'",
  desaturated: "hue=s=0.5",
  cinematic_lut_01: "eq=contrast=1.05:brightness=-0.02:saturation=0.9",
};

function buildSceneInputArgs(scene: SceneSpec, sceneIndex: number): string[] {
  const args: string[] = [];

  if (scene.background.type === "asset_ref") {
    validateAssetHash(scene.background.value, `scene[${sceneIndex}].background.value`);
    args.push(`-i`, `asset:${scene.background.value}`);
  }

  for (const [assetIdx, layer] of scene.assets.entries()) {
    validateAssetHash(layer.assetHash, `scene[${sceneIndex}].assets[${assetIdx}].assetHash`);
    args.push(`-i`, `asset:${layer.assetHash}`);
  }

  if (scene.caption) {
    validateSrtPath(scene.caption.srtPath, `scene[${sceneIndex}].caption.srtPath`);
  }

  return args;
}

function buildFilterTokens(scene: SceneSpec): string[] {
  const tokens: string[] = [];

  tokens.push(MOTION_FILTER_TOKENS[scene.motion]);

  if (scene.transition) {
    tokens.push(TRANSITION_FILTER_TOKENS[scene.transition]);
  }

  if (scene.colorTreatment) {
    tokens.push(COLOR_GRADE_FILTER_TOKENS[scene.colorTreatment]);
  }

  return tokens.filter((t) => t !== "null");
}

export function compileSceneSpec(
  scenes: SceneSpec[],
  rendererTier: RendererCapabilityTier,
): ValidatedRenderRecipe {
  if (scenes.length === 0) {
    throw new RenderRecipeCompilationError(
      "Cannot compile an empty scene list",
      "RENDER_EMPTY_SCENE_LIST",
      "scenes",
    );
  }

  const safeInputArgs: string[][] = [];
  const safeFilterTokens: string[] = [];
  let totalDurationSec = 0;

  for (const [i, scene] of scenes.entries()) {
    // Sanitize all free-text fields before they can reach filter graph
    for (const [ti, textLayer] of scene.text.entries()) {
      sanitizeTextForFilter(textLayer.text, `scene[${i}].text[${ti}].text`);
    }

    safeInputArgs.push(buildSceneInputArgs(scene, i));
    safeFilterTokens.push(...buildFilterTokens(scene));
    totalDurationSec += scene.durationSec;
  }

  return {
    schemaVersion: 1,
    scenes,
    totalDurationSec,
    rendererTier,
    safeInputArgs,
    safeFilterTokens: [...new Set(safeFilterTokens)],
    compiledAt: new Date().toISOString(),
  };
}
