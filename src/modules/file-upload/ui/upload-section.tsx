"use client";

import type { ProviderDto } from "../http/dto";
import { formatBytes } from "./format";
import { Icon } from "./icons";
import { FileGlyph, ProgressRing, Spinner, Thumb } from "./primitives";
import type { UploadQueue, UploadTask } from "./upload-queue";

/** The "Add Files" card. Also highlighted while files are dragged over the page. */
export function DropZone({ provider, active, onBrowse }: { provider: ProviderDto; active: boolean; onBrowse: () => void }) {
  return (
    <button type="button" className="fu-dropzone" data-active={active} onClick={onBrowse}>
      <span className="fu-dropzone__icon">
        <Icon name="upload" />
      </span>
      <span>
        <span className="fu-dropzone__title">Add Files to {provider.label}</span>
        <span className="fu-dropzone__hint">
          Drop, paste or browse · up to {formatBytes(provider.maxFileSizeBytes)} each
          {provider.optimizesImages ? " · photos are optimised to WebP" : ""}
        </span>
      </span>
    </button>
  );
}

export function UploadList({ tasks, queue, providers }: { tasks: readonly UploadTask[]; queue: UploadQueue; providers: readonly ProviderDto[] }) {
  if (!tasks.length) return null;
  const labelOf = (id: string) => providers.find((provider) => provider.id === id)?.label ?? id;

  return (
    <section className="fu-section" aria-label="Uploads">
      <header className="fu-section__header">
        <h2 className="fu-section__title">Uploads</h2>
        <span className="fu-section__accessory">{tasks.filter((task) => task.status !== "done" && task.status !== "failed").length || ""}</span>
      </header>
      <ul className="fu-group">
        {tasks.map((task) => (
          <li key={task.key} className="fu-upload-row">
            <div className="fu-row">
              <Thumb>
                {task.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                  <img src={task.previewUrl} alt="" />
                ) : (
                  <FileGlyph name={task.file.name} contentType={task.file.type} showLabel={false} />
                )}
              </Thumb>
              <div className="fu-row__body">
                <div className="fu-row__title">{task.file.name}</div>
                <div className="fu-row__subtitle" data-tone={task.status === "failed" ? "error" : undefined}>
                  {describe(task, labelOf(task.providerId))}
                </div>
              </div>
              <UploadAccessory task={task} queue={queue} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function describe(task: UploadTask, providerLabel: string): string {
  switch (task.status) {
    case "queued":
      return `Waiting · ${formatBytes(task.total)}`;
    case "uploading":
      return `${formatBytes(task.loaded)} of ${formatBytes(task.total)}`;
    case "processing":
      return `Saving to ${providerLabel}…`;
    case "done":
      return `Saved to ${providerLabel}`;
    case "failed":
      return task.error ?? "Upload failed";
  }
}

function UploadAccessory({ task, queue }: { task: UploadTask; queue: UploadQueue }) {
  switch (task.status) {
    case "queued":
    case "uploading":
      return (
        <button type="button" className="fu-icon-button" aria-label={`Cancel ${task.file.name}`} onClick={() => queue.cancel(task.key)}>
          <ProgressRing value={task.total ? task.loaded / task.total : 0} label={`Uploading ${task.file.name}`} />
        </button>
      );
    case "processing":
      return (
        <span className="fu-icon-button">
          <Spinner label="Saving" />
        </span>
      );
    case "done":
      return (
        <span className="fu-icon-button">
          <span className="fu-status-icon fu-status-icon--done">
            <Icon name="check" />
          </span>
        </span>
      );
    case "failed":
      return (
        <span style={{ display: "flex" }}>
          {task.retryable && (
            <button type="button" className="fu-icon-button" style={{ color: "var(--fu-blue)" }} aria-label={`Retry ${task.file.name}`} onClick={() => queue.retry(task.key)}>
              <Icon name="retry" />
            </button>
          )}
          <button type="button" className="fu-icon-button" style={{ color: "var(--fu-label-2)" }} aria-label={`Dismiss ${task.file.name}`} onClick={() => queue.dismiss(task.key)}>
            <Icon name="close" />
          </button>
        </span>
      );
  }
}
