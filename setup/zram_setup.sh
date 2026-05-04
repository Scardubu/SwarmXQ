#!/usr/bin/env bash
# =============================================================================
# SwarmX ZRAM Setup — LLM-Optimized for 8GB RAM + 12GB VRAM
# =============================================================================
# PURPOSE:
#   Configures ZRAM compressed swap to maximize effective addressable memory
#   for local Ollama multi-agent workloads. ZRAM does NOT increase VRAM —
#   it compresses cold RAM pages to free physical RAM for hot paths:
#   Python orchestration, KV cache overflow, and agent state buffers.
#
# MEMORY MATH (conservative):
#   Physical RAM   :  8 GB
#   ZRAM device    :  4 GB (50% of RAM — recommended ceiling)
#   Compression    :  zstd @ ~2.3:1 ratio on mixed LLM-adjacent data
#   Logical ZRAM   :  ~9.2 GB
#   Total logical  :  ~17 GB usable
#   VRAM (separate):  12 GB (GPU — Ollama offloads weights here)
#
# WHAT ZRAM HELPS:
#   - Compresses Python/framework heap (LangGraph state, agent buffers)
#   - Frees RAM for hot KV cache spillover from VRAM
#   - Absorbs OS + process overhead (~1.5–2 GB baseline)
#
# WHAT ZRAM DOES NOT HELP:
#   - VRAM is independent — model weights live there
#   - Active KV cache (hot path) needs real RAM, not compressed swap
#   - ZRAM latency: ~5–50µs vs ~80ns DRAM (avoid on critical paths)
#
# TESTED ON: Ubuntu 22.04 / 24.04, kernel ≥ 5.15
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root: sudo bash $0"

# ── Detect physical RAM (bytes) ───────────────────────────────────────────────
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
TOTAL_RAM_GB=$((TOTAL_RAM_MB / 1024))

info "Detected RAM: ${TOTAL_RAM_GB} GB (${TOTAL_RAM_MB} MB)"
[[ $TOTAL_RAM_MB -lt 6000 ]] && die "Less than 6 GB RAM detected — ZRAM config may be insufficient."

# ── ZRAM sizing: 50% of physical RAM ─────────────────────────────────────────
ZRAM_SIZE_MB=$((TOTAL_RAM_MB / 2))
ZRAM_SIZE_BYTES=$((ZRAM_SIZE_MB * 1024 * 1024))
info "ZRAM device size: ${ZRAM_SIZE_MB} MB (logical ~$((ZRAM_SIZE_MB * 23 / 10)) MB after 2.3:1 compression)"

# ── Remove any existing ZRAM config ──────────────────────────────────────────
if [[ -f /etc/systemd/system/zram-setup.service ]]; then
    warn "Existing ZRAM service found — removing before reconfiguring."
    systemctl stop zram-setup.service 2>/dev/null || true
    systemctl disable zram-setup.service 2>/dev/null || true
    rm -f /etc/systemd/system/zram-setup.service
fi

# Remove old zramswap if installed
if systemctl is-active --quiet zramswap 2>/dev/null; then
    warn "Disabling existing zramswap service."
    systemctl stop zramswap || true
    systemctl disable zramswap || true
fi

# Disable any existing ZRAM swap devices
for dev in /dev/zram*; do
    [[ -b "$dev" ]] && swapoff "$dev" 2>/dev/null || true
done
modprobe -r zram 2>/dev/null || true

# ── Load ZRAM module ──────────────────────────────────────────────────────────
modprobe zram num_devices=1 || die "Failed to load zram module"
success "ZRAM module loaded"

# ── Configure compression algorithm ──────────────────────────────────────────
# zstd: best ratio (~2.3:1) with good speed — preferred for LLM workloads
# lz4:  fastest (~1.8:1) — use if zstd causes latency issues
# lzo:  legacy, lower ratio — avoid

ZRAM_DEV=/dev/zram0
COMP_ALGO="zstd"

if grep -q "zstd" /sys/block/zram0/comp_algorithm 2>/dev/null; then
    echo "$COMP_ALGO" > /sys/block/zram0/comp_algorithm
    success "Compression algorithm: $COMP_ALGO"
elif grep -q "lz4" /sys/block/zram0/comp_algorithm 2>/dev/null; then
    COMP_ALGO="lz4"
    echo "$COMP_ALGO" > /sys/block/zram0/comp_algorithm
    warn "zstd unavailable — falling back to lz4 (ratio ~1.8:1)"
else
    COMP_ALGO="lzo"
    warn "Only lzo available — ratio ~1.7:1"
fi

# ── Set ZRAM device size ──────────────────────────────────────────────────────
echo $ZRAM_SIZE_BYTES > /sys/block/zram0/disksize || die "Failed to set ZRAM disksize"
success "ZRAM disk size set to ${ZRAM_SIZE_MB} MB"

# ── Format and enable swap ────────────────────────────────────────────────────
mkswap -L zram0 $ZRAM_DEV || die "mkswap failed"
# Priority 100 = always prefer ZRAM over disk swap
swapon --priority 100 $ZRAM_DEV || die "swapon failed"
success "ZRAM swap enabled at priority 100"

# ── Kernel memory tuning for LLM + ZRAM workloads ────────────────────────────
# These deviate from standard desktop/server recommendations:

# swappiness=180:
#   Normal recommendation for disk swap is 10. For ZRAM, 100–200 is correct.
#   Higher value encourages paging to ZRAM (cheap) before memory pressure,
#   keeping hot pages in DRAM while cold orchestration state goes to ZRAM.
sysctl -w vm.swappiness=180

# page-cluster=0:
#   Default (3) reads 8 pages per swap fault. ZRAM benefits from single-page
#   reads since each decompression is independent — no read-ahead gain.
sysctl -w vm.page-cluster=0

# watermark_boost_factor=0:
#   Prevents proactive memory reclaim bursts that interfere with inference.
sysctl -w vm.watermark_boost_factor=0

# vfs_cache_pressure=50:
#   Reduces aggression in reclaiming dentry/inode caches — keeps filesystem
#   metadata hot for model file access.
sysctl -w vm.vfs_cache_pressure=50

# dirty_ratio / dirty_background_ratio:
#   Lower dirty_ratio reduces write stalls. Inference is read-heavy.
sysctl -w vm.dirty_ratio=10
sysctl -w vm.dirty_background_ratio=5

# overcommit — do NOT enable for production agent workloads.
# OOM kills are catastrophic for long-running agent loops.
sysctl -w vm.overcommit_memory=0
sysctl -w vm.overcommit_ratio=70

success "Kernel memory parameters tuned for LLM + ZRAM"

# ── Persist configuration across reboots ─────────────────────────────────────
SYSCTL_CONF=/etc/sysctl.d/99-swarmx-zram.conf
cat > $SYSCTL_CONF << EOF
# SwarmX ZRAM + LLM memory tuning — generated by zram_setup.sh
vm.swappiness=180
vm.page-cluster=0
vm.watermark_boost_factor=0
vm.vfs_cache_pressure=50
vm.dirty_ratio=10
vm.dirty_background_ratio=5
vm.overcommit_memory=0
vm.overcommit_ratio=70
EOF
success "Persisted sysctl config: $SYSCTL_CONF"

# ── Systemd service for ZRAM on boot ─────────────────────────────────────────
cat > /etc/systemd/system/swarmx-zram.service << EOF
[Unit]
Description=SwarmX ZRAM Swap Setup
After=local-fs.target
Before=ollama.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash /opt/swarmx/setup/zram_setup.sh
ExecStop=/bin/bash -c 'swapoff /dev/zram0 && modprobe -r zram'
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Copy script to persistent location
mkdir -p /opt/swarmx/setup
cp "$0" /opt/swarmx/setup/zram_setup.sh
chmod +x /opt/swarmx/setup/zram_setup.sh

systemctl daemon-reload
systemctl enable swarmx-zram.service
success "Systemd service registered: swarmx-zram.service"

# ── Transparent Hugepage advisory ─────────────────────────────────────────────
THP=$(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo "unknown")
if echo "$THP" | grep -q "\[always\]"; then
    warn "Transparent Hugepages = always. Recommend 'madvise' for LLM workloads:"
    warn "  echo madvise > /sys/kernel/mm/transparent_hugepage/enabled"
    echo "madvise" > /sys/kernel/mm/transparent_hugepage/enabled && \
        success "Set THP to madvise" || warn "Could not set THP — set manually"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  SwarmX ZRAM Configuration Complete${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
swapon --show
echo ""
free -h
echo ""
info "Compression: $COMP_ALGO | ZRAM device: ${ZRAM_DEV} | Size: ${ZRAM_SIZE_MB} MB"
info "Effective logical RAM ≈ $((TOTAL_RAM_GB + ZRAM_SIZE_MB * 23 / (10*1024))) GB (ZRAM + physical)"
info "Next step: source /opt/swarmx/setup/ollama_env.sh"
