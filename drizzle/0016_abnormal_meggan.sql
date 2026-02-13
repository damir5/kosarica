CREATE TABLE "croatian_counties" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"external_id" integer
);
--> statement-breakpoint
CREATE TABLE "croatian_municipalities" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"external_id" integer,
	"county_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "croatian_settlements" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"external_id" integer,
	"municipality_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "croatian_municipalities" ADD CONSTRAINT "croatian_municipalities_county_id_croatian_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."croatian_counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "croatian_settlements" ADD CONSTRAINT "croatian_settlements_municipality_id_croatian_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."croatian_municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "croatian_municipalities_county_idx" ON "croatian_municipalities" USING btree ("county_id");--> statement-breakpoint
CREATE INDEX "croatian_settlements_municipality_idx" ON "croatian_settlements" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "croatian_settlements_name_idx" ON "croatian_settlements" USING btree ("name");