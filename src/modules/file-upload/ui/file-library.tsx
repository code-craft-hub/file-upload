"use client";

import "./file-upload.css";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { FileDto, ProviderDto } from "../http/dto";
import { createFilesApiClient } from "./api-client";
import { GridSkeleton } from "./file-library-skeleton";
import { FileSheet } from "./file-sheet";
import { FileGrid, FileList } from "./file-views";
import { useFileCollection, useOnVisible, usePageFileDrop, useScrolledPast, useStorageUsage, useToast, useUploadQueue, type Collection } from "./hooks";
import { Icon, type IconName } from "./icons";
import { SegmentedControl, Spinner } from "./primitives";
import { DropZone, UploadList } from "./upload-section";
import { UsageCard } from "./usage-card";

export interface FileLibraryProps {
  /** Providers configured on the server — map them with `toProviderDto`. */
  readonly providers: readonly ProviderDto[];
  /** Where the module's HTTP routes are mounted. */
  readonly apiBasePath?: string;
  readonly title?: string;
}

type ViewMode = "grid" | "list";

const PROVIDER_ICONS: Readonly<Record<string, IconName>> = { postgres: "database", imagekit: "cloud" };

/**
 * The complete library screen: provider switcher, storage usage, uploads with
 * progress, and a paginated grid/list of files with a detail sheet.
 */
