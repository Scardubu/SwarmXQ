"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PlatformPublishingAsset, SeriesPrimaryPlatform } from "@swarmx/types/series-types";

const PLATFORM_LABELS: Record<SeriesPrimaryPlatform, string> = {
  tiktok:        "TikTok",
  reels:         "Reels",
  youtube_shorts:"Shorts",
  facebook:      "Facebook",
  x:             "X",
};

const PLATFORM_ORDER: SeriesPrimaryPlatform[] = [
  "tiktok", "reels", "youtube_shorts", "facebook", "x",
];

function Field({ label, value }: { label: string; value: string | string[] }) {
  const text = Array.isArray(value) ? value.join("  ") : value;
  return (
    <div>
      <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p className="text-xs leading-relaxed text-text-secondary">{text}</p>
    </div>
  );
}

function AssetView({ asset }: { asset: PlatformPublishingAsset }) {
  return (
    <div className="space-y-3 px-3 py-3">
      <Field label="Title" value={asset.title} />
      <Field label="SEO Description" value={asset.seoDescription} />
      <div>
        <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Caption</p>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{asset.caption}</p>
      </div>
      <Field label="Hashtags" value={asset.hashtags} />
      <Field label="CTA" value={asset.cta} />
      <Field label="Thumbnail Concept" value={asset.thumbnailConcept} />
      <Field label="Pinned Comment" value={asset.pinnedComment} />
      <Field label="Sound Suggestion" value={asset.soundSuggestion} />
    </div>
  );
}

interface PlatformAssetsPanelProps {
  assets: PlatformPublishingAsset[];
  primaryPlatform?: SeriesPrimaryPlatform;
}

export function PlatformAssetsPanel({ assets, primaryPlatform }: PlatformAssetsPanelProps) {
  const ordered = PLATFORM_ORDER.filter((p) => assets.some((a) => a.platform === p));
  const [active, setActive] = useState<SeriesPrimaryPlatform>(
    primaryPlatform ?? ordered[0] ?? "tiktok",
  );

  const currentAsset = assets.find((a) => a.platform === active);

  return (
    <section aria-label="Platform publishing assets">
      {/* Tab bar */}
      <div
        className="flex border-b border-border overflow-x-auto"
        role="tablist"
        aria-label="Platforms"
      >
        {ordered.map((platform) => (
          <button
            key={platform}
            type="button"
            role="tab"
            aria-selected={active === platform}
            aria-controls={`platform-panel-${platform}`}
            onClick={() => setActive(platform)}
            className={cn(
              "shrink-0 px-3 py-2 font-mono text-[11px] border-b-2 -mb-px transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
              active === platform
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary",
              platform === primaryPlatform && active !== platform && "font-medium",
            )}
          >
            {PLATFORM_LABELS[platform]}
            {platform === primaryPlatform && (
              <span className="ml-1 text-accent/60">★</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {ordered.map((platform) => (
        <div
          key={platform}
          id={`platform-panel-${platform}`}
          role="tabpanel"
          aria-label={`${PLATFORM_LABELS[platform]} assets`}
          hidden={active !== platform}
        >
          {active === platform && currentAsset && <AssetView asset={currentAsset} />}
        </div>
      ))}

      {!currentAsset && (
        <p className="px-3 py-3 text-xs text-text-muted">No assets for this platform.</p>
      )}
    </section>
  );
}
