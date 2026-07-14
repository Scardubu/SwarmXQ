# SwarmX KV Cache — Deep Technical Reference
## Algorithms, Trade-offs, and Hardware-Specific Guidance

---

## What the KV Cache Actually Is

During transformer inference, each attention layer computes Query, Key, and Value tensors
for every token. In autoregressive generation, tokens are generated one at a time — but
the K and V tensors for all previous tokens must be recomputed on every step unless cached.

The KV cache stores these tensors between generation steps, converting O(n²) recomputation
into O(n) memory reads. Without it, a 7B model generating 512 tokens from a 4096-token
prompt would recompute 4096 × 512 = 2M attention operations per step.

**Trade-off**: Speed (avoid recomputation) for Memory (store K and V for all layers).

---

## KV Cache Size Formula

```
KV size (bytes) = n_layers × n_kv_heads × head_dim × seq_len × 2 × bytes_per_element

Where:
  2          = K tensor + V tensor
  bytes_per_element:
    f16  = 2 bytes  (full precision)
    q8_0 = 1 byte   (~50% reduction)
    q4_0 = 0.5 byte (~75% reduction)
```

### Applied to SwarmX models

**Qwen2.5-7B-Instruct** (GQA: 28 layers, 4 KV heads, head_dim 128):
```
@  8k, f16  : 28 × 4 × 128 ×  8192 × 2 × 2.0 = 375 MB
@  8k, q8_0 : 28 × 4 × 128 ×  8192 × 2 × 1.0 = 187 MB  ← supervisor default
@ 16k, q8_0 : 28 × 4 × 128 × 16384 × 2 × 1.0 = 374 MB
@ 32k, q8_0 : 28 × 4 × 128 × 32768 × 2 × 1.0 = 749 MB
@ 32k, q4_0 : 28 × 4 × 128 × 32768 × 2 × 0.5 = 374 MB
```

**Phi-4-mini** (GQA: 32 layers, 8 KV heads, head_dim 96):
```
@  8k, q4_0 : 32 × 8 × 96  ×  8192 × 2 × 0.5 = 201 MB  ← phi4-worker default
@ 16k, q4_0 : 32 × 8 × 96  × 16384 × 2 × 0.5 = 402 MB
@  4k, q4_0 : 32 × 8 × 96  ×  4096 × 2 × 0.5 = 100 MB  ← phi4-fast default
```

**DeepSeek-R1-Distill-Qwen-7B** (same architecture as Qwen2.5-7B):
```
@ 16k, q8_0 : 28 × 4 × 128 × 16384 × 2 × 1.0 = 374 MB  ← reasoner default
@ 20k, q8_0 : 28 × 4 × 128 × 20480 × 2 × 1.0 = 468 MB
@ 20k, q4_0 : 28 × 4 × 128 × 20480 × 2 × 0.5 = 234 MB  ← critic aggressive
```

---

## Quantization Algorithms Compared

### q8_0 — Block-wise 8-bit symmetric quantization

```
Algorithm:
  1. Split K/V tensor into 32-element blocks
  2. Find max(|x|) per block → scale factor
  3. Quantize: q = round(x / scale) → int8
  4. Store: 32 × int8 + 1 × float16 scale

Dequantization (during attention):
  x_approx = q × scale

Properties:
  - Quantization error: ~0.1–0.3% relative to f16
  - Memory: 1 byte/element + 1/32 overhead (≈ 1.0625 bytes effective)
  - Speed: faster than f16 on most tensor cores (8-bit ops)
  - Quality impact: imperceptible in practice for KV cache
  - Recommendation: USE for supervisor, reasoner — quality-sensitive roles
```

### q4_0 — Block-wise 4-bit symmetric quantization

