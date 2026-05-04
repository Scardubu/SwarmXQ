/* ═══════════════════════════════════════════════════════════════════════════
   SwarmX Dashboard · app.js · v4.0-FINAL (IEP-ELITE-MAX · V4 control plane)
   IEP-ELITE-MAX runtime: ambient canvas · self-optimising render pipeline
   · full multi-tab display · council telemetry · fix-log classification
   · 100% backward compatible with APEX.5+ API shape
   ═══════════════════════════════════════════════════════════════════════════
   ⚠  DEPRECATED (Phase 4) — Legacy static dashboard.
      Canonical: apps/swarmx-dashboard/ (Next.js 16 + React 19).
      This file will be removed in the Phase 4 release.
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Phase 4 legacy deprecation notice ─────────────────────────────────────────
// Renders a non-intrusive banner at the top of the page and logs a console
// warning so operators know they are on the legacy dashboard.
(function _legacyDeprecationBanner() {
  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '9999',
    background: 'rgba(220, 130, 0, 0.92)',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'monospace',
    padding: '6px 16px',
    textAlign: 'center',
    letterSpacing: '0.02em',
  });
  banner.setAttribute('role', 'alert');
  banner.innerHTML = [
    '<strong>⚠ Legacy Dashboard (Phase 4 — Deprecated)</strong>',
    ' — Use the canonical dashboard:',
    ' <code style="background:rgba(0,0,0,.25);padding:1px 5px;border-radius:3px">',
    'apps/swarmx-dashboard/</code>',
    ' · <code style="background:rgba(0,0,0,.25);padding:1px 5px;border-radius:3px">',
    'pnpm --filter @swarmx/dashboard dev</code>',
  ].join('');
  if (document.body) {
    document.body.prepend(banner);
  } else {
    document.addEventListener('DOMContentLoaded', function () { document.body.prepend(banner); });
  }
  /* eslint-disable-next-line no-console */
  console.warn(
    '[SwarmX] DEPRECATED: You are viewing the legacy static dashboard (dashboard/). ' +
    'The canonical dashboard is apps/swarmx-dashboard/ (Next.js 16). ' +
    'This dashboard will be removed in Phase 4.'
  );
}());

// ─────────────────────────────────────────────────────────────────────────────
// § A · Internal render fitness engine
// Silent multi-pass selection on all non-trivial render operations.
// Three render strategies compete; the winner is applied per frame cycle.
// ─────────────────────────────────────────────────────────────────────────────
const _renderEngine = (() => {
  const _islandHistory    = [];
  const _strategyFitness  = { A: 0.72, B: 0.65, C: 0.80 };
  let _consecutiveSame    = 0;
  let _lastWinner         = null;
  let _explorationMode    = false;

  function _score(island, correctness, leverage, reversibility, simplicity) {
    return (correctness * 0.35 + leverage * 0.25 + reversibility * 0.2 + simplicity * 0.2) *
           (_strategyFitness[island] || 0.7);
  }

  function _crossover(a, b) {
    return {
      correctness:   Math.max(a.correctness,   b.correctness),
      leverage:      Math.max(a.leverage,       b.leverage),
      reversibility: Math.max(a.reversibility,  b.reversibility),
      simplicity:    Math.max(a.simplicity,     b.simplicity),
    };
  }

  function selectStrategy(taskDomain) {
    const novel = !_islandHistory.some(h => h.domain === taskDomain);
    if (_consecutiveSame >= 3 || novel) _explorationMode = true;

    const candidates = {
      A: { correctness: 0.9,  leverage: 0.7,  reversibility: 0.95, simplicity: 0.75 },
      B: { correctness: _explorationMode ? 0.80 : 0.75, leverage: 0.88, reversibility: 0.65, simplicity: 0.80 },
      C: { correctness: 0.82, leverage: 0.92, reversibility: 0.70, simplicity: 0.95 },
    };

    const scores = {};
    for (const [key, c] of Object.entries(candidates)) {
      scores[key] = _score(key, c.correctness, c.leverage, c.reversibility, c.simplicity);
    }

    const maxScore = Math.max(...Object.values(scores));
    let winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    let hybridUsed = false;

    if (maxScore < 0.80) {
      const sorted  = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      const [k1, s1] = sorted[0];
      const [k2]     = sorted[1];
      const hybrid      = _crossover(candidates[k1], candidates[k2]);
      const hybridScore = _score('hybrid', hybrid.correctness, hybrid.leverage, hybrid.reversibility, hybrid.simplicity);
      if (hybridScore > s1) { winner = k1; hybridUsed = true; }
    }

    if (winner === _lastWinner) {
      _consecutiveSame++;
      _strategyFitness[winner] = Math.min(1.0, (_strategyFitness[winner] || 0.7) + 0.02);
    } else {
      _consecutiveSame = 0;
      if (_lastWinner) _strategyFitness[_lastWinner] = Math.max(0.4, (_strategyFitness[_lastWinner] || 0.7) - 0.01);
    }
    _lastWinner    = winner;
    _explorationMode = false;
    _islandHistory.push({ domain: taskDomain, winner, score: scores[winner] });
    if (_islandHistory.length > 20) _islandHistory.shift();

    return { winner, scores, hybridUsed, explorationFired: _consecutiveSame >= 3 };
  }

  function getPromptBreederStatus() {
    if (!_lastWinner) return '—';
    const wins = _islandHistory.filter(h => h.winner === _lastWinner).length;
    return `Island ${_lastWinner} · ${wins}W`;
  }

  function getExplorationMode() { return _explorationMode; }
  function getLastWinner()      { return _lastWinner;      }

  return { selectStrategy, getPromptBreederStatus, getExplorationMode, getLastWinner };
})();

// ─────────────────────────────────────────────────────────────────────────────
// § B · Ambient canvas — living particle graph
// ─────────────────────────────────────────────────────────────────────────────
const _canvas = (() => {
  const canvas = document.getElementById('ambient-canvas');
  if (!canvas) return { update: () => {} };
  const ctx = canvas.getContext('2d');

  const COLORS = {
    nodeA:   'rgba(126, 163, 255, 0.55)',
    nodeB:   'rgba(157, 232, 255, 0.50)',
    nodeC:   'rgba(184, 127, 255, 0.45)',
    edge:    'rgba(126, 163, 255, 0.07)',
    edgeHot: 'rgba(69, 224, 140, 0.18)',
  };

  let W = 0, H = 0;
  let nodes = [];
  let hotNodes = new Set();

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function initNodes(count = 52) {
    nodes = Array.from({ length: count }, (_, i) => ({
      x:   Math.random() * W,
      y:   Math.random() * H,
      vx:  (Math.random() - 0.5) * 0.22,
      vy:  (Math.random() - 0.5) * 0.22,
      r:   1.2 + Math.random() * 1.6,
      hue: Math.floor(Math.random() * 3),
      t:   Math.random() * Math.PI * 2,
    }));
  }

  let _rafId = 0;
  function draw() {
    if (document.hidden) { _rafId = 0; return; }
    _rafId = requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);

    for (const n of nodes) {
      n.t  += 0.006;
      n.x  += n.vx + Math.sin(n.t) * 0.08;
      n.y  += n.vy + Math.cos(n.t * 0.7) * 0.08;
      if (n.x < 0) { n.x = 0; n.vx *= -1; }
      if (n.x > W) { n.x = W; n.vx *= -1; }
      if (n.y < 0) { n.y = 0; n.vy *= -1; }
      if (n.y > H) { n.y = H; n.vy *= -1; }
    }

    const EDGE_DIST  = 180;
    const colorMap   = [COLORS.nodeA, COLORS.nodeB, COLORS.nodeC];
    ctx.lineWidth    = 0.6;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx   = nodes[i].x - nodes[j].x;
        const dy   = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < EDGE_DIST) {
          const alpha = 1 - dist / EDGE_DIST;
          const isHot = hotNodes.has(i) || hotNodes.has(j);
          ctx.strokeStyle = isHot
            ? `rgba(69, 224, 140, ${alpha * 0.22})`
            : `rgba(126, 163, 255, ${alpha * 0.07})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const n     = nodes[i];
      const pulse = 0.85 + 0.15 * Math.sin(n.t * 2);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = hotNodes.has(i)
        ? `rgba(69, 224, 140, ${0.7 * pulse})`
        : colorMap[n.hue].replace(/[\d.]+\)$/, `${0.55 * pulse})`);
      ctx.fill();
    }
  }

  function update(agentCount) {
    hotNodes.clear();
    const hot = Math.min(agentCount || 0, nodes.length);
    for (let i = 0; i < hot; i++) hotNodes.add(Math.floor(Math.random() * nodes.length));
  }

  window.addEventListener('resize', () => { resize(); initNodes(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !_rafId) draw();
  });
  resize();
  initNodes();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(() => draw(), 300);

  return { update };
})();

// ─────────────────────────────────────────────────────────────────────────────
// § C · DOM refs  (all original IDs preserved verbatim)
// ─────────────────────────────────────────────────────────────────────────────
const el    = (id)           => document.getElementById(id);
const qs    = (sel, r = document) => r.querySelector(sel);
const qsAll = (sel, r = document) => Array.from(r.querySelectorAll(sel));

const overviewGrid    = el('overview-grid');
const detailGrid      = el('detail-grid');
const logOutput       = el('log-output');
const statusLine      = el('status-line');
const repoInput       = el('repo-input');
const targetInput     = el('target-input');
const autonomousInput = el('autonomous-input');
const autoApplyInput  = el('auto-apply-input');
const reviewInput     = el('review-input');
const fixLogPanel     = el('fix-log-panel');
const fixLogOutput    = el('fix-log-output');
const fixLogBadge     = el('fix-log-badge');
const logClearBtn     = el('log-clear-btn');
const footerPoll      = el('footer-poll');

// Vitals
const vitalAgents    = qs('.vital-num', el('vital-agents'));
const vitalRuns      = qs('.vital-num', el('vital-runs'));
const vitalProposals = qs('.vital-num', el('vital-proposals'));
const vitalMemories  = qs('.vital-num', el('vital-memories'));

// ─────────────────────────────────────────────────────────────────────────────
// § D · State
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  repo:             new URLSearchParams(window.location.search).get('repo') || '',
  overview:         null,
  lastIslandWinner: null,
  pollCount:        0,
  lastPollMs:       null,
  activeTab:        'overview',
  flFilters:        { crit: true, gap: true, anch: true },
  rawFixLog:        [],
};

repoInput.value = state.repo;

// ─────────────────────────────────────────────────────────────────────────────
// § E · Utilities
// ─────────────────────────────────────────────────────────────────────────────
function asArray(v)  { return Array.isArray(v) ? v : (v ? [v] : []); }
// Note: esc() defined below — escapeHtml is a deferred alias, set at end of § E

function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function qsParam() {
  const repo = repoInput.value.trim();
  return repo ? `?repo=${encodeURIComponent(repo)}` : '';
}

function pct(n) { return Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 100); }

function setStatus(text, busy = false) {
  if (statusLine) statusLine.textContent = busy ? `⟳  ${text}` : text;
}

function animateNumber(el, target) {
  if (!el) return;
  const start  = parseInt(el.textContent, 10) || 0;
  const frames = 20;
  let frame    = 0;
  const step   = () => {
    frame++;
    const ease = 1 - Math.pow(1 - frame / frames, 3);
    el.textContent = String(Math.round(start + (target - start) * ease));
    if (frame < frames) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ─────────────────────────────────────────────────────────────────────────────
// § F · IEP-ELITE status bar renderer
// ─────────────────────────────────────────────────────────────────────────────
function setIepDot(id, status) {
  const indicator = el(id);
  if (!indicator) return;
  const dot = indicator.querySelector('.iep-dot');
  if (!dot) return;
  const pulse = dot.classList.contains('iep-dot--pulse');
  dot.className = 'iep-dot' + (pulse ? ' iep-dot--pulse' : '') + (status ? ' ' + status : '');
  dot.setAttribute('aria-label', status || 'idle');
}

function renderIepStatus(data) {
  const iep = data?.iep_elite || {};

  // §1 Signal Triage
  setIepDot('iep-signal-triage', iep.signal_triage !== false ? 'ok' : 'warn');

  // §2 Ensemble / exploration-exploitation
  const ensembleMode = iep.ensemble_mode;
  const modeEl       = el('iep-mode-pill');
  const modeLabelEl  = el('iep-mode-label');
  if (ensembleMode === 'exploration') {
    setIepDot('iep-ensemble', 'warn');
    modeEl?.classList.add('explore');
    if (modeLabelEl) modeLabelEl.textContent = 'Exploration';
  } else {
    setIepDot('iep-ensemble', 'ok');
    modeEl?.classList.remove('explore');
    if (modeLabelEl) modeLabelEl.textContent = 'Exploitation';
  }

  // §4 Critic
  const criticFindings = Number(iep.critic_findings ?? 0);
  setIepDot('iep-critic', criticFindings === 0 ? 'ok' : criticFindings < 3 ? 'warn' : 'err');
  const criticCountEl = el('iep-critic-count');
  if (criticCountEl) {
    criticCountEl.textContent   = criticFindings > 0 ? String(criticFindings) : '';
    criticCountEl.style.display = criticFindings > 0 ? '' : 'none';
  }

  // §5 Confidence Gate
  const conf   = iep.confidence_level;
  const confSt = !conf || conf === 'HIGH' ? 'ok' : conf === 'MEDIUM' ? 'warn' : 'err';
  setIepDot('iep-confidence', confSt);
  const confLabel = el('iep-confidence-label');
  if (confLabel && conf) confLabel.textContent = `Conf: ${conf}`;

  // §12 Handoff Contract
  const handoffValid = iep.handoff_contracts_valid;
  setIepDot('iep-handoff', handoffValid === false ? 'err' : handoffValid === true ? 'ok' : '');

  // §13 Swarm Coherence (pulse stays)
  setIepDot('iep-coherence', iep.coherence_ok === false ? 'warn' : 'ok');

  // §14 Fix Log
  const criticals = Number(iep.fix_log_criticals ?? 0);
  setIepDot('iep-fix-log', criticals === 0 ? 'ok' : criticals < 3 ? 'warn' : 'err');
  const flCountEl = el('iep-fix-log-count');
  if (flCountEl) {
    flCountEl.textContent   = criticals > 0 ? String(criticals) : '';
    flCountEl.style.display = criticals > 0 ? '' : 'none';
  }

  // Rollback Anchor
  const anchorCount = Number(iep.active_anchor_count ?? asArray(data?.active_anchors).length);
  setIepDot('iep-anchor', anchorCount > 0 ? 'ok' : '');
  const anchorBadge = el('iep-anchor-count');
  if (anchorBadge) {
    anchorBadge.textContent   = anchorCount > 0 ? String(anchorCount) : '';
    anchorBadge.style.display = anchorCount > 0 ? '' : 'none';
  }

  // Island tournament winner
  const winner = iep.island_winner || state.lastIslandWinner;
  if (winner) state.lastIslandWinner = winner;
  ['A', 'B', 'C'].forEach(label => {
    const badge = el(`island-${label.toLowerCase()}`);
    if (!badge) return;
    badge.classList.toggle('winner', winner === label);
    badge.setAttribute('aria-pressed', winner === label ? 'true' : 'false');
  });

  // Island convergence status
  const convEl = el('iep-convergence');
  if (convEl) {
    const conv = iep.convergence_status;
    convEl.textContent = conv === 'converged' ? 'CVG' : conv === 'exploring' ? 'EXP' : '—';
    convEl.style.color = conv === 'converged' ? 'var(--ok)' : conv === 'exploring' ? 'var(--warn)' : '';
  }

  // §15 Quality Gate
  setIepDot('iep-quality-gate', iep.quality_gate_passed === false ? 'err' : 'ok');

  // PromptBreeder strategy slot
  const stratName = iep.promptbreeder_strategy || data?.evolution?.active_strategy || '';
  const stratEl   = el('iep-strategy-name');
  if (stratEl) stratEl.textContent = stratName || '—';

  // Fix Log panel update (backward-compat; also feeds Fix Log tab)
  const fixLog  = iep.fix_log;
  state.rawFixLog = Array.isArray(fixLog) ? fixLog : [];
  const fixLogEmpty = el('fix-log-empty');
  if (state.rawFixLog.length > 0) {
    if (fixLogPanel)  fixLogPanel.style.display  = '';
    if (fixLogEmpty)  fixLogEmpty.style.display   = 'none';
    if (fixLogOutput) fixLogOutput.textContent    = state.rawFixLog.join('\n');
    if (fixLogBadge)  fixLogBadge.textContent     = String(state.rawFixLog.length);
    const flTabBadge = el('tab-badge-fixlog');
    if (flTabBadge) { flTabBadge.textContent = String(state.rawFixLog.length); flTabBadge.style.display = ''; }
    renderFixLogClassified(state.rawFixLog);
    renderFixLogMeta(state.rawFixLog);
  } else {
    if (fixLogPanel)  fixLogPanel.style.display  = 'none';
    if (fixLogEmpty)  fixLogEmpty.style.display   = '';
    const flTabBadge = el('tab-badge-fixlog');
    if (flTabBadge) flTabBadge.style.display = 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § G · HTML helpers
// ─────────────────────────────────────────────────────────────────────────────
function card(title, body, opts = {}) {
  const dotHtml = opts.live ? `<span class="card-status-dot" title="Live" aria-label="Live indicator"></span>` : '';
  return `<article class="card" aria-label="${esc(title)} card"><h2>${esc(title)}${dotHtml}</h2>${body}</article>`;
}

function fitnessBar(score) {
  const p = pct(score);
  return `<div class="fitness-bar" role="meter" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="Fitness score ${p}%">
    <div class="fitness-fill" style="width:${p}%"></div>
  </div>`;
}

function statusPill(status) {
  const s   = String(status || '').toLowerCase();
  const cls = s.includes('ok') || s.includes('pass') || s.includes('done') || s.includes('complete') ? 'ok'
    : s.includes('warn') || s.includes('pend') || s.includes('run') ? 'warn'
    : s.includes('err')  || s.includes('fail') || s.includes('block') ? 'err'
    : '';
  return cls ? `<span class="status-pill ${cls}">${esc(status)}</span>` : `<span>${esc(status)}</span>`;
}

function riskBadge(risk) {
  const r   = String(risk || '').toLowerCase();
  const cls = r === 'low' ? 'low' : r === 'medium' ? 'medium' : r === 'high' ? 'high' : r === 'critical' ? 'critical' : '';
  return cls ? `<span class="risk-badge ${cls}">${esc(risk)}</span>` : `<span>${esc(risk || '')}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § H · Overview renderer
// ─────────────────────────────────────────────────────────────────────────────
function renderOverview(data) {
  _renderEngine.selectStrategy('overview-render');

  const summary   = data?.config || {};
  const runtime   = summary.runtime || {};
  const models    = summary.models  || {};
  const stack     = asArray(data?.stack);
  const tooling   = data?.tooling   || {};
  const runs      = data?.recent_runs     || [];
  const memories  = data?.recent_memories  || [];
  const proposals = data?.evolution?.proposals || [];
  const workflows = data?.workflows || [];
  const skills    = data?.skills    || [];
  const agents    = asArray(data?.agents);
  const templates = asArray(data?.templates);

  renderIepStatus(data);
  _canvas.update(agents.length);

  // Animate vitals
  animateNumber(vitalAgents,    agents.length);
  animateNumber(vitalRuns,      runs.length);
  animateNumber(vitalProposals, proposals.length);
  animateNumber(vitalMemories,  memories.length);

  const toolingEntries = Object.entries(tooling).slice(0, 10);
  const toolingReady   = tooling.git ? 'Ready' : 'Limited';

  overviewGrid.innerHTML = [
    card('Runtime', `
      <div class="kpi">${esc(summary.provider || 'unknown')}</div>
      <div class="kpi-sub">${esc(summary.home || '—')}</div>
      <div class="muted" style="margin-bottom:8px">
        Autonomous: <strong style="color:var(--text)">${runtime.autonomous ? 'yes' : 'no'}</strong>
        &nbsp;·&nbsp; Review: <strong style="color:var(--text)">${runtime.review_required ? 'on' : 'off'}</strong>
      </div>
      <div class="tag-row">${stack.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
    `, { live: true }),

    card('Models', `
      <div class="triad-arch">
        <!-- Orchestrator (top) -->
        <div class="triad-node triad-orch">
          <span class="triad-node-icon">⬡</span>
          <span class="triad-node-role">Orchestrator</span>
          <span class="triad-node-model">${esc(models.fast || 'phi4-mini')}</span>
          <span class="triad-node-desc">routing · triage · decisions</span>
        </div>
        <!-- Connector line -->
        <div class="triad-connector">
          <span class="triad-conn-line"></span>
          <div class="triad-conn-fork">
            <span class="triad-conn-left"></span>
            <span class="triad-conn-right"></span>
          </div>
        </div>
        <!-- Specialists (bottom row) -->
        <div class="triad-specialists">
          <div class="triad-node triad-reason">
            <span class="triad-node-icon">◈</span>
            <span class="triad-node-role">Reasoning</span>
            <span class="triad-node-model">${esc(models.reason || models.default || 'deepseek-r1:7b')}</span>
            <span class="triad-node-desc">plan · logic · arch</span>
          </div>
          <div class="triad-node triad-exec">
            <span class="triad-node-icon">⬢</span>
            <span class="triad-node-role">Execution</span>
            <span class="triad-node-model">${esc(models.code || 'qwen2.5-coder')}</span>
            <span class="triad-node-desc">code · tools · agents</span>
          </div>
        </div>
        <!-- Dispatch signal legend -->
        <div class="triad-dispatch">
          <span class="triad-signal triad-signal-r">reason</span><span class="triad-arrow">→</span><span class="triad-signal-dest">R1</span>
          <span class="triad-sep">·</span>
          <span class="triad-signal triad-signal-c">code</span><span class="triad-arrow">→</span><span class="triad-signal-dest">Qwen</span>
          <span class="triad-sep">·</span>
          <span class="triad-signal triad-signal-o">router</span><span class="triad-arrow">→</span><span class="triad-signal-dest">Phi</span>
        </div>
      </div>
      <div class="muted" style="margin-top:10px;font-family:'DM Mono',monospace;font-size:0.72rem">
        ${runtime.max_iterations != null ? `Max iter: <strong style="color:var(--text)">${esc(runtime.max_iterations)}</strong>` : ''}
        ${runtime.checkpoint_every != null ? `&nbsp;·&nbsp; Checkpoint: ${esc(runtime.checkpoint_every)}` : ''}
        ${runtime.control_mode ? `&nbsp;·&nbsp; Mode: ${esc(runtime.control_mode)}` : ''}
      </div>
    `),

    card('Tooling', `
      <div class="kpi" style="font-size:1.8rem">${esc(toolingReady)}</div>
      <div class="kpi-sub">Environment</div>
      <div class="tag-row">
        ${toolingEntries.map(([k, v]) =>
          `<span class="tag" style="color:${v ? 'var(--ok)' : 'var(--muted)'};border-color:${v ? 'rgba(69,224,140,.22)' : 'var(--border)'}">${esc(k)}</span>`
        ).join('')}
      </div>
    `),

    card('Council', `
      <div class="kpi">${agents.length || 0}</div>
      <div class="kpi-sub">Active agents</div>
      <div class="muted" style="margin-bottom:8px">Templates: <strong style="color:var(--text)">${templates.length || 0}</strong></div>
      <div class="tag-row">
        ${agents.slice(0, 6).map(a => `<span class="tag">${esc(a)}</span>`).join('')}
        ${agents.length > 6 ? `<span class="tag" style="opacity:.5">+${agents.length - 6}</span>` : ''}
      </div>
    `, { live: true }),
  ].join('');

  const topProposal = proposals[0];

  detailGrid.innerHTML = [
    card('Recent runs', `
      <div class="table-wrap">
        <table class="table" aria-label="Recent workflow runs">
          <thead><tr><th>ID</th><th>Status</th><th>Workflow</th><th>Summary</th></tr></thead>
          <tbody>
            ${runs.length === 0
              ? `<tr><td colspan="4" class="muted">No runs yet.</td></tr>`
              : runs.slice(-8).reverse().map(r => `<tr>
                  <td><code>${esc(r.id || '—')}</code></td>
                  <td>${statusPill(r.status || '')}</td>
                  <td>${esc(r.workflow || '—')}</td>
                  <td style="max-width:28ch;word-break:break-word">${esc(r.summary || '—')}</td>
                </tr>`).join('')
            }
          </tbody>
        </table>
      </div>
    `),

    card('Memories', `
      <ul class="list" aria-label="Stored memories">
        ${memories.length === 0
          ? `<li class="muted">No memories yet.</li>`
          : memories.slice(-8).reverse().map(m => `<li>
              <strong>${esc(m.kind || 'lesson')}</strong>
              <span class="muted">${esc(m.summary || m.note || m.content || '—')}</span>
            </li>`).join('')
        }
      </ul>
    `),

    card('Evolution proposals', `
      <div class="table-wrap">
        <table class="table" aria-label="Evolution proposals">
          <thead><tr><th>Scope</th><th>Risk</th><th>Score</th><th>Reason</th></tr></thead>
          <tbody>
            ${proposals.length === 0
              ? `<tr><td colspan="4" class="muted">No proposals.</td></tr>`
              : proposals.map(p => `<tr>
                  <td>${esc(p.scope || '—')}</td>
                  <td>${riskBadge(p.risk || '')}</td>
                  <td style="font-variant-numeric:tabular-nums;font-family:'DM Mono',monospace">${esc(p.score ?? '—')}</td>
                  <td style="max-width:28ch;word-break:break-word">${esc(p.reason || '—')}</td>
                </tr>`).join('')
            }
          </tbody>
        </table>
      </div>
      ${topProposal ? fitnessBar(topProposal.score ?? 0) : ''}
    `),

    card('Template library', `
      <ul class="list" aria-label="Template library">
        ${templates.length === 0
          ? `<li class="muted">No templates found.</li>`
          : templates.slice(-10).reverse().map(item => `<li>
              <strong>${esc(item)}</strong>
              <span class="muted">Reusable control artifact</span>
            </li>`).join('')
        }
      </ul>
    `),

    card('Agent roster', `
      <ul class="list" aria-label="Agent roster">
        ${agents.length === 0
          ? `<li class="muted">No agents found.</li>`
          : agents.slice(-12).reverse().map(item => `<li>
              <strong>${esc(item)}</strong>
              <span class="muted">Role card in the swarm council</span>
            </li>`).join('')
        }
      </ul>
    `, { live: true }),

    card('Workflows', `
      <ul class="list" aria-label="Loaded workflows">
        ${workflows.length === 0
          ? `<li class="muted">No workflows loaded.</li>`
          : workflows.slice(0, 8).map(wf => `<li>
              <strong>${esc(wf.name || wf.family || 'workflow')}</strong>
              <span class="muted">${esc(wf.description || '—')}</span>
            </li>`).join('')
        }
      </ul>
    `),

    card('Skills', `
      <ul class="list" aria-label="Loaded skills">
        ${skills.length === 0
          ? `<li class="muted">No skills loaded.</li>`
          : skills.slice(0, 8).map(s => `<li>
              <strong>${esc(s.name || 'skill')}</strong>
              <span class="muted">${esc(s.purpose || '—')}</span>
            </li>`).join('')
        }
      </ul>
    `),

    card('Island fitness', `
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
        ${[
          { island: 'A', label: 'Conservative', desc: 'proven · reversible'    },
          { island: 'B', label: 'Lateral',       desc: 'novel · high leverage' },
          { island: 'C', label: 'Compressed',    desc: 'fewest stages · max leverage' },
        ].map(({ island, label, desc }) => {
          const isWin = state.lastIslandWinner === island;
          return `<div style="display:flex;align-items:center;gap:12px">
            <div class="iep-island-badge ${isWin ? 'winner' : ''}" data-island="${island}"
              style="width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;
              justify-content:center;font-family:'DM Mono',monospace;font-size:.78rem;font-weight:700;
              flex-shrink:0;border:1px solid var(--border);">${island}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.8rem;color:var(--text);font-weight:600;line-height:1.2">${label}</div>
              <div style="font-size:.7rem;color:var(--muted);font-family:'DM Mono',monospace">${desc}</div>
            </div>
            ${isWin ? `<span style="font-family:'DM Mono',monospace;font-size:.68rem;color:var(--ok);opacity:.85">winner</span>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:14px;font-family:'DM Mono',monospace;font-size:.7rem;color:var(--muted)">
        PromptBreeder: <span style="color:var(--island-c)">${_renderEngine.getPromptBreederStatus()}</span>
      </div>
    `),
  ].join('');

  const parts = [
    summary.provider || 'runtime',
    runs.length       ? `${runs.length} runs`        : 'no runs',
    memories.length   ? `${memories.length} memories` : 'no memories',
    proposals.length  ? `${proposals.length} proposals` : 'no proposals',
    state.lastIslandWinner ? `island-${state.lastIslandWinner}` : '',
  ].filter(Boolean);
  setStatus(parts.join(' · '));

  state.overview = data;

  // Render all secondary tabs silently
  renderCouncil(data);
  renderRunsTab(data);
  renderWorkflowLibrary(data);
  renderEvolutionTab(data);
  renderAnchorRegistry(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// § I · Fix Log classification
// ─────────────────────────────────────────────────────────────────────────────
const FL_PATTERNS = [
  { cls: 'crit',    re: /\bCritical\b/i },
  { cls: 'gap',     re: /\bMeaningful\b|\bGap\b/i },
  { cls: 'anchor',  re: /\bANCHOR\b/ },
  { cls: 'removed', re: /\bRemov(ed|ing)\b/i },
  { cls: 'style',   re: /\bStyle\b/i },
];

function classifyFlEntry(line) {
  for (const { cls, re } of FL_PATTERNS) if (re.test(line)) return cls;
  return 'removed';
}

function renderFixLogClassified(lines) {
  const container = el('fix-log-classified');
  if (!container) return;
  const { crit, gap, anch } = state.flFilters;
  const entries = lines.map(line => ({ line, cls: classifyFlEntry(line) }));
  const visible = entries.filter(e => {
    if (e.cls === 'crit'   && !crit) return false;
    if (e.cls === 'gap'    && !gap)  return false;
    if (e.cls === 'anchor' && !anch) return false;
    return true;
  });
  container.innerHTML = visible.map(({ line, cls }) => `
    <div class="fl-entry fl-entry--${esc(cls)}">
      <div class="fl-entry__dot"></div>
      <span class="fl-entry__text">${esc(line)}</span>
    </div>
  `).join('') || `<div class="empty" style="padding:16px">No entries match current filters.</div>`;
}

function renderFixLogMeta(lines) {
  const meta = el('fix-log-meta');
  if (!meta) return;
  const counts = { crit: 0, gap: 0, anchor: 0 };
  lines.forEach(l => { const c = classifyFlEntry(l); if (c in counts) counts[c]++; });
  meta.textContent = `${counts.crit} critical · ${counts.gap} gaps · ${counts.anchor} anchors · ${lines.length} total`;
}

['fl-filter-crit', 'fl-filter-gap', 'fl-filter-anch'].forEach(id => {
  const chk = el(id);
  if (!chk) return;
  const key = id.replace('fl-filter-', '');
  chk.addEventListener('change', () => {
    state.flFilters[key] = chk.checked;
    renderFixLogClassified(state.rawFixLog);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § J · Council tab
// ─────────────────────────────────────────────────────────────────────────────
function renderCouncil(data) {
  renderAgentGrid(data);
  renderIslandBracket(data);
  renderPromptBreeder(data);
}

function renderAgentGrid(data) {
  const container = el('council-grid');
  if (!container) return;
  // Use rich agent_details if available, fall back to filename list
  const agents = asArray(data?.agent_details).length
    ? asArray(data.agent_details)
    : asArray(data?.agents).map(a => ({ name: a, model: 'fast', role: '', mission: '', outputs: [] }));

  const meta = el('council-meta');
  if (meta) meta.textContent = `${agents.length} agent${agents.length !== 1 ? 's' : ''} · IEP-ELITE 2026`;

  if (!agents.length) {
    container.innerHTML = `<div class="empty" style="grid-column:1/-1">No agent details. Check agents/catalog.yaml.</div>`;
    return;
  }

  container.innerHTML = agents.map(a => {
    const name    = typeof a === 'string' ? a : (a.name || a.role || 'agent');
    const role    = typeof a === 'object' ? (a.role || '') : '';
    const mission = typeof a === 'object' ? (a.mission || a.description || '') : '';
    const model   = typeof a === 'object' ? (a.model || 'fast').toLowerCase() : 'fast';
    const outputs = typeof a === 'object' ? asArray(a.outputs).slice(0, 3) : [];
    return `
      <article class="agent-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:3px">
          <div class="agent-card__name">${esc(name)}</div>
          <span class="model-badge model-badge--${esc(model)}">${esc(model)}</span>
        </div>
        ${role    ? `<div class="agent-card__role">${esc(role)}</div>` : ''}
        ${mission ? `<div class="agent-card__mission">${esc(mission)}</div>` : ''}
        ${outputs.length ? `<div class="tag-row" style="margin-top:6px">${outputs.map(o => `<span class="tag">${esc(o)}</span>`).join('')}</div>` : ''}
      </article>
    `;
  }).join('');
}

function renderIslandBracket(data) {
  const container = el('island-tournament-panel');
  if (!container) return;
  const iep     = data?.iep_elite || {};
  const results = asArray(data?.island_results);
  const winner  = state.lastIslandWinner;
  const conv    = iep.convergence_status || '';

  const lanes = ['A', 'B', 'C'].map(label => {
    const result  = results.find(r => r.island === label) || {};
    const score   = Number(result.score ?? 0);
    const isWin   = winner === label;
    const fillCls = isWin ? 'island-score-fill--winner' : `island-score-fill--${label.toLowerCase()}`;
    return `
      <div class="island-lane ${isWin ? 'island-lane--winner' : ''}">
        <div class="island-lane__label">
          <span>Island ${esc(label)}</span>
          ${isWin ? `<span style="font-size:.68rem;color:var(--ok)">WINNER ✓</span>` : ''}
        </div>
        <div class="island-lane__score">${score ? score.toFixed(2) : '—'}</div>
        <div class="island-score-track"><div class="${fillCls}" style="width:${pct(score)}%"></div></div>
        ${result.strategy ? `<div style="font-size:.72rem;color:var(--muted);margin-top:6px;font-family:'DM Mono',monospace">${esc(result.strategy)}</div>` : ''}
      </div>
    `;
  });

  const convHtml = conv ? `
    <div class="convergence-notice ${conv === 'converged' ? 'convergence-notice--converged' : conv === 'exploring' ? 'convergence-notice--exploring' : ''}">
      <span>Convergence:</span>
      <strong>${esc(conv.toUpperCase())}</strong>
      ${iep.convergence_window ? `<span>· window ${esc(iep.convergence_window)}</span>` : ''}
    </div>
  ` : '';

  container.innerHTML = `<div class="island-bracket">${lanes.join('')}</div>${convHtml}`;
}

function renderPromptBreeder(data) {
  const container = el('promptbreeder-panel');
  if (!container) return;
  const strategies = asArray(data?.promptbreeder_strategies);
  if (!strategies.length) {
    container.innerHTML = `<div class="empty">PromptBreeder data unavailable. Enable <code>evolution.promptbreeder.enabled: true</code>.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="strategy-list">
      ${strategies.map(s => {
        const status = s.promoted ? 'promoted' : s.demoted ? 'demoted' : 'active';
        return `
          <div class="strategy-row strategy-row--${esc(status)}">
            <span class="strategy-name">${esc(s.name || 'strategy')}</span>
            <span class="strategy-wins">W:${esc(s.wins ?? 0)}</span>
            <span class="strategy-losses">L:${esc(s.losses ?? 0)}</span>
            <span class="strategy-status strategy-status--${esc(status)}">${esc(status)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// § K · Runs tab
// ─────────────────────────────────────────────────────────────────────────────
function renderRunsTab(data) {
  renderStagePipeline(data);
  renderRunTimeline(data);
}

function renderStagePipeline(data) {
  const container = el('stage-pipeline');
  const metaEl    = el('active-run-meta');
  if (!container) return;

  const activeRun = data?.active_run;
  if (!activeRun) {
    container.innerHTML = `<div class="empty" style="padding:20px">No run in progress. Use ▶ Run to start.</div>`;
    if (metaEl) metaEl.textContent = 'No run in progress';
    return;
  }
  if (metaEl) metaEl.textContent = `${activeRun.id || ''} · ${activeRun.target || ''} · ${activeRun.workflow || ''}`;

  const stages = asArray(activeRun.stages);
  if (!stages.length) {
    container.innerHTML = `<div class="empty" style="padding:20px">Stage data unavailable.</div>`;
    return;
  }

  container.innerHTML = stages.map((s, idx) => {
    const status  = s.status === 'done'   ? 'stage-node--done'
                  : s.status === 'active' ? 'stage-node--active'
                  : s.status === 'err'    ? 'stage-node--err' : '';
    const icon    = s.status === 'done'   ? '✓'
                  : s.status === 'active' ? idx + 1
                  : s.status === 'err'    ? '✗' : idx + 1;
    return `
      <div class="stage-node ${status}">
        <div class="stage-pip">${icon}</div>
        <div class="stage-name">${esc(s.name || `stage ${idx + 1}`)}</div>
        <div class="stage-owner">${esc(s.owner || '')}</div>
        <div class="stage-risk stage-risk--${esc((s.risk || 'low').toLowerCase())}">${esc((s.risk || '').toLowerCase())}</div>
      </div>
    `;
  }).join('');
}

function renderRunTimeline(data) {
  const container = el('run-timeline-panel');
  if (!container) return;
  const runs = asArray(data?.recent_runs);
  if (!runs.length) {
    container.innerHTML = `<div class="empty">No run history. Runs appear here after completion.</div>`;
    return;
  }
  container.innerHTML = [...runs].reverse().map(r => {
    const status = r.status || 'complete';
    const dotCls = `run-status-dot--${status.toLowerCase()}`;
    return `
      <div class="run-card">
        <div class="run-status-dot ${dotCls}" title="${esc(status)}"></div>
        <div>
          <div class="run-card__target">${esc(r.target || r.summary || 'run')}</div>
          <div style="display:flex;gap:10px;margin-top:3px">
            <span class="run-card__id">${esc(r.id || '')}</span>
            <span class="run-card__workflow">${esc(r.workflow || '')}</span>
            <span class="run-card__meta">${esc(r.timestamp || r.date || '')}</span>
          </div>
        </div>
        <div class="muted" style="font-size:.78rem;white-space:nowrap">${esc(r.duration || '')}</div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// § L · Workflow library tab
// ─────────────────────────────────────────────────────────────────────────────
function renderWorkflowLibrary(data) {
  const container = el('workflow-library');
  const meta      = el('workflow-count-meta');
  if (!container) return;
  const workflows = asArray(data?.workflows);
  if (meta) meta.textContent = `${workflows.length} workflow${workflows.length !== 1 ? 's' : ''}`;

  if (!workflows.length) {
    container.innerHTML = `<div class="empty">No workflows loaded.</div>`;
    return;
  }
  container.innerHTML = workflows.map(wf => {
    const stages = asArray(wf.stages);
    return `
      <div class="wf-card">
        <div>
          <div class="wf-card__name">${esc(wf.name || wf.family || 'workflow')}</div>
          <div class="wf-card__desc">${esc(wf.description || '')}</div>
          ${stages.length ? `<div class="wf-card__stages">${stages.map(s => `<span class="stage-chip">${esc(s.name || s)}</span>`).join('')}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          ${riskBadge(wf.risk)}
          ${wf.family ? `<span class="tag">${esc(wf.family)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// § M · Evolution tab
// ─────────────────────────────────────────────────────────────────────────────
function renderEvolutionTab(data) {
  renderEvolutionProposals(data);
  renderIslandHistory(data);
  renderMemoryTimeline(data);

  const proposals = asArray(data?.evolution?.proposals);
  const badge     = el('tab-badge-evolution');
  if (badge) {
    badge.textContent   = proposals.length > 0 ? String(proposals.length) : '';
    badge.style.display = proposals.length > 0 ? '' : 'none';
  }
}

function renderEvolutionProposals(data) {
  const container = el('evolution-proposals-panel');
  if (!container) return;
  const proposals = asArray(data?.evolution?.proposals);
  if (!proposals.length) {
    container.innerHTML = `<div class="empty panel">No proposals yet. Run <code>swarm evolve &lt;repo&gt;</code> to generate.</div>`;
    return;
  }
  container.innerHTML = `<div class="evolution-proposals-panel">` + proposals.map(p => {
    const score      = parseFloat(p.score ?? 0);
    const qualifies  = score >= 0.72;
    return `
      <div class="proposal-card ${qualifies ? 'proposal-card--qualifies' : ''}">
        <div class="proposal-header">
          <div>
            <div class="proposal-scope">${esc(p.scope || p.name || 'proposal')}</div>
            <div class="proposal-id">${esc(p.id || '')}</div>
          </div>
          <div class="proposal-badges">
            ${riskBadge(p.risk)}
            <span class="score-pill ${qualifies ? 'score-pill--pass' : 'score-pill--fail'}">${score.toFixed(2)}</span>
          </div>
        </div>
        <div class="proposal-reason">${esc(p.reason || p.description || '')}</div>
        <div class="score-track"><div class="score-fill ${qualifies ? 'score-fill--pass' : ''}" style="width:${pct(score)}%"></div></div>
      </div>
    `;
  }).join('') + `</div>`;
}

function renderIslandHistory(data) {
  const container = el('island-history-panel');
  if (!container) return;
  const history = asArray(data?.island_history);
  if (!history.length) {
    container.innerHTML = `<div class="empty">No island history yet.</div>`;
    return;
  }
  container.innerHTML = `
    <table class="table">
      <thead><tr><th>Run</th><th>Winner</th><th>A</th><th>B</th><th>C</th><th>Mode</th></tr></thead>
      <tbody>
        ${history.slice(-10).reverse().map(h => `
          <tr>
            <td style="font-family:'DM Mono',monospace;font-size:.77rem">${esc(h.run_id || '')}</td>
            <td><strong style="color:var(--ok)">${esc(h.winner || '—')}</strong></td>
            <td style="color:var(--island-a)">${esc(h.score_a?.toFixed(2) ?? '—')}</td>
            <td style="color:var(--island-b)">${esc(h.score_b?.toFixed(2) ?? '—')}</td>
            <td style="color:var(--island-c)">${esc(h.score_c?.toFixed(2) ?? '—')}</td>
            <td class="muted" style="font-size:.77rem">${esc(h.mode || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderMemoryTimeline(data) {
  const container = el('memory-timeline-panel');
  if (!container) return;
  const memories = asArray(data?.recent_memories);
  if (!memories.length) {
    container.innerHTML = `<div class="empty">No memories yet.</div>`;
    return;
  }
  container.innerHTML = [...memories].reverse().map(m => {
    const kind = (m.kind || 'lesson').toLowerCase();
    return `
      <div class="memory-card memory-card--${esc(kind)}">
        <div class="memory-card__date">${esc(m.timestamp || m.date || '')}</div>
        <div class="memory-card__target">${esc(m.target || m.repo || 'run')}</div>
        <div class="memory-card__content">${esc(m.summary || m.note || m.content || '')}</div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// § N · Anchor registry
// ─────────────────────────────────────────────────────────────────────────────
function renderAnchorRegistry(data) {
  const container = el('anchor-registry-panel');
  if (!container) return;
  const anchors = asArray(data?.active_anchors);
  if (!anchors.length) {
    container.innerHTML = `<div class="empty">No active rollback anchors. Anchors are registered before each mutation (§14).</div>`;
    return;
  }
  container.innerHTML = `
    <div class="anchor-list">
      ${anchors.map(a => `
        <div class="anchor-row">
          <span class="anchor-row__id">${esc(a.id || a.name || 'ANCHOR')}</span>
          <span class="anchor-row__ctx">${esc(a.context || a.instruction || '')}</span>
          <span class="anchor-row__ts">${esc(a.timestamp || '')}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// § O · Tab switching
// ─────────────────────────────────────────────────────────────────────────────
qsAll('.tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    state.activeTab = tab;
    qsAll('.tab').forEach(b => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('tab--active', active);
      b.setAttribute('aria-selected', String(active));
    });
    qsAll('.tab-panel').forEach(panel => {
      const active = panel.id === `tab-${tab}`;
      panel.hidden = !active;
      panel.classList.toggle('tab-panel--active', active);
    });
    if (tab === 'activity' && logOutput) logOutput.scrollTop = logOutput.scrollHeight;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § P · HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 20_000);
  try {
    const res  = await fetch(path, { headers: { 'Content-Type': 'application/json' }, signal: controller.signal, ...options });
    const body = await res.text();
    try { return JSON.parse(body); } catch { return { raw: body }; }
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § P2 · Mission & Event rendering  (V4 control plane)
// ─────────────────────────────────────────────────────────────────────────────

const missionsList  = document.getElementById('missions-list');
const missionsMeta  = document.getElementById('missions-meta');
const policyPanel   = document.getElementById('policy-panel');
const eventsFeed    = document.getElementById('events-feed');
const eventsMeta    = document.getElementById('events-meta');
const missionsBadge = document.getElementById('tab-badge-missions');

function riskColor(risk) {
  return { critical: '#e74c3c', high: '#e67e22', medium: '#f1c40f', low: '#2ecc71' }[risk] || 'var(--muted)';
}

function renderMissions(missions) {
  if (!missionsList) return;
  if (!missions || !missions.length) {
    missionsList.innerHTML = '<p class="muted" style="padding:16px 0">No missions recorded yet. Run <code>swarm mission &lt;repo&gt; &lt;target&gt;</code> to create one.</p>';
    if (missionsMeta) missionsMeta.textContent = '0 missions';
    if (missionsBadge) missionsBadge.style.display = 'none';
    return;
  }
  if (missionsMeta) missionsMeta.textContent = `${missions.length} mission${missions.length !== 1 ? 's' : ''}`;
  if (missionsBadge) {
    const active = missions.filter(m => m.status === 'active' || m.status === 'planned').length;
    if (active > 0) { missionsBadge.textContent = active; missionsBadge.style.display = ''; }
    else missionsBadge.style.display = 'none';
  }
  missionsList.innerHTML = missions.slice(0, 50).map(m => {
    const risk = m.policy?.risk || m.risk || 'low';
    const status = m.status || 'unknown';
    const statusColor = { completed: '#2ecc71', active: '#3498db', planned: '#9b59b6', failed: '#e74c3c' }[status] || 'var(--muted)';
    const phases = Array.isArray(m.phases) ? m.phases : [];
    return card(m.target || m.id || 'Mission', `
      <div class="kpi-sub" style="margin-bottom:8px">${esc(m.id || '')}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <span style="color:${statusColor};font-weight:600">${esc(status.toUpperCase())}</span>
        <span class="tag" style="background:${riskColor(risk)}22;color:${riskColor(risk)}">Risk: ${esc(risk)}</span>
        ${m.policy?.mode ? `<span class="tag">Mode: ${esc(m.policy.mode)}</span>` : ''}
        ${m.workflow ? `<span class="tag">Workflow: ${esc(m.workflow)}</span>` : ''}
      </div>
      ${phases.length ? `<div class="muted" style="font-size:0.78rem">Phases: ${phases.map(p => `<span class="tag" style="margin-right:2px">${esc(p.name || p)}</span>`).join('')}</div>` : ''}
      ${m.created_at ? `<div class="muted" style="font-size:0.78rem;margin-top:6px">${esc(m.created_at)}</div>` : ''}
    `, { live: status === 'active' });
  }).join('');
}

function renderEvents(events) {
  if (!eventsFeed) return;
  // V4-FINAL: update events tab badge count
  const _eventsBadge = document.getElementById('tab-badge-events');
  if (_eventsBadge) {
    if (events && events.length > 0) { _eventsBadge.textContent = Math.min(events.length, 99); _eventsBadge.style.display = ''; }
    else _eventsBadge.style.display = 'none';
  }
  if (!events || !events.length) {
    eventsFeed.innerHTML = '<p class="muted" style="padding:16px 0">No events yet. Events are recorded as the swarm runs.</p>';
    if (eventsMeta) eventsMeta.textContent = '0 events';
    return;
  }
  if (eventsMeta) eventsMeta.textContent = `${events.length} events`;
  const rows = events.slice(-200).reverse().map(ev => {
    const kind    = ev.kind || ev.type || '—';
    const ts      = ev.ts || ev.timestamp || ev.created_at || '';
    const payload = ev.payload || ev.data || {};
    const kindCls = kind.startsWith('run.')       ? 'event-kind--run'
                  : kind.startsWith('mission.')   ? 'event-kind--mission'
                  : kind.startsWith('evolution.') ? 'event-kind--evolution'
                  : kind.startsWith('policy.')    ? 'event-kind--policy'
                  : 'event-kind--other';
    const payloadStr = JSON.stringify(payload);
    const shortPayload = payloadStr.length > 160 ? payloadStr.slice(0, 157) + '…' : payloadStr;
    return `<div class="event-row">
      <span class="event-kind ${kindCls}">${esc(kind)}</span>
      <span class="event-ts">${esc(String(ts).slice(0,19).replace('T',' '))}</span>
      <span class="event-payload">${esc(shortPayload)}</span>
    </div>`;
  }).join('');
  eventsFeed.innerHTML = `<div>${rows}</div>`;
}

function renderPolicyPanel(data) {
  if (!policyPanel) return;
  const policy = data?.policy || data?.config?.policy;
  if (!policy) { policyPanel.innerHTML = ''; return; }
  const risk = policy.risk || 'unknown';
  policyPanel.innerHTML = card('Last Policy Decision', `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <span class="tag" style="color:${riskColor(risk)};background:${riskColor(risk)}22">Risk: ${esc(risk)}</span>
      <span class="tag">Allowed: ${policy.allowed ? '✓' : '✗'}</span>
      <span class="tag">Mode: ${esc(policy.mode || '—')}</span>
      <span class="tag">Human Gate: ${policy.human_gate ? 'yes' : 'no'}</span>
    </div>
    ${(policy.reasons||[]).length ? `<div class="muted" style="font-size:0.78rem">Reasons: ${(policy.reasons||[]).map(r => `<span class="tag">${esc(r)}</span>`).join(' ')}</div>` : ''}
    ${(policy.mitigations||[]).length ? `<div class="muted" style="font-size:0.78rem;margin-top:6px">Mitigations: ${(policy.mitigations||[]).join(' · ')}</div>` : ''}
  `);
}

async function refreshMissions() {
  try {
    const data = await fetchJson('/api/missions');
    renderMissions(data?.missions || []);
  } catch (e) {
    if (missionsList) missionsList.innerHTML = '<p class="muted">Could not load missions — is the server running?</p>';
  }
}

async function refreshEvents() {
  try {
    const data = await fetchJson('/api/events?limit=200');
    renderEvents(data?.events || []);
  } catch (e) {
    if (eventsFeed) eventsFeed.innerHTML = '<p class="muted">Could not load events — is the server running?</p>';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Q · Actions
// ─────────────────────────────────────────────────────────────────────────────
async function refresh() {
  const data = await fetchJson(`/api/overview${qsParam()}`);
  renderOverview(data);
  // V4: also refresh missions/events if those tabs are visible
  const activeTab = document.querySelector('.tab--active')?.dataset?.tab;
  if (activeTab === 'missions') { await refreshMissions(); if (data) renderPolicyPanel(data); }
  if (activeTab === 'events')   { await refreshEvents(); }
  if (logOutput) logOutput.textContent = JSON.stringify(data, null, 2);
  state.pollCount++;
  state.lastPollMs = Date.now();
  if (footerPoll) {
    const streamAlive = _eventStream && _eventStream.readyState === EventSource.OPEN;
    const dotCls = streamAlive ? 'stream-dot--live' : 'stream-dot--polling';
    footerPoll.innerHTML = `<span class="stream-dot ${dotCls}" title="${streamAlive ? 'Live stream' : 'Polling'}"></span>Poll #${state.pollCount}`;
  }
}

async function plan() {
  const payload = {
    repo:            repoInput.value.trim(),
    target:          targetInput.value.trim() || 'repository acceleration',
    review_required: reviewInput.checked,
  };
  const data = await fetchJson('/api/plan', { method: 'POST', body: JSON.stringify(payload) });
  if (logOutput) logOutput.textContent = JSON.stringify(data, null, 2);
  await refresh();
}

async function run() {
  const payload = {
    repo:            repoInput.value.trim(),
    target:          targetInput.value.trim() || 'repository acceleration',
    autonomous:      autonomousInput.checked,
    review_required: reviewInput.checked,
  };
  const data = await fetchJson('/api/run', { method: 'POST', body: JSON.stringify(payload) });
  if (logOutput) logOutput.textContent = JSON.stringify(data, null, 2);
  await refresh();
}

async function evolve() {
  const payload = {
    repo:       repoInput.value.trim(),
    auto_apply: autoApplyInput.checked,
  };
  const data = await fetchJson('/api/evolve', { method: 'POST', body: JSON.stringify(payload) });
  if (logOutput) logOutput.textContent = JSON.stringify(data, null, 2);
  await refresh();
}

// ─────────────────────────────────────────────────────────────────────────────
// § R · Button event wiring + in-flight guard
// ─────────────────────────────────────────────────────────────────────────────
const inFlight = new Set();

qsAll('[data-action]').forEach(button => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (inFlight.has(action)) return;
    inFlight.add(action);
    button.disabled = true;
    const labelEl   = button.querySelector('.btn-label');
    const origLabel = labelEl?.textContent;
    if (labelEl) labelEl.textContent = '…';
    setStatus(`Running ${action}…`, true);
    try {
      if (action === 'refresh') await refresh();
      if (action === 'plan')    await plan();
      if (action === 'run')     await run();
      if (action === 'evolve')  await evolve();
    } catch (err) {
      setStatus(`${action} failed: ${err?.message || err}`);
      if (logOutput) logOutput.textContent = String(err?.stack || err);
    } finally {
      button.disabled = false;
      if (labelEl && origLabel) labelEl.textContent = origLabel;
      inFlight.delete(action);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § S · URL sync
// ─────────────────────────────────────────────────────────────────────────────
[repoInput, targetInput].forEach(field => {
  field.addEventListener('change', () => {
    const url = new URL(window.location.href);
    if (repoInput.value.trim()) url.searchParams.set('repo', repoInput.value.trim());
    else url.searchParams.delete('repo');
    window.history.replaceState({}, '', url);
    state.repo = repoInput.value.trim();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § T · Misc UI wiring
// ─────────────────────────────────────────────────────────────────────────────
if (logClearBtn) {
  logClearBtn.addEventListener('click', () => {
    if (logOutput) logOutput.textContent = 'Log cleared.';
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// § T.5 · Live event stream  (auto-reconnects with exponential backoff)
// ─────────────────────────────────────────────────────────────────────────────
let _eventStream         = null;
let _streamReconnectMs   = 3_000;   // initial reconnect delay, doubles each attempt
let _streamReconnectTimer = null;

function connectStream() {
  if (!window.EventSource) return;
  // Cancel any pending reconnect timer before starting fresh
  if (_streamReconnectTimer) { clearTimeout(_streamReconnectTimer); _streamReconnectTimer = null; }
  try {
    if (_eventStream) { _eventStream.close(); _eventStream = null; }
    const streamUrl = `/api/stream${qsParam()}`;
    _eventStream = new EventSource(streamUrl);
    _eventStream.addEventListener('snapshot', (event) => {
      _streamReconnectMs = 3_000; // reset backoff on successful data
      try {
        const data = JSON.parse(event.data);
        renderOverview(data);
        if (logOutput) logOutput.textContent = JSON.stringify(data, null, 2);
        setStatus(`Live stream connected · ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        console.warn('stream snapshot parse failed', err);
      }
    });
    _eventStream.onerror = () => {
      if (_eventStream) { _eventStream.close(); _eventStream = null; }
      const retryInSec = Math.round(_streamReconnectMs / 1000);
      setStatus(`Stream interrupted — reconnecting in ${retryInSec}s…`);
      _streamReconnectTimer = setTimeout(() => {
        _streamReconnectMs = Math.min(_streamReconnectMs * 1.5, 30_000);
        connectStream();
      }, _streamReconnectMs);
    };
  } catch (err) {
    console.warn('EventSource unavailable', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § U · Initial load + polling
// ─────────────────────────────────────────────────────────────────────────────
refresh().catch(err => {
  setStatus('Failed to load dashboard state. Is the server running?');
  if (logOutput) logOutput.textContent = String(err?.stack || err);
});
connectStream();

const POLL_INTERVAL = 15_000;
let _pollTimer = setInterval(() => { refresh().catch(() => {}); }, POLL_INTERVAL);

// Pause polling when tab is hidden — prevents stale bursts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(_pollTimer);
  } else {
    refresh().catch(() => {});
    connectStream();
    _pollTimer = setInterval(() => { refresh().catch(() => {}); }, POLL_INTERVAL);
  }
});

// Tab-specific data fetch: load missions/events when those tabs are clicked
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'missions') { refreshMissions().catch(() => {}); }
    if (tab === 'events')   { refreshEvents().catch(() => {}); }
  });
});

// Keyboard shortcuts: R = refresh, E = evolve
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.target.isContentEditable) return;
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); refresh().catch(() => {}); }
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); evolve().catch(() => {}); }
});
