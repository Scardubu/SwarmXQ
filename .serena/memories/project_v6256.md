---
name: project_v6256
description: V6.2.56 - voice+text sync via word-weighted card timings, ambient sine-breathing motion backgrounds, drift/wobble panel motion, edge vignette bars; v3 golden re-rendered PRODUCTION_PACK_VALID
metadata:
  type: project
---

## Shipped - V6.2.56

### Voice + text sync

**File**: `apps/swarmx-api/src/services/ffmpeg-video-renderer.ts`

- Added `computeCardTimings(cards, duration)` helper. Card display windows
  are now weighted by word count with a 1.5 s minimum floor per card.
  A 17-word body line gets ~4.4 s of screen time while a 4-word CTA gets
  ~2.3 s — instead of every card getting an equal `duration/n` slot
  regardless of content.
- `buildFilterComplex()` and `buildTimedText()` now share a single
  `CardTiming[]` array. The drawtext overlay, `captions.srt`, and
  `captions.vtt` reference identical rounded-to-0.1 s boundaries so
  on-screen text and sidecar subtitles cannot drift apart.
- Both call sites (packaging + render) call `computeCardTimings` on the
  same raw `cards` list — the timing source of truth is single.

### Ambient motion backgrounds

**File**: `apps/swarmx-api/src/services/ffmpeg-video-renderer.ts`

- Added two full-height ambient glow layers (accent tone left, soft white
  right) whose width and horizontal position oscillate via `sin(t*1.6)`
  and `sin(t*1.6 + π)`. Alternating breathing gives kinetic scenes an
  organic pulse without stealing focus from the caption card.
- Two drifting panels now use `mod(t*V + A*sin(t*ω), N)` for linear + sine
  composite trajectories instead of pure linear scan — large motion feels
  wave-driven rather than robotic.
- Added top + bottom edge vignette bars (black @ 0.35, 6% of frame height).
  Cheaper and safer than FFmpeg's `vignette` filter on 4-core CPU while
  giving the same attention-focusing effect.
- Renderer tier scaling preserved: kinetic_text 0.09, faceless_broll 0.07,
  cinematic_explainer 0.06 — cinematic overlaid b-roll is never fought.

**FFmpeg invariant discovered**: `drawbox` alpha component (`color=X@Y`)
must be a literal number — it does not accept `t`-expressions like
`0.07+0.06*sin(t*1.6)`. Only `x`, `y`, `w`, `h` accept expressions.
Breathing was therefore implemented via position/size oscillation with
static alpha, not via alpha modulation.

### Artifact

- Regenerated `.swarmx/video/artifacts/golden-path/exports/video_first-video-v3.mp4`
  and package. Same 720x1280 H.264 @ 30 fps, 18.00 s.
- Size: 418.3 KB (up from 393.2 KB in V6.2.55 — richer motion adds ~6%).
- Certification: `PRODUCTION_PACK_VALID`.
- Caption SRT boundaries (per-card seconds):
    1. 0.0 - 2.9   (9 words)
    2. 2.9 - 5.8   (8 words)
    3. 5.8 - 8.7   (8 words)
    4. 8.7 - 11.3  (6 words)
    5. 11.3 - 15.7 (17 words - longest)
    6. 15.7 - 18.0 (4 words - CTA, shortest)

## Runtime Evidence

- Host: bare-metal Linux, 4 cores, 15 GiB RAM
- MemAvailable during regen: ~7 GB
- Kokoro TTS: healthy at 127.0.0.1:8888, provider recommendation unchanged

## Quality Gates

- `pnpm --filter @swarmx/api run typecheck` - passed
- `env SWARMX_HOME=/tmp/swarmxq-api-test-home pnpm --filter @swarmx/api run test` - 338 passed
- `env SWARMX_HOME=/tmp/swarmxq-regression-home pnpm --filter @swarmx/api run test:regression` - passed
- `pnpm --filter @swarmx/api exec tsx scripts/render-golden-path.ts` - passed, PRODUCTION_PACK_VALID
- `ffprobe` on v3 output - H.264 720x1280 30fps + AAC 48kHz stereo, 18.00 s
- `grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes` - zero hits

## Remaining Work

- M13 live-cert harness still requires API server + Ollama Pilot warm to run
  end-to-end. Deferred to next session.
- True per-word caption sync (whisper.cpp WER-based timing) still available
  as a P3 enhancement — current word-count weighting is a strong local
  approximation without needing STT round-trip.
- Kokoro exposes word-level timings in its OpenAI-compatible API endpoint;
  wiring those into `computeCardTimings` would replace the approximation
  with exact timings. Also deferred.
