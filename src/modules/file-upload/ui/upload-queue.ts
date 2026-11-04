/**
 * Upload scheduling, independent of React: bounded concurrency, progress,
 * cancellation and retries-by-hand. React subscribes through
 * `useSyncExternalStore` (see `use-upload-queue.ts`).
 */
import type { FileDto, ProviderDto } from "../http/dto";
import { FilesApiError, isAbortError, type FilesApiClient } from "./api-client";
import { formatBytes } from "./format";

export type UploadStatus = "queued" | "uploading" | "processing" | "done" | "failed";

export interface UploadTask {
  readonly key: string;
  readonly file: File;
  readonly providerId: string;
  readonly status: UploadStatus;
  readonly loaded: number;
  readonly total: number;
  readonly error?: string;
  /** False when retrying cannot help (too large, unsupported type). */
  readonly retryable: boolean;
  /** Object URL for image previews; revoked when the task is dismissed. */
  readonly previewUrl?: string;
}

export interface UploadQueueOptions {
  readonly concurrency: number;
  /** How long a finished row stays visible. */
  readonly doneLingerMs: number;
}

const ACTIVE: ReadonlySet<UploadStatus> = new Set(["uploading", "processing"]);

export class UploadQueue {
  private tasks: readonly UploadTask[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly uploadedListeners = new Set<(file: FileDto) => void>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly client: FilesApiClient,
    private readonly options: UploadQueueOptions,
  ) {}

  /** Store-style subscription to task changes (for `useSyncExternalStore`). */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly UploadTask[] => this.tasks;

  /** Notified once per successfully stored file. */
  onUploaded(listener: (file: FileDto) => void): () => void {
    this.uploadedListeners.add(listener);
    return () => this.uploadedListeners.delete(listener);
  }

  enqueue(files: readonly File[], provider: ProviderDto): void {
    const added = files.map((file): UploadTask => {
      // Instant feedback only; the server enforces the real limit.
      const tooLarge = file.size > provider.maxFileSizeBytes;
      return {
        key: crypto.randomUUID(),
        file,
        providerId: provider.id,
        status: tooLarge ? "failed" : "queued",
        loaded: 0,
        total: file.size,
        error: tooLarge ? `Larger than the ${formatBytes(provider.maxFileSizeBytes)} limit` : undefined,
        retryable: !tooLarge,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      };
    });
    this.set([...added, ...this.tasks]);
    this.pump();
  }

  cancel(key: string): void {
    const controller = this.controllers.get(key);
    if (controller) controller.abort();
    else this.dismiss(key);
  }

  retry(key: string): void {
    this.patch(key, { status: "queued", loaded: 0, error: undefined });
    this.pump();
  }

  dismiss(key: string): void {
    const task = this.tasks.find((candidate) => candidate.key === key);
    if (!task) return;
    if (task.previewUrl) URL.revokeObjectURL(task.previewUrl);
    this.set(this.tasks.filter((candidate) => candidate.key !== key));
  }

  /** Aborts in-flight uploads (e.g. when the UI unmounts). */
  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  private pump(): void {
    let active = this.tasks.filter((task) => ACTIVE.has(task.status)).length;
    // Oldest first: tasks are stored newest first for display.
    for (const task of [...this.tasks].reverse()) {
      if (active >= this.options.concurrency) break;
      if (task.status !== "queued") continue;
      active += 1;
      void this.start(task);
    }
  }

  private async start(task: UploadTask): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.key, controller);
    this.patch(task.key, { status: "uploading" });

    try {
      const file = await this.client.uploadFile(task.providerId, task.file, {
        signal: controller.signal,
        onProgress: (loaded, total) =>
          // Once every byte is sent the server is still optimising and storing.
          this.patch(task.key, { loaded, total, status: loaded >= total ? "processing" : "uploading" }),
      });
      this.patch(task.key, { status: "done", loaded: task.total });
      for (const listener of this.uploadedListeners) listener(file);
      setTimeout(() => this.dismiss(task.key), this.options.doneLingerMs);
    } catch (error) {
      if (isAbortError(error)) {
        this.dismiss(task.key);
      } else {
        // 4xx means the file itself was rejected; only network/server failures are worth retrying.
        const rejected = error instanceof FilesApiError && error.status >= 400 && error.status < 500;
        this.patch(task.key, { status: "failed", error: error instanceof Error ? error.message : "Upload failed", retryable: !rejected });
      }
    } finally {
      this.controllers.delete(task.key);
      this.pump();
    }
  }

  private patch(key: string, changes: Partial<UploadTask>): void {
    this.set(this.tasks.map((task) => (task.key === key ? { ...task, ...changes } : task)));
  }

  private set(tasks: readonly UploadTask[]): void {
    this.tasks = tasks;
    for (const listener of this.listeners) listener();
  }
}
