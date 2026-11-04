import "./file-upload.css";

/**
 * Static stand-in for `FileLibrary` while the server resolves configuration.
 * No hooks, so it renders inside the prerendered shell (a Suspense fallback).
 */
export function FileLibrarySkeleton({ title = "Files" }: { title?: string }) {
  return (
    <div className="fu-library" aria-busy="true">
      <header className="fu-header">
        <h1 className="fu-large-title">{title}</h1>
        <span className="fu-skeleton" style={{ height: 14, width: 140 }} />
        <span className="fu-skeleton" style={{ height: 44, maxWidth: 440, borderRadius: 999 }} />
      </header>
      <span className="fu-skeleton" style={{ display: "block", height: 88, marginBottom: 60, borderRadius: "var(--fu-radius-card)" }} />
      <GridSkeleton />
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="fu-grid" aria-busy="true" aria-label="Loading files">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="fu-tile">
          <span className="fu-skeleton" style={{ aspectRatio: "1", borderRadius: "var(--fu-radius-tile)" }} />
          <span className="fu-skeleton" style={{ height: 12, width: "70%", margin: "0 auto" }} />
        </li>
      ))}
    </ul>
  );
}
