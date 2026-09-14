CREATE TABLE "type_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "type_corrections_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
ALTER TABLE "catalog_recipes" ADD COLUMN "type_estime" text;