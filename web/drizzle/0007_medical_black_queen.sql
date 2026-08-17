CREATE TABLE "pantry" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical" text NOT NULL,
	"nom" text NOT NULL,
	"ajoute_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_canonical_unique" UNIQUE("canonical")
);
