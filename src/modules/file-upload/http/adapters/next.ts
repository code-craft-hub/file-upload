/**
 * Next.js App Router glue. The only file in the module that imports Next.
 * Each `app/api/files/**\/route.ts` re-exports one of these.
 *
 * Porting to another framework means writing an equivalent of this file:
 * resolve the route params and call the matching handler.
 */
import { connection } from "next/server";
import { getFileUploadModule } from "../../composition/container";
import { createFileHttpHandlers, type FileHttpHandlers, type FileHttpOptions } from "../handlers";

/**
 * Wire authentication here. Example:
 *
 *   authorize: async (request, action) => {
 *     const session = await auth();
 *     if (!session) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
 *   },
 */
const authorize: FileHttpOptions["authorize"] = undefined;

let handlers: FileHttpHandlers | undefined;

function getHandlers(): FileHttpHandlers {
  if (!handlers) {
    const fileUpload = getFileUploadModule();
    handlers = createFileHttpHandlers(fileUpload, { authorize, logger: fileUpload.logger });
  }
  return handlers;
}

type RouteHandler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

function route<P>(select: (handlers: FileHttpHandlers) => (request: Request, params: P) => Promise<Response>): RouteHandler<P> {
  return async (request, context) => {
    // File data is per-request by nature; opt out of prerendering explicitly.
    await connection();
    return select(getHandlers())(request, await context.params);
  };
}

type ProviderParams = { provider: string };
type FileParams = { provider: string; id: string };

export const fileRoutes = {
  listProviders: route<Record<string, never>>((h) => h.listProviders),
  listFiles: route<ProviderParams>((h) => h.listFiles),
  uploadFile: route<ProviderParams>((h) => h.uploadFile),
  getUsage: route<ProviderParams>((h) => h.getUsage),
  getFile: route<FileParams>((h) => h.getFile),
  deleteFile: route<FileParams>((h) => h.deleteFile),
  getContent: route<FileParams>((h) => h.getContent),
};