```
Algorithm:
  1. Split into 32-element blocks
  2. Find max(|x|) per block → scale
  3. Quantize: q = round(x / scale) → nibble (4-bit, range -8 to +7)
  4. Pack 2 nibbles per byte
  5. Store: 16 × uint8 + 1 × float16 scale

Properties:
  - Quantization error: ~0.5–1.5% relative to f16
  - Memory: 0.5 bytes/element + overhead (≈ 0.5625 bytes effective)
  - Speed: slightly slower than q8_0 (packing/unpacking overhead)
  - Quality impact: ~1% on long-context reasoning, negligible on short tasks
  - Recommendation: USE for fast workers — speed/VRAM savings outweigh quality cost
```

### q4_1 — Block-wise 4-bit with bias term

```
Algorithm:
  Identical to q4_0, plus:
  - Stores min(x) per block as additional float16 bias
  - Allows non-zero-symmetric quantization (better for asymmetric distributions)

Properties:
  - Slightly better quality than q4_0 (~0.3% improvement)
  - Slightly higher memory than q4_0 (bias term adds ~3%)
  - Only available in some llama.cpp builds — verify Ollama support before using
  - Recommendation: prefer q4_0 unless quality difference is observed in evals
```

### f16 — Full precision (no quantization)

```
Properties:
  - Baseline quality
  - 2x memory vs q8_0
  - Only needed if: running quality-sensitive evals or KV quant causes visible degradation
  - On 12 GB VRAM: safe at 8k context, marginal at 16k, risky at 32k
  - Recommendation: USE only for eval baseline or debugging
```

---

## KV Cache Algorithms and Eviction Strategies

### 1. Full KV cache (Ollama default)

```
Description:
  All KV states for all context tokens are retained in VRAM for the
  duration of the generation call.

Behavior:
  - Pre-allocates KV memory for the full num_ctx at model load
  - No eviction — if context exceeds num_ctx, the call fails
  - Prefix reuse: Ollama reuses KV computation for shared prefixes across
    sequential calls to the same loaded model

When this is the right choice:
  - Always — for this hardware config, full KV cache is stable and simple
  - num_ctx is set conservatively in all Modelfiles to avoid OOM

SwarmX configuration:
  All Modelfiles use full KV cache.
  The num_ctx values are set well below the VRAM ceiling:
    supervisor:  12k (ceiling ~25k before OOM)
    worker:      8k  (ceiling ~32k before OOM for Phi-4-mini)
    fast:        4k  (ceiling ~32k — leaving huge headroom)
    reasoner:    16k (ceiling ~25k)
```

### 2. Sliding window attention (not used in SwarmX)

```
Description:
  Each token only attends to a local window of W tokens rather than all
  previous tokens. KV cache stores only W × layers × heads tensors.

Models that use it:
  Mistral 7B (window=4096), Gemma 2 (partial), Phi-3 (partial)

Status for our models:
  NONE of our three target models use sliding window attention.
  Qwen2.5, Phi-4-mini, and DeepSeek-R1-Distill-Qwen use full attention.
  → This technique is not applicable to SwarmX.
```

### 3. Prefix caching / prompt caching (relevant — Ollama supported)

```
Description:
  If multiple consecutive calls to the same model share an identical prefix
  (same tokens at the start of the context), Ollama reuses the cached KV
  computation for that prefix rather than recomputing it.

How it works in Ollama:
  - Ollama maintains a hash of the input prompt
  - If the first N tokens match the previous call exactly, the KV cache
    for those N tokens is retained and reused
  - Only works if the model is still loaded (OLLAMA_KEEP_ALIVE > 0)
  - The reused KV tokens show as "cached" in the eval_count response field

How SwarmX benefits:
  - Supervisor model: all calls share the same system prompt (fixed prefix)
    The system prompt KV computation is reused on every supervisor call
  - Worker model: the system prompt is short (~200 tokens) — small but free
  - Reasoner: system prompt is longer (~400 tokens) — still worth caching

Maximizing prefix cache hit rate:
  1. Keep system prompts IDENTICAL across calls (no dynamic content in system)
  2. Prepend shared context (task_id, compressed_memory) at the START of
     user messages, not the end — tokens must match from the beginning
  3. On larger hosts, use a short request-level keep_alive window for repeated
     calls. On the 8 GB profile, keep global OLLAMA_KEEP_ALIVE=0.
  4. Never modify the Modelfile system prompt at runtime

Monitoring prefix cache hits:
  Check Ollama response for: "prompt_eval_count" = 0
  Zero prompt eval tokens means the full prompt was served from cache.
```

### 4. KV compression via retrieval (experimental — not used in SwarmX)

```
Description:
  Instead of keeping all KV states in VRAM, compress old context into
  a retrieval index (e.g., vector DB) and re-inject relevant context
  on demand. Systems like LongLoRA, MemGPT, and Infini-Attention do this.

Status: EXPERIMENTAL — not available in stock Ollama.
  - Requires custom llama.cpp builds or dedicated frameworks
  - Not applicable to our Modelfile-based setup
  - SwarmX handles long context via memory compression in the orchestrator
    (see orchestrator.py _compress_memory()) — a simpler, reliable approach
```

### 5. Page-level KV cache (llama.cpp paged_kv_cache — partial support)

```
Description:
  llama.cpp implements a paged KV cache (similar to OS virtual memory)
  that allocates KV cache in fixed-size "pages" rather than a contiguous
  block. This enables more efficient memory use when sequences have
  variable lengths.

Status: Available in llama.cpp server mode.
  - In Ollama 0.4.x, paged KV cache is used internally for parallel requests
  - With OLLAMA_NUM_PARALLEL=1, the paging benefit is minimal
  - No user-facing parameter to tune in Modelfiles
  - Benefit: reduces VRAM fragmentation during model switching (relevant here)
```

---

## Practical KV Optimization Checklist

```
□ 1. Set OLLAMA_KV_CACHE_TYPE=q8_0 before starting Ollama
      → Verify in Ollama logs: "kv cache type = q8_0"

□ 2. Set OLLAMA_FLASH_ATTENTION=1
      → Reduces KV bandwidth pressure at 16k+ context

□ 3. Verify OLLAMA_MAX_LOADED_MODELS=1
      → Prevents KV cache from being split across two loaded models

□ 4. Keep global OLLAMA_KEEP_ALIVE=0 on 8 GB hosts
      → Request-level keep_alive controls short reuse without global pinning

□ 5. Keep num_ctx conservative (see Modelfile values)
      → KV memory pre-allocated at load — overly large num_ctx wastes VRAM
         even when context is short

□ 6. Prepend shared context at START of user messages
      → Maximizes prefix cache hit rate

□ 7. Monitor VRAM: watch -n 2 nvidia-smi
      → Check VRAM usage stays below 10 GB during inference
         (leaves headroom for KV allocation spikes)

□ 8. For 32k context experiments:
      → Use q4_0 KV, reduce num_batch to 256
      → Test only with Phi-4-mini (most headroom)
      → Do NOT attempt 32k with deepseek-critic (20k is already the ceiling)
```

---

## VRAM Budget Table (Production Config)

All values in MB. Models use q8_0 KV except phi4-worker and phi4-fast (q4_0).

```
Model               Weights   KV Cache   Overhead   Total    VRAM Left
─────────────────────────────────────────────────────────────────────────
qwen-supervisor     4,800      187        400        5,387    6,613
qwen-worker         4,800      187        400        5,387    6,613
phi4-worker         3,800      201        350        4,351    7,649
phi4-fast           3,800      100        350        4,250    7,750
deepseek-reasoner   4,800      374        400        5,574    6,426
deepseek-critic     4,800      468        400        5,668    6,332
─────────────────────────────────────────────────────────────────────────
VRAM budget: 12,000 MB (12 GB)
Conservative free headroom: 6,332 MB minimum
```

**Conclusion**: Every model configuration fits comfortably within 12 GB VRAM with
substantial headroom for KV growth, flash attention buffers, and driver overhead.
The system is not VRAM-constrained — it is RAM-constrained on the CPU side,
which is why ZRAM configuration matters.
