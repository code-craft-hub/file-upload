CREATE SCHEMA "file_upload";
--> statement-breakpoint
CREATE TYPE "file_upload"."content_encoding" AS ENUM('identity', 'br');--> statement-breakpoint
CREATE TABLE "file_upload"."blob_chunks" (
	"blob_id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "blob_chunks_pkey" PRIMARY KEY("blob_id","seq"),
	CONSTRAINT "blob_chunks_seq_non_negative" CHECK ("file_upload"."blob_chunks"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_upload"."blobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_upload"."blobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"size" bigint NOT NULL,
	"stored_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chunk_size" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"ref_count" integer DEFAULT 1 NOT NULL,
	"encoding" "file_upload"."content_encoding" NOT NULL,
	"sha256" "bytea" NOT NULL,
	CONSTRAINT "blobs_sha256_length" CHECK (octet_length("file_upload"."blobs"."sha256") = 32),
	CONSTRAINT "blobs_sizes_non_negative" CHECK ("file_upload"."blobs"."size" >= 0 AND "file_upload"."blobs"."stored_size" >= 0),
	CONSTRAINT "blobs_chunking_valid" CHECK ("file_upload"."blobs"."chunk_size" > 0 AND "file_upload"."blobs"."chunk_count" >= 0),
	CONSTRAINT "blobs_ref_count_non_negative" CHECK ("file_upload"."blobs"."ref_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_upload"."files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"blob_id" bigint NOT NULL,
	"original_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"width" integer,
	"height" integer,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "files_name_length" CHECK (char_length("file_upload"."files"."name") BETWEEN 1 AND 255),
	CONSTRAINT "files_original_size_positive" CHECK ("file_upload"."files"."original_size" > 0),
	CONSTRAINT "files_dimensions_positive" CHECK (("file_upload"."files"."width" IS NULL OR "file_upload"."files"."width" > 0) AND ("file_upload"."files"."height" IS NULL OR "file_upload"."files"."height" > 0))
);
--> statement-breakpoint
ALTER TABLE "file_upload"."blob_chunks" ADD CONSTRAINT "blob_chunks_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "file_upload"."blobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload"."files" ADD CONSTRAINT "files_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "file_upload"."blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blobs_sha256_key" ON "file_upload"."blobs" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "files_blob_id_idx" ON "file_upload"."files" USING btree ("blob_id");