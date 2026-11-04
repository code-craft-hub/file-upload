"use client";

import type { CSSProperties } from "react";
import type { UsageDto } from "../http/dto";
import { formatBytes, formatPercent, savedRatio } from "./format";
import { Icon } from "./icons";

/**
 * What the storage pipeline is worth, at a glance: everything users uploaded
 * versus the unique, compressed bytes actually in the database.
 */
export function UsageCard({ usage }: { usage: UsageDto | undefined }) {
  const uploaded = usage?.uploadedBytes ?? 0;
  const stored = usage?.storedBytes ?? 0;
  const saved = savedRatio(uploaded, stored);
  const storedShare = uploaded > 0 ? Math.min(stored / uploaded, 1) : 0;

  return (
    <section className="fu-usage" aria-label="Database storage">
      <div className="fu-usage__header">
        <span className="fu-usage__icon">
          <Icon name="database" />
        </span>
        <span className="fu-usage__title">
          <strong>Database Storage</strong>
          <span>Deduplicated · Brotli · WebP · 256 KB chunks</span>
        </span>
        {uploaded > 0 && <span className="fu-pill fu-pill--green">{formatPercent(saved)} saved</span>}
      </div>

      <div className="fu-meter" role="img" aria-label={`${formatBytes(stored)} stored of ${formatBytes(uploaded)} uploaded`}>
        <span className="fu-meter__segment fu-meter__segment--stored" style={{ flexBasis: `${storedShare * 100}%` }} />
        <span className="fu-meter__segment fu-meter__segment--saved" style={{ flexBasis: `${(uploaded > 0 ? 1 - storedShare : 0) * 100}%` }} />
      </div>
      <div className="fu-legend" aria-hidden="true">
        <span style={{ "--fu-dot": "var(--fu-indigo)" } as CSSProperties}>Stored</span>
        <span style={{ "--fu-dot": "var(--fu-green)" } as CSSProperties}>Saved by optimisation, compression &amp; dedup</span>
      </div>

      <dl className="fu-stats">
        <Stat label="Uploaded" value={usage ? formatBytes(uploaded) : "—"} />
        <Stat label="Stored" value={usage ? formatBytes(stored) : "—"} />
        <Stat label="On Disk" value={usage?.onDiskBytes !== undefined ? formatBytes(usage.onDiskBytes) : "—"} />
        <Stat label="Files" value={usage ? String(usage.fileCount) : "—"} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
