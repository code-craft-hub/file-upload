import {
  DEFAULT_ALLOWED_CONTENT_TYPES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
} from "../domain/upload-policy";

/**
 * Everything the composition root needs, as plain data. Build it from the
 * environment with {@link loadConfigFromEnv}, or construct it in code.
 */
export interface FileUploadConfig {
  /** Enables the Postgres provider. */
  readonly postgres?: { readonly url: string };
  /** Enables the ImageKit provider. */
  readonly imagekit?: { readonly privateKey: string; readonly folder: string };
  readonly maxFileSizeBytes: number;
  readonly allowedContentTypes: readonly string[];
  /** Where the HTTP routes are mounted; used to build download URLs. */
  readonly apiBasePath: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * | Variable                    | Effect                                           |
 * | --------------------------- | ------------------------------------------------ |
 * | `DATABASE_URL`              | enables the Postgres provider                    |
 * | `IMAGEKIT_PRIVATE_KEY`      | enables the ImageKit provider                    |
 * | `IMAGEKIT_FOLDER`           | folder the module owns (default `/file-upload`)  |
 * | `FILE_UPLOAD_MAX_BYTES`     | per-file limit (default 25 MiB)                  |
 * | `FILE_UPLOAD_ALLOWED_TYPES` | comma-separated MIME types, `type/*` allowed     |
 */
export function loadConfigFromEnv(env: Env = process.env): FileUploadConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  const imagekitKey = env.IMAGEKIT_PRIVATE_KEY?.trim();

  return {
    postgres: databaseUrl ? { url: databaseUrl } : undefined,
    imagekit: imagekitKey ? { privateKey: imagekitKey, folder: env.IMAGEKIT_FOLDER?.trim() || "/file-upload" } : undefined,
    maxFileSizeBytes: parsePositiveInteger(env.FILE_UPLOAD_MAX_BYTES, "FILE_UPLOAD_MAX_BYTES") ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    allowedContentTypes: parseList(env.FILE_UPLOAD_ALLOWED_TYPES) ?? DEFAULT_ALLOWED_CONTENT_TYPES,
    apiBasePath: "/api/files",
  };
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (!value?.trim()) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer, got "${value}".`);
  return number;
}

function parseList(value: string | undefined): string[] | undefined {
  const items = value?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return items?.length ? items : undefined;
}
