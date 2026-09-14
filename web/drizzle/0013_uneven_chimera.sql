CREATE TABLE "week_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"semaine" text NOT NULL,
	"catalog_recipe_id" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_picks_semaine_position" UNIQUE("semaine","position")
);
--> statement-breakpoint
ALTER TABLE "week_picks" ADD CONSTRAINT "week_picks_catalog_recipe_id_catalog_recipes_id_fk" FOREIGN KEY ("catalog_recipe_id") REFERENCES "public"."catalog_recipes"("id") ON DELETE cascade ON UPDATE no action;