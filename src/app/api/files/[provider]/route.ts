import { fileRoutes } from "@/modules/file-upload/http/adapters/next";

export const GET = fileRoutes.listFiles;
export const POST = fileRoutes.uploadFile;