export function FileLibrary({ providers, apiBasePath = "/api/files", title = "Files" }: FileLibraryProps) {
  const client = useMemo(() => createFilesApiClient(apiBasePath), [apiBasePath]);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [view, setView] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<FileDto | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);
  const provider = providers.find((candidate) => candidate.id === providerId);

  const { collection, loadMore, reload, add, remove } = useFileCollection(client, providerId);
  const usage = useStorageUsage(client, provider, usageVersion);
  const { toast, show } = useToast();
  const { queue, tasks } = useUploadQueue(client, (file) => {
    add(file);
    setUsageVersion((version) => version + 1);
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrolled = useScrolledPast(titleRef);

  const enqueue = useCallback(
    (files: File[]) => {
      if (provider && files.length) queue.enqueue(files, provider);
    },
    [provider, queue],
  );
  const dragging = usePageFileDrop(enqueue, provider !== undefined);
  useOnVisible(sentinelRef, loadMore, collection.status === "ready" && Boolean(collection.nextCursor));

  if (!provider) return <NoProviders />;

  const browse = () => inputRef.current?.click();
  const files = "files" in collection ? collection.files : [];

  return (
    <div className="fu-library">
      <div className="fu-navbar" data-scrolled={scrolled} aria-hidden="true">
        <span className="fu-navbar__title">{title}</span>
      </div>

      <header className="fu-header">
        <h1 ref={titleRef} className="fu-large-title">
          {title}
        </h1>
        <p className="fu-header__subtitle">{subtitle(collection, usage?.fileCount, provider)}</p>
        {providers.length > 1 && (
          <SegmentedControl
            label="Storage provider"
            value={providerId}
            onChange={setProviderId}
            segments={providers.map((option) => ({ value: option.id, label: option.label, icon: PROVIDER_ICONS[option.id] ?? "cloud" }))}
          />
        )}
        <p className="fu-provider-caption">{provider.description}</p>
      </header>

      {provider.reportsUsage && <UsageCard usage={usage} />}
      <DropZone provider={provider} active={dragging} onBrowse={browse} />
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={acceptAttribute(provider)}
        onChange={(event) => {
          enqueue(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <UploadList tasks={tasks} queue={queue} providers={providers} />

      <section className="fu-section" aria-labelledby="fu-recents-title">
        <header className="fu-section__header">
          <h2 id="fu-recents-title" className="fu-section__title">
            Recents
          </h2>
        </header>
        <CollectionBody collection={collection} files={files} view={view} provider={provider} onOpen={setSelected} onRetry={reload} onBrowse={browse} />
        <div ref={sentinelRef} className="fu-sentinel">
          {collection.status === "loading-more" && <Spinner label="Loading more files" />}
          {collection.status === "ready" && collection.error && (
            <button type="button" className="fu-button fu-button--plain" onClick={loadMore}>
              Couldn’t load more · Try Again
            </button>
          )}
        </div>
      </section>

      <div className="fu-toolbar fu-glass" role="toolbar" aria-label="Library">
        <button type="button" className="fu-icon-button" aria-label="Show as icons" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
          <Icon name="grid" />
        </button>
        <button type="button" className="fu-icon-button" aria-label="Show as list" aria-pressed={view === "list"} onClick={() => setView("list")}>
          <Icon name="list" />
        </button>
        <span className="fu-toolbar__divider" aria-hidden="true" />
        <button type="button" className="fu-button fu-button--prominent" onClick={browse}>
          <Icon name="plus" />
          Upload
        </button>
      </div>

      {dragging && (
        <div className="fu-drop-overlay" aria-hidden="true">
          <div className="fu-drop-overlay__card fu-glass">
            <Icon name="upload" />
            <strong>Drop to Upload</strong>
            <span>Files will be saved to {provider.label}</span>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.id} className="fu-toast fu-glass" role="status" data-tone={toast.tone}>
          <Icon name={toast.tone === "error" ? "warning" : "check"} />
          {toast.message}
        </div>
      )}

      {selected && (
        <FileSheet
          key={`${selected.provider}:${selected.id}`}
          file={selected}
          provider={providers.find((candidate) => candidate.id === selected.provider)}
          client={client}
          onClose={() => setSelected(null)}
          onDeleted={(file) => {
            remove(file);
            setUsageVersion((version) => version + 1);
          }}
          onNotify={show}
        />
      )}
    </div>
  );
}

function CollectionBody({
  collection,
  files,
  view,
  provider,
  onOpen,
  onRetry,
  onBrowse,
}: {
  collection: Collection;
  files: readonly FileDto[];
  view: ViewMode;
  provider: ProviderDto;
  onOpen: (file: FileDto) => void;
  onRetry: () => void;
  onBrowse: () => void;
}) {
  if (collection.status === "loading") return <GridSkeleton />;

  if (collection.status === "error") {
    return (
      <EmptyState icon="warning" title="Couldn’t Load Files" message={collection.error}>
        <button type="button" className="fu-button fu-button--plain" onClick={onRetry}>
          Try Again
        </button>
      </EmptyState>
    );
  }

  if (!files.length) {
    return (
      <EmptyState icon={PROVIDER_ICONS[provider.id] ?? "doc"} title="No Files Yet" message={`Files you add to ${provider.label} appear here.`}>
        <button type="button" className="fu-button fu-button--plain" onClick={onBrowse}>
          Choose Files
        </button>
      </EmptyState>
    );
  }

  return view === "grid" ? <FileGrid files={files} onOpen={onOpen} /> : <FileList files={files} onOpen={onOpen} />;
}

function EmptyState({ icon, title, message, children }: { icon: IconName; title: string; message: ReactNode; children?: ReactNode }) {
  return (
    <div className="fu-empty">
      <Icon name={icon} className="fu-empty__icon" strokeWidth={1.4} />
      <h3 className="fu-empty__title">{title}</h3>
      <p className="fu-empty__message">{message}</p>
      {children}
    </div>
  );
}

function NoProviders() {
  return (
    <div className="fu-library">
      <EmptyState
        icon="database"
        title="No Storage Configured"
        message={
          <>
            Set <code>DATABASE_URL</code> and/or <code>IMAGEKIT_PRIVATE_KEY</code> in <code>.env.local</code>, then restart the server.
          </>
        }
      />
    </div>
  );
}

function subtitle(collection: Collection, totalFromUsage: number | undefined, provider: ProviderDto): string {
  if (collection.status === "loading") return `Loading ${provider.label}…`;
  if (collection.status === "error") return provider.label;
  const count = totalFromUsage ?? collection.files.length;
  const more = totalFromUsage === undefined && collection.nextCursor ? "+" : "";
  return `${count}${more} ${count === 1 && !more ? "item" : "items"} · ${provider.label}`;
}

/** The `accept` attribute only filters the picker; the server still decides. */
function acceptAttribute(provider: ProviderDto): string {
  const types = [...provider.allowedContentTypes];
  if (types.includes("text/markdown")) types.push(".md", ".markdown");
  return types.join(",");
}
