"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { FileDto, FilePageDto, ProviderDto, UsageDto } from "../http/dto";
import { isAbortError, type FilesApiClient } from "./api-client";
import { UploadQueue, type UploadTask } from "./upload-queue";

const PAGE_SIZE = 30;

/* ---------- File collections (one cached list per provider) ------------- */

export type Collection =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: string }
  | {
      readonly status: "ready" | "loading-more";
      readonly files: readonly FileDto[];
      readonly nextCursor: string | null;
      readonly error?: string;
    };

type CollectionAction =
  | { type: "loaded"; provider: string; page: FilePageDto; append: boolean }
  | { type: "loading-more"; provider: string }
  | { type: "failed"; provider: string; error: string }
  | { type: "reset"; provider: string }
  | { type: "added"; file: FileDto }
  | { type: "removed"; file: FileDto };

type Collections = Readonly<Record<string, Collection>>;

const LOADING: Collection = { status: "loading" };

function collectionsReducer(state: Collections, action: CollectionAction): Collections {
  const provider = "provider" in action ? action.provider : action.file.provider;
  const current = state[provider];

  switch (action.type) {
    case "loaded": {
      const previous = action.append && current && "files" in current ? current.files : [];
      return { ...state, [provider]: { status: "ready", files: [...previous, ...action.page.items], nextCursor: action.page.nextCursor } };
    }
    case "loading-more":
      return current?.status === "ready" ? { ...state, [provider]: { ...current, status: "loading-more" } } : state;
    case "failed":
      // A failed "load more" keeps what is already on screen.
      return current && "files" in current
        ? { ...state, [provider]: { ...current, status: "ready", error: action.error } }
        : { ...state, [provider]: { status: "error", error: action.error } };
    case "reset": {
      const next = { ...state };
      delete next[provider];
      return next;
    }
    case "added":
      if (!current || !("files" in current)) return state; // fetched fresh when first shown
      return { ...state, [provider]: { ...current, files: [action.file, ...current.files.filter((file) => file.id !== action.file.id)] } };
    case "removed":
      if (!current || !("files" in current)) return state;
      return { ...state, [provider]: { ...current, files: current.files.filter((file) => file.id !== action.file.id) } };
  }
}

export function useFileCollection(client: FilesApiClient, providerId: string) {
  const [collections, dispatch] = useReducer(collectionsReducer, {});
  const stored = collections[providerId];
  const collection = stored ?? LOADING;
  const needsFetch = stored === undefined;

  useEffect(() => {
    if (!needsFetch || !providerId) return;
    const controller = new AbortController();
    client.listFiles(providerId, { limit: PAGE_SIZE, signal: controller.signal }).then(
      (page) => dispatch({ type: "loaded", provider: providerId, page, append: false }),
      (error: unknown) => {
        if (!isAbortError(error)) dispatch({ type: "failed", provider: providerId, error: messageOf(error) });
      },
    );
    return () => controller.abort();
  }, [client, providerId, needsFetch]);

  const loadMore = useCallback(() => {
    if (stored?.status !== "ready" || !stored.nextCursor) return;
    dispatch({ type: "loading-more", provider: providerId });
    client.listFiles(providerId, { limit: PAGE_SIZE, cursor: stored.nextCursor }).then(
      (page) => dispatch({ type: "loaded", provider: providerId, page, append: true }),
      (error: unknown) => dispatch({ type: "failed", provider: providerId, error: messageOf(error) }),
    );
  }, [client, stored, providerId]);

  return {
    collection,
    loadMore,
    reload: useCallback(() => dispatch({ type: "reset", provider: providerId }), [providerId]),
    add: useCallback((file: FileDto) => dispatch({ type: "added", file }), []),
    remove: useCallback((file: FileDto) => dispatch({ type: "removed", file }), []),
  };
}

/* ---------- Storage usage ------------------------------------------------- */

/** Refetches whenever `version` changes (bump it after uploads and deletes). */
export function useStorageUsage(client: FilesApiClient, provider: ProviderDto | undefined, version: number) {
  const [usage, setUsage] = useState<Readonly<Record<string, UsageDto>>>({});
  const providerId = provider?.reportsUsage ? provider.id : undefined;

  useEffect(() => {
    if (!providerId) return;
    const controller = new AbortController();
    client.getUsage(providerId, controller.signal).then(
      (value) => setUsage((previous) => ({ ...previous, [providerId]: value })),
      () => {}, // Usage is decorative; a failure must not disturb the page.
    );
    return () => controller.abort();
  }, [client, providerId, version]);

  return providerId ? usage[providerId] : undefined;
}

/* ---------- Upload queue -------------------------------------------------- */

const NO_TASKS: readonly UploadTask[] = [];

export function useUploadQueue(client: FilesApiClient, onUploaded: (file: FileDto) => void) {
  const [queue] = useState(() => new UploadQueue(client, { concurrency: 3, doneLingerMs: 1600 }));
  const handleUploaded = useEffectEvent(onUploaded);

  useEffect(() => queue.onUploaded((file) => handleUploaded(file)), [queue]);
  useEffect(() => () => queue.abortAll(), [queue]);

  const tasks = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => NO_TASKS);
  return { queue, tasks };
}

/* ---------- Page-wide drag & drop and paste ------------------------------- */

export function usePageFileDrop(onFiles: (files: File[]) => void, enabled: boolean): boolean {
  const [dragging, setDragging] = useState(false);
  const deliver = useEffectEvent(onFiles);

  useEffect(() => {
    if (!enabled) return;
    let depth = 0; // dragenter/dragleave fire for every child element crossed
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) deliver(files);
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      deliver(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [enabled]);

  return dragging;
}

/* ---------- Small view helpers ------------------------------------------- */

/** True once `ref` has scrolled under the navigation bar. */
export function useScrolledPast(ref: RefObject<Element | null>, offset = 54): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < offset),
      { rootMargin: `-${offset}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, offset]);
  return past;
}

/** Calls `onVisible` whenever the sentinel scrolls into view (infinite scroll). */
export function useOnVisible(ref: RefObject<Element | null>, onVisible: () => void, enabled: boolean): void {
  const notify = useEffectEvent(onVisible);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && notify(), { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: "success" | "error";
}

export function useToast(durationMs = 1800) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      clearTimeout(timer.current);
      setToast({ id: Date.now(), message, tone });
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
