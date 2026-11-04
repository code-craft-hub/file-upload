"use client";

import type { FileDto } from "../http/dto";
import { formatBytes, formatRelativeDate, savedRatio, formatPercent } from "./format";
import { Icon } from "./icons";
import { FileArtwork, Thumb } from "./primitives";

interface FileCollectionViewProps {
  readonly files: readonly FileDto[];
  readonly onOpen: (file: FileDto) => void;
}

/** Files-app icon view: square artwork, two-line name, size and date. */
export function FileGrid({ files, onOpen }: FileCollectionViewProps) {
  return (
    <ul className="fu-grid">
      {files.map((file) => (
        <li key={file.id}>
          <button type="button" className="fu-tile" onClick={() => onOpen(file)} aria-label={`${file.name}, ${formatBytes(file.size)}`}>
            <span className="fu-tile__media">
              <FileArtwork file={file} />
              <SavingsBadge file={file} />
            </span>
            <span className="fu-tile__name">{file.name}</span>
            <span className="fu-tile__meta">{formatBytes(file.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Settings-style list rows. */
export function FileList({ files, onOpen }: FileCollectionViewProps) {
  return (
    <ul className="fu-group">
      {files.map((file) => (
        <li key={file.id}>
          <button type="button" className="fu-row" onClick={() => onOpen(file)}>
            <Thumb>
              <FileArtwork file={file} />
            </Thumb>
            <span className="fu-row__body">
              <span className="fu-row__title">{file.name}</span>
              <span className="fu-row__subtitle">
                {formatBytes(file.size)} · {formatRelativeDate(file.createdAt)}
              </span>
            </span>
            <Icon name="chevronRight" className="fu-row__chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Shows how much the upload pipeline saved, when it saved anything worth showing. */
function SavingsBadge({ file }: { file: FileDto }) {
  const stored = file.footprint?.storedBytes ?? file.size;
  const saved = savedRatio(file.originalSize ?? file.size, stored);
  if (saved < 0.05) return null;
  return (
    <span className="fu-tile__badge" title="Space saved by optimisation, compression and deduplication">
      <Icon name="sparkles" />−{formatPercent(saved)}
    </span>
  );
}
