ALTER TABLE "catalog_recipes" ADD COLUMN "prep_minutes" integer;--> statement-breakpoint
ALTER TABLE "catalog_recipes" ADD COLUMN "cuisson_minutes" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "prep_minutes" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "cuisson_minutes" integer;