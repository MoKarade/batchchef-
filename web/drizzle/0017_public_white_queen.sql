CREATE TABLE "meal_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_recipe_id" integer,
	"batch_id" integer,
	"recipe_id" integer,
	"titre" text NOT NULL,
	"source_url" text,
	"nom_batch" text NOT NULL,
	"portions" integer NOT NULL,
	"cuisine_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_history_batch_recipe_id_unique" UNIQUE("batch_recipe_id")
);
--> statement-breakpoint
ALTER TABLE "meal_history" ADD CONSTRAINT "meal_history_batch_recipe_id_batch_recipes_id_fk" FOREIGN KEY ("batch_recipe_id") REFERENCES "public"."batch_recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_history" ADD CONSTRAINT "meal_history_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_history" ADD CONSTRAINT "meal_history_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;