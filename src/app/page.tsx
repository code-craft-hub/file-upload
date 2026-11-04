import { connection } from "next/server";
import { Suspense } from "react";
import { getFileUploadModule, toProviderDto } from "@/modules/file-upload";
import { FileLibrary, FileLibrarySkeleton } from "@/modules/file-upload/ui";

export default function Home() {
  return (
    <main className="fu-root fu-page">
      <Suspense fallback={<FileLibrarySkeleton />}>
        <ConfiguredLibrary />
      </Suspense>
    </main>
  );
}

async function ConfiguredLibrary() {
  // Which providers exist depends on runtime env vars; don't bake them into the build.
  await connection();
  const providers = getFileUploadModule().providers.list().map(toProviderDto);
  return <FileLibrary providers={providers} />;
}
