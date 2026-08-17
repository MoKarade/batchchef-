CREATE TABLE "portions" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer,
	"recipe_id" integer,
	"titre" text NOT NULL,
	"zone" text NOT NULL,
	"restantes" integer NOT NULL,
	"range_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portions" ADD CONSTRAINT "portions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portions" ADD CONSTRAINT "portions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;