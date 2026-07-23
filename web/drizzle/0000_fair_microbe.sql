CREATE TABLE "batch_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"portions" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'planifie' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"name" text NOT NULL,
	"canonical" text NOT NULL,
	"qty" real,
	"unit" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"image_url" text,
	"servings" integer DEFAULT 4 NOT NULL,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"name" text NOT NULL,
	"canonical" text NOT NULL,
	"qty" real,
	"unit" text,
	"est_cost" real,
	"cost_kind" text,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "batch_recipes" ADD CONSTRAINT "batch_recipes_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_recipes" ADD CONSTRAINT "batch_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;