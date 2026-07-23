---
name: swarmxq-creative-director
description: >
  Governs all creative output quality for the SwarmXQ video generation subsystem.
  Owns script section quality gates ([HOOK]/[BODY]/[RESOLUTION]/[CTA]), the TONE_RULES
  map, virality scoring contract (ViralitySignal interface + weighted formula), caption
  generation rules (CAPTION_RULES), storyboard quality gates (scene count per length,
  comfyPrompt standards), hook pattern taxonomy, and platform-specific constraints
  (TikTok/Reels/YouTube Shorts). Use this skill for ANY change to video-orchestrator.ts
  that touches tone/script/storyboard prompt engineering, virality-scorer.ts,
  caption-generator.ts, or any TONE_RULES / VIRALITY_SCORE_RUBRIC / CAPTION_RULES
  constants. Triggers: "[HOOK]", "[BODY]", "[RESOLUTION]", "[CTA]", "hook pattern",
  "tone variant", "TONE_RULES", "virality score", "hookStrength", "completionProxy",
  "shareability", "seoScore", "ViralitySignal", "VIRALITY_SCORE_RUBRIC", "captionDraft",
  "CaptionDraft", "CAPTION_RULES", "soundSuggestion", "firstLine", "storyboard scene",
  "comfyPrompt", "scene count", "visual description", "motion descriptor", "pacing note",
  "faceless_broll", "kinetic_text", "scroll-stop", "pattern interrupt", "caption platform",
  "TikTok cap", "YouTube Shorts". Always load swarmxq-video-pipeline-architect alongside
  this skill — creative quality is enforced inside pipeline stage functions.
---

# SwarmXQ Creative Director

Creative quality is the product. A video that doesn't hook in 3 seconds failed —
regardless of how clean the TypeScript is. This skill encodes every creative constraint
that governs what SwarmXQ produces. Violations here are not bugs; they are unwatchable content.

Load this skill alongside `swarmxq-video-pipeline-architect` for any task touching
script prompts, tone routing, virality logic, or caption generation.

---

## Script Section Contracts — Non-Negotiable

The `scripting` stage produces exactly four labelled sections in order.
**Every rule below applies to every job, every tone, every topic.**

### [HOOK] — ≤ 18 Words

| Rule | Rationale |
|---|---|
| **Hard limit: 18 words. Count. Cut if over.** | Hooks are read in a 0.5-second thumb-stop window |
| Never starts with: "In today's video…", "Welcome to…", "Hi everyone…", "Today we…" | Preamble signals low-quality content; platforms algorithmically penalise it |
| Never starts with: "I", "My", "This video", "Let's", "We're going to" | Self-referential openers reduce scroll-stop power by ~40% |
| Opens with tension, stakes, or a surprising claim | Creates cognitive dissonance that compels viewing |
| Specific beats: a number, a named entity, a counterintuitive claim | Vagueness kills curiosity |

```
✅ CORRECT — contrarian tone, 12 words:
"Every senior engineer I know uses this trick. Most juniors never hear about it."

✗ WRONG — 22 words, preamble opener:
"In today's video, we're going to talk about a really interesting software engineering
pattern that a lot of engineers use."
```

### [BODY] — Stakes Escalation Pattern

- **Each sentence increases stakes or deepens understanding.** If deleting a sentence would not affect the content's value, delete it.
- Active voice only. Never: "it was discovered that…", "it can be seen that…"
- `[VISUAL: …]` tags are required after every factual claim or visual moment:
  - Format: `[VISUAL: subject + motion + setting + mood + quality keywords]`
  - Must be ComfyUI-ready: specific enough to pass directly to `generateLTXWorkflow()`
  - Wrong: `[VISUAL: a developer working]` → Correct: `[VISUAL: hands typing on mechanical keyboard, close-up, fast cuts, dark office, blue monitor glow, 720p]`
  - Background narrative sentences (no visual cue implied) do not need `[VISUAL:]`

### [RESOLUTION] — Action Frame

- 1–2 sentences maximum.
- Tells the viewer what they can **now do or know**. Not a summary. Not "So, in conclusion…"
- Ends with a sense of earned completion — the tension from [HOOK] resolves here.

### [CTA] — 5–8 Words, Specific

- Hard limit: 8 words. Count. Cut if over.
- Never: "like and subscribe", "hit that notification bell", "share if you found this useful"
- Must be specific to the content's audience and action:

```
✅ CORRECT:
"Send this to someone building in public."
"Try this before your next pitch."
"Grab the template linked below."

✗ WRONG:
"Like and subscribe for more content like this!"
"Share this video with your friends and family!"
```

---

## TONE_RULES Map

Every `VideoJobRequest.tone` variant **must** exist in `video-orchestrator.ts` `TONE_RULES`.
If a new tone variant is added to the `VideoJobRequest` type, add it here first.

| Tone | Prompt modifier | Background | Accent | Archetype |
|---|---|---|---|---|
| `contrarian` | Challenge consensus; use "Actually,…" and "Nobody tells you that…" framing; cite the counterintuitive evidence | `#0a0a0a` | `#ff2222` | Myth-buster |
| `urgent` | Short sentences; escalate every 2 seconds; present tense; "right now", "immediately", "this week" | `#150505` | `#ff6600` | Alarm |
| `educational` | Build understanding step by step; use analogies drawn from the viewer's domain; always answer "why does this matter?" | `#070e1a` | `#3399ff` | Professor |
| `cinematic` | Atmosphere-first; rich sensory description; story arc in every section; visual metaphors dominant | `#0c0c0c` | `#ddaa44` | Narrator |
| `warm` | Second-person direct address ("you"); encouraging; presuppose the viewer's success; conversational contractions | `#100805` | `#ff9966` | Mentor |
| `minimal` | Remove every non-essential word; zero filler; precision over warmth; trust the viewer's intelligence | `#000000` | `#ffffff` | Editor |
| `faceless_broll` | No on-camera presenter; all narration is voice-over; visuals carry the story; `[VISUAL:]` tags are mandatory on every sentence | `#0a0a0a` | `#cccccc` | Documentary |
| `kinetic_text` | Motion typography drives meaning; each `[VISUAL:]` specifies the text overlay and font style; minimal spoken narration | `#000000` | `#39ff14` | Kinetic |

> **Adding new tones:** Create a row in the table above first. Then add the matching
> `TONE_BACKGROUNDS` / `TONE_ACCENTS` entries in `ffmpeg-video-renderer.ts`. Finally,
> add the `TONE_RULES` entry in `video-orchestrator.ts`. In that order — never reverse.

---

## Hook Pattern Taxonomy

Reference these when writing or evaluating `[HOOK]` quality. Each pattern has a measurable
scroll-stop mechanism.

| Pattern | Mechanism | Example |
|---|---|---|
| **Counterintuitive Claim** | Violates expectation → creates cognitive dissonance | "The fastest code is usually the code you delete." |
| **Number Shock** | Specific number triggers credibility + curiosity | "93% of Lagos founders skip this FIRS step. Here's what it costs them." |
| **Named Villain** | Attributing a widespread problem to a specific cause | "This one legacy pattern is slowing down every Node.js app I audit." |
| **Identity Challenge** | Questions a belief the viewer holds about themselves | "If you can't explain this in 30 seconds, you're not senior yet." |
| **The Before/After Gap** | Implies a transformation the viewer wants | "Six months ago this took me 4 hours. Now it's 12 minutes." |
| **Forbidden Knowledge** | Framing as something suppressed or overlooked | "Nobody in bootcamps teaches this. Senior engineers use it every week." |
| **Stakes Escalation** | Opens with a consequence before the cause | "Your production server is probably losing 40% throughput right now." |

**Prohibited openers (expand `HOOK_BLOCKLIST` in `video-orchestrator.ts` with these):**

```typescript
const HOOK_BLOCKLIST: string[] = [
  "In today's video",
  "Welcome to",
  "Hi everyone",
  "Today we're going to",
  "Let's talk about",
  "In this video",
  "My name is",
  "Before we start",
  "Don't forget to",
  "Make sure to subscribe",
]
```

If the generated `[HOOK]` starts with any blocklisted phrase, the `scripting` stage
must regenerate — once, with an explicit "do not use preamble" reinforcement in the prompt.
After two failures, log at `warn` and pass the hook through with an error annotation for
the creative director to review.

---

## Virality Scoring Contract

`scoreVirality()` must return a complete `ViralitySignal`. The Oracle operator
(`reason-deepseekr1-pro-q5km-prod`) evaluates the full script + storyboard.

### Interface

```typescript
interface ViralitySignal {
  hookStrength:    number    // 0–1: scroll-stop power of first 3 seconds
  completionProxy: number    // 0–1: incentive to watch through to the end
  shareability:    number    // 0–1: triggers "this is so [person]" reaction
  seoScore:        number    // 0–1: per VIRALITY_SCORE_RUBRIC in virality-scorer.ts
  overall:         number    // weighted aggregate — see formula below
  recommendations: string[]  // 2–4 specific, actionable improvements (not "make it better")
  captionDraft:    CaptionDraft
}
```

### Weighted Formula — Non-Negotiable

```
overall = (hookStrength × 0.35) + (completionProxy × 0.25) + (shareability × 0.25) + (seoScore × 0.15)
```

Never change the weights without a documented A/B test result. Hook strength has the
highest weight because it gates all other engagement — zero completion if zero hooks.

### VIRALITY_SCORE_RUBRIC (in virality-scorer.ts)

Each dimension is scored against these anchors:

| Score | hookStrength | completionProxy | shareability |
|---|---|---|---|
| 0.9–1.0 | Hook matches a #1–3 pattern from taxonomy; ≤12 words; no preamble | Every sentence either raises stakes or deepens understanding; no filler | Directly names a specific community ("Lagos founders", "Next.js devs"); immediately relatable |
| 0.6–0.8 | Pattern-interrupting but not taxonomy-exact; 13–18 words | Mostly escalating; 1–2 filler sentences | Relatable to a broad category ("developers", "founders") |
| 0.4–0.5 | Some pattern; minor preamble; functional | Mostly informational; viewer might skip | Generic; applies to many but speaks to none specifically |
| 0.0–0.3 | Preamble opener or bland statement of topic | Filler-heavy; viewer would stop early | No identity signal; forgettable |

**`recommendations[]`** must be specific and actionable. Banned phrases:
- "make it more engaging" → instead: "Swap the opener for a Number Shock pattern citing the specific percentage"
- "improve the hook" → instead: "The hook starts with 'Let's talk about' — replace with counterintuitive claim using the Named Villain pattern"
- "add more value" → instead: "The [RESOLUTION] is a summary, not an action frame — tell the viewer what to do with this knowledge today"

---

## Caption Generation Contract

### CaptionDraft Interface

```typescript
interface CaptionDraft {
  firstLine:       string   // ≤40 chars; see opener rules below
  body:            string   // narrative; no hashtags here
  cta:             string   // call to action in caption; matches [CTA] section of script
  hashtags: {
    broad:    string[]     // 1–2 wide-reach tags (e.g., #buildinpublic, #devtips)
    niche:    string[]     // ≥1 specific community tag; NOT #fyp or #viral
    trending: string[]     // ≤1 verifiably trending tag; leave empty if uncertain
  }
  soundSuggestion: string  // no URLs, no artist names, no track IDs — describe audio only
}
```

### CAPTION_RULES (caption-generator.ts)

1. **`firstLine` ≤ 40 characters.** Characters, not words. Include spaces and punctuation.
2. **`firstLine` never starts with:** "I", "My", "This", "We", "Our" — enforced by regex at generation time.
3. **Hashtag totals: 3–5.** Never fewer than 3 (discoverability floor); never more than 5 (spam signal).
4. **≤1 trending tag.** If no verified trending tag is available, use 0. Never guess.
5. **At least 1 niche tag.** Never satisfy this with `#fyp`, `#viral`, `#foryou`, `#trending`.
6. **≤3 emojis in full caption** (firstLine + body + cta combined). Emojis in hashtags don't count.
7. **`soundSuggestion`** describes the audio mood only — no URLs, no artist attribution, no track IDs.
   - Wrong: "Use 'Blinding Lights' by The Weeknd (spotify:track:…)"
   - Correct: "Upbeat electronic with rising build, 120–130 BPM, suitable for fast-cut montage"

### Platform Character Caps

| Platform | Hard cap | Soft (in-feed) | Badge color |
|---|---|---|---|
| TikTok | 2 200 chars | 280 chars | neutral → amber (>200) → red (>2100) |
| Instagram Reels | 2 200 chars | 125 chars | neutral → amber (>110) → red (>2100) |
| YouTube Shorts | 5 000 chars | 300 chars | neutral → amber (>280) → red (>4900) |

The dashboard caption editor must show a badge for the **current platform's soft limit**
as the primary warning, and the hard cap as the error state. Never show only the hard cap —
most in-feed viewers see truncated captions at the soft limit.

---

## Storyboard Quality Gates

### Scene Count by Duration

| Job length | Duration | Min scenes | Max scenes |
|---|---|---|---|
| `short` | ≤45 s | 5 | 7 |
| `medium` | 46–120 s | 6 | 10 |
| `long` | 121–600 s | 11 | 18 |

If `storyboard_generation` produces scene counts outside the min/max range:
- Under minimum → fail with `STORYBOARD_FAILED` (insufficient visual coverage)
- Over maximum → truncate to max and log `warn` (never silently over-generate)

### Per-Scene Line Format

Every scene line **must** contain three components:

```
[Scene N] <Visual description> | <Motion descriptor> | <Pacing note>
```

1. **Visual description** — Specific to this script's content. Never stock-photo descriptions.
   - Wrong: "Person looking at a computer screen"
   - Correct: "Engineer at dual-monitor setup, left screen showing terminal with error stack trace, right showing Grafana dashboard with red spike, tight shot"
2. **Motion descriptor** — Camera movement or transition type
   - Options: `static wide`, `slow zoom in`, `fast pan left`, `drone pull-out`, `kinetic cut`, `cross-dissolve`, `match cut`, `whip pan`, `text overlay fly-in`
3. **Pacing note** — Temporal rhythm of this scene
   - Options: `fast cut (≤0.5s)`, `quick hold (1–2s)`, `standard hold (2–4s)`, `long hold (5s+)`, `slow fade`

### comfyPrompt Standard

`comfyPrompt` per scene must be ComfyUI-ready. Required keywords:
- Resolution: `720p` (16 GB) or `480p` (8 GB)
- Aspect: `16:9` or `9:16` (Shorts/TikTok)
- Style: at least one style keyword (`cinematic`, `documentary`, `kinetic typography`, `photorealistic`)
- Subject specificity: describe the exact subject, not a category

```
✅ CORRECT comfyPrompt:
"terminal screen close-up, Node.js error stack trace scrolling, blue monochrome, 
dark workspace, cinematic depth of field, 9:16, 720p, photorealistic, sharp"

✗ WRONG comfyPrompt:
"beautiful tech scene"
"developer working"
"error on screen"
```

---

## Visual Style Variants by Tone

### `faceless_broll` Visual Requirements

When tone is `faceless_broll`, every `[VISUAL:]` tag in `[BODY]` is mandatory — no exceptions.
The storyboard must generate **screen-captured interface shots, close-up hands, environmental
B-roll, and kinetic text** rather than on-camera subjects.

comfyPrompt for faceless_broll scenes:
```
"[scene content], no faces, no people, product shot / interface shot / hands-only / environment, 
cinematic, 720p, 9:16, [style keywords]"
```

### `kinetic_text` Visual Requirements

When tone is `kinetic_text`, each scene's `comfyPrompt` must include:
- Font style descriptor: `bold sans`, `condensed italic`, `mono`, `handwritten`
- Motion descriptor for the text: `text slam-in`, `text scale up`, `text wipe`, `letter reveal`
- Background must contrast with text: specified explicitly in comfyPrompt

```
✅ CORRECT for kinetic_text storyboard scene:
"[Scene 3] White bold sans text reads '93% miss this' | text scale up on black background, 
letter-by-letter reveal | fast cut (≤0.5s)"
comfyPrompt: "kinetic typography, 'NEVER TAUGHT THIS', Impact bold, white on pure black, 
text slam-in from bottom, motion blur trail, 9:16, 720p"
```

---

## Prompt Templates (Reference for Stage Prompts in video-orchestrator.ts)

These are the invariant structural constraints on the stage system prompts.
Never reduce specificity of tone instruction in the prompt template.

### Intent Classification Prompt Fragment

```
You are a creative intent classifier for short-form video. Output ONLY JSON.
Schema: {"intent": string, "complexity": number between 0 and 1}
intent: 3–8 word description of the video's core message
complexity: 0.0–0.3 (simple how-to), 0.4–0.6 (multi-step tutorial), 0.7–1.0 (nuanced argument)
Do not include any explanation. Output the JSON object only.
```

### Scripting Prompt Fragment

```
You are writing a short-form video script. Tone: [TONE].
[TONE_MODIFIER from TONE_RULES]

Format the output with EXACTLY these four section headers, each on its own line:
[HOOK]
<hook text — ≤18 words, NO opener starting with "In today's video", "Welcome", "Hi", "I", "My", "This">
[BODY]
<body text — each sentence increases stakes; use [VISUAL: subject + motion + setting + mood] after visual moments>
[RESOLUTION]
<1–2 actionable sentences; NOT a summary>
[CTA]
<5–8 words; specific; NOT "like and subscribe">

Do not add any text before [HOOK] or after [CTA].
```

### Storyboard Prompt Fragment

```
You are generating a visual storyboard for this script.
Produce exactly [N] scenes for a [LENGTH] video (≤45s: 5–7 scenes; 46–120s: 6–10 scenes; 121–600s: 11–18 scenes).

Each scene line: [Scene N] <visual description> | <motion descriptor> | <pacing note>
After each scene line, add:
comfyPrompt: "<ComfyUI-ready description including resolution, aspect ratio, style keywords>"

Visual descriptions must be specific to this script's actual content.
Never write generic stock descriptions like "person at desk" or "beautiful cityscape".
```

---

## Creative Quality Autonomous Scanning

While executing any milestone, scan for these violations:

### Critical (fix before committing anything else)
- `[HOOK]` generation prompt missing explicit word-count constraint → add ≤18 word limit
- `TONE_RULES` missing a variant that exists in `VideoJobRequest.tone` union → add the missing rule
- `HOOK_BLOCKLIST` not enforced in scripting stage → add check + regenerate logic
- Virality `overall` formula not matching `hookStrength×0.35 + completionProxy×0.25 + shareability×0.25 + seoScore×0.15` → revert to canonical
- `firstLine` regex not checking for "I"/"My"/"This"/"We"/"Our" openers → add validation

### High Impact (add to next session queue if found)
- `soundSuggestion` not validated for URL/artist patterns at generation time (only at scoring)
- `HOOK_BLOCKLIST` not surfaced in `env.ts` as an overridable constant
- `recommendations[]` returning generic phrases ("make it more engaging") instead of pattern-specific guidance
- Storyboard scene count not validated against job length before returning from `storyboard_generation` stage
- `comfyPrompt` per scene missing resolution/aspect/style keywords

### Medium Impact (log to memory note)
- Virality `overall` absent from job list API response (only in job detail)
- Dashboard `VideoJobCard` missing `viralitySignal.overall` score badge
- Platform-specific caption char counter not surfacing soft limit as primary warning
- New tone variant added to `VideoJobRequest.tone` without updating `TONE_BACKGROUNDS`/`TONE_ACCENTS`
