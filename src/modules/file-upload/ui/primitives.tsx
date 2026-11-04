"use client";

import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { FileDto } from "../http/dto";
import { extensionLabel, fileKind } from "./format";
import { Icon, type IconName } from "./icons";

/* ---------- Segmented control ------------------------------------------- */

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

/** A radiogroup with a sliding glass thumb. Arrow keys move the selection. */
export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
}: {
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const index = Math.max(0, segments.findIndex((segment) => segment.value === value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = segments[(index + step + segments.length) % segments.length];
    onChange(next.value);
    (event.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="fu-segmented"
      style={{ "--fu-count": segments.length, "--fu-index": index } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="fu-segmented__thumb" aria-hidden="true" />
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-value={segment.value}
            className="fu-segmented__option"
            onClick={() => onChange(segment.value)}
          >
            {segment.icon && <Icon name={segment.icon} />}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Progress ring (App Store–style, tap to stop) ----------------- */

const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function ProgressRing({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return (
    <svg className="fu-progress" viewBox="0 0 30 30" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <circle className="fu-progress__track" cx="15" cy="15" r={RING_RADIUS} />
      <circle
        className="fu-progress__value"
        cx="15"
        cy="15"
        r={RING_RADIUS}
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - clamped)}
        transform="rotate(-90 15 15)"
      />
      <rect className="fu-progress__stop" x="11" y="11" width="8" height="8" rx="1.8" />
    </svg>
  );
}

/* ---------- Activity indicator (the classic eight-spoke spinner) -------- */

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <svg className="fu-spinner" viewBox="0 0 24 24" role="status" aria-label={label}>
      {Array.from({ length: 8 }, (_, spoke) => (
        <line key={spoke} x1="12" y1="3.5" x2="12" y2="7.5" opacity={0.25 + (spoke / 8) * 0.75} transform={`rotate(${spoke * 45} 12 12)`} />
      ))}
    </svg>
  );
}

/* ---------- Thumbnails --------------------------------------------------- */

const KIND_ICONS: Readonly<Record<ReturnType<typeof fileKind>, IconName>> = {
  image: "photo",
  video: "film",
  audio: "music",
  pdf: "docText",
  text: "docText",
  archive: "archive",
  other: "doc",
};

/** A typed document glyph, tinted by kind, with the extension underneath. */
export function FileGlyph({ name, contentType, showLabel = true }: { name: string; contentType: string; showLabel?: boolean }) {
  const kind = fileKind(contentType);
  return (
    <span className="fu-glyph" data-kind={kind}>
      <Icon name={KIND_ICONS[kind]} />
      {showLabel && <span className="fu-glyph__label">{extensionLabel(name)}</span>}
    </span>
  );
}

/** Image preview when the file is an image, falling back to a glyph if it fails to load. */
export function FileArtwork({ file, preferThumbnail = true }: { file: Pick<FileDto, "name" | "contentType" | "url" | "thumbnailUrl">; preferThumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = preferThumbnail ? (file.thumbnailUrl ?? file.url) : file.url;

  if (!file.contentType.startsWith("image/") || failed) {
    return <FileGlyph name={file.name} contentType={file.contentType} />;
  }
  return (
    // Plain <img>: URLs come from arbitrary providers (and ImageKit already resizes), so next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
  );
}

export function Thumb({ children }: { children: ReactNode }) {
  return <span className="fu-thumb">{children}</span>;
}
