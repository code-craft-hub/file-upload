"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { FileDto, ProviderDto } from "../http/dto";
import { isAbortError, type FilesApiClient } from "./api-client";
import { describeKind, formatBytes, formatFullDate, formatPercent, savedRatio } from "./format";
import { Icon } from "./icons";
import { FileArtwork, Spinner } from "./primitives";

interface FileSheetProps {
  readonly file: FileDto;
  readonly provider: ProviderDto | undefined;
  readonly client: FilesApiClient;
  readonly onClose: () => void;
  readonly onDeleted: (file: FileDto) => void;
  readonly onNotify: (message: string, tone?: "success" | "error") => void;
}

const CLOSE_ANIMATION_MS = 300;

/**
 * Detail sheet on a native <dialog>: focus trapping, Esc and the top layer
 * come from the platform. Mounted per file; it opens itself on mount and
 * animates out before reporting `onClose`.
 */
export function FileSheet({ file, provider, client, onClose, onDeleted, onNotify }: FileSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const requestClose = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.dataset.closing) return;
    dialog.dataset.closing = "true";
    const finish = () => dialog.open && dialog.close();
    dialog.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, CLOSE_ANIMATION_MS + 50); // in case animations are disabled
  };

  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) requestClose();
  };

  const absoluteUrl = () => new URL(file.url, window.location.href).href;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl());
      onNotify("Link Copied");
    } catch {
      onNotify("Couldn't copy the link", "error");
    }
  };

  const deleteFile = async () => {
    setDeleting(true);
    setError(null);
    try {
      await client.deleteFile(file.provider, file.id);
      onDeleted(file);
      onNotify("File Deleted");
      requestClose();
    } catch (cause) {
      if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : "The file couldn't be deleted.");
      setDeleting(false);
    }
  };

  const original = file.originalSize ?? file.size;
  const optimisedBy = savedRatio(original, file.size);
  const footprint = file.footprint;
  const downloadUrl = `${file.url}${file.url.includes("?") ? "&" : "?"}download=1`;

  return (
    <dialog
      ref={dialogRef}
      className="fu-sheet"
      aria-labelledby="fu-sheet-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={onBackdropClick}
    >
      <div className="fu-sheet__grabber" aria-hidden="true" />
      <header className="fu-sheet__header">
        <button type="button" className="fu-icon-button fu-glass" aria-label="Close" onClick={requestClose}>
          <Icon name="close" />
        </button>
        <h2 id="fu-sheet-title" className="fu-sheet__title">
          {file.name}
        </h2>
        <span aria-hidden="true" />
      </header>

      <div className="fu-sheet__body">
        <div className="fu-preview">
          <FileArtwork file={file} preferThumbnail={false} />
        </div>

        <dl className="fu-group">
          <InfoRow label="Kind" value={describeKind(file.contentType)} />
          <InfoRow label="Size" value={formatBytes(file.size)} />
          {original !== file.size && (
            <InfoRow label="Uploaded As" value={formatBytes(original)} badge={optimisedBy >= 0.01 ? `−${formatPercent(optimisedBy)}` : undefined} />
          )}
          {footprint && (
            <InfoRow
              label="Stored"
              value={`${formatBytes(footprint.storedBytes)}${footprint.encoding === "br" ? " · Brotli" : ""}`}
              badge={footprint.storedBytes < file.size ? `−${formatPercent(savedRatio(file.size, footprint.storedBytes))}` : undefined}
            />
          )}
          {footprint && footprint.sharedBy > 1 && <InfoRow label="Deduplicated" value={`Shared by ${footprint.sharedBy} files`} />}
          {file.width && file.height && <InfoRow label="Dimensions" value={`${file.width} × ${file.height}`} />}
          <InfoRow label="Added" value={formatFullDate(file.createdAt)} />
          <InfoRow label="Storage" value={provider?.label ?? file.provider} />
        </dl>

        {confirming ? (
          <div className="fu-confirm">
            <p className="fu-confirm__message">This file will be deleted from {provider?.label ?? file.provider}. This action can’t be undone.</p>
            {error && <p className="fu-inline-error">{error}</p>}
            <div className="fu-group">
              <button type="button" className="fu-row fu-action" data-tone="destructive-prominent" onClick={deleteFile} disabled={deleting}>
                {deleting ? <Spinner label="Deleting" /> : "Delete File"}
              </button>
            </div>
            <div className="fu-group">
              <button type="button" className="fu-row fu-action" data-tone="cancel" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="fu-group">
              <a className="fu-row fu-action" href={file.url} target="_blank" rel="noreferrer">
                <Icon name="open" />
                Open
              </a>
              <a className="fu-row fu-action" href={downloadUrl} download={file.name}>
                <Icon name="download" />
                Download
              </a>
              <button type="button" className="fu-row fu-action" onClick={copyLink}>
                <Icon name="link" />
                Copy Link
              </button>
            </div>
            <div className="fu-group">
              <button type="button" className="fu-row fu-action" data-tone="destructive" onClick={() => setConfirming(true)}>
                <Icon name="trash" />
                Delete File
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function InfoRow({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="fu-row fu-info-row">
      <dt>{label}</dt>
      <dd>
        {value}
        {badge && <span className="fu-pill fu-pill--green">{badge}</span>}
      </dd>
    </div>
  );
}
