CREATE TABLE "catalog_ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_recipe_id" integer NOT NULL,
	"name" text NOT NULL,
	"canonical" text NOT NULL,
	"qty" real,
	"unit" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "catalog_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"image_url" text,
	"servings" integer DEFAULT 1 NOT NULL,
	"instructions" text
);
--> statement-breakpoint
ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "catalog_ingredients_catalog_recipe_id_catalog_recipes_id_fk" FOREIGN KEY ("catalog_recipe_id") REFERENCES "public"."catalog_recipes"("id") ON DELETE cascade ON UPDATE no action;