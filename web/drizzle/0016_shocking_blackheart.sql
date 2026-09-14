CREATE TABLE "week_estimations" (
	"id" serial PRIMARY KEY NOT NULL,
	"semaine" text NOT NULL,
	"signature" text NOT NULL,
	"prix_cents" integer NOT NULL,
	"methode" text NOT NULL,
	"calcule_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_estimations_semaine_unique" UNIQUE("semaine")
);
