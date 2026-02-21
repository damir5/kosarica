CREATE TABLE "llm_endpoint_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"capability" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_endpoint_health_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"check_type" text NOT NULL,
	"success" boolean NOT NULL,
	"latency_ms" integer,
	"status_code" integer,
	"error_message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_endpoint_quality_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"day" date NOT NULL,
	"decision_count" integer DEFAULT 0 NOT NULL,
	"override_count" integer DEFAULT 0 NOT NULL,
	"low_confidence_count" integer DEFAULT 0 NOT NULL,
	"quality_score" real DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_endpoint_runtime" (
	"endpoint_id" text PRIMARY KEY NOT NULL,
	"circuit_state" text DEFAULT 'closed' NOT NULL,
	"cooldown_until" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"success_rate" real DEFAULT 1 NOT NULL,
	"error_rate" real DEFAULT 0 NOT NULL,
	"avg_latency_ms" real,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"endpoint" text NOT NULL,
	"api_key_env" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_weight" real DEFAULT 1 NOT NULL,
	"timeout_ms" integer DEFAULT 20000 NOT NULL,
	"max_retries" integer DEFAULT 1 NOT NULL,
	"response_format" text,
	"json_schema_nullable" boolean DEFAULT false NOT NULL,
	"max_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_routing_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"capability" text NOT NULL,
	"selected_endpoint_id" text,
	"reason" text,
	"selected_score" real,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_decision_log" ADD COLUMN "endpoint_id" text;--> statement-breakpoint
ALTER TABLE "llm_endpoint_capabilities" ADD CONSTRAINT "llm_endpoint_capabilities_endpoint_id_llm_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."llm_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_endpoint_health_checks" ADD CONSTRAINT "llm_endpoint_health_checks_endpoint_id_llm_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."llm_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_endpoint_quality_daily" ADD CONSTRAINT "llm_endpoint_quality_daily_endpoint_id_llm_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."llm_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_endpoint_runtime" ADD CONSTRAINT "llm_endpoint_runtime_endpoint_id_llm_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."llm_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_routing_decisions" ADD CONSTRAINT "llm_routing_decisions_selected_endpoint_id_llm_endpoints_id_fk" FOREIGN KEY ("selected_endpoint_id") REFERENCES "public"."llm_endpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_endpoint_capabilities_endpoint_idx" ON "llm_endpoint_capabilities" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "llm_endpoint_capabilities_capability_idx" ON "llm_endpoint_capabilities" USING btree ("capability");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_endpoint_capabilities_endpoint_capability_unique" ON "llm_endpoint_capabilities" USING btree ("endpoint_id","capability");--> statement-breakpoint
CREATE INDEX "llm_endpoint_health_checks_endpoint_checked_at_idx" ON "llm_endpoint_health_checks" USING btree ("endpoint_id","checked_at");--> statement-breakpoint
CREATE INDEX "llm_endpoint_health_checks_checked_at_idx" ON "llm_endpoint_health_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_endpoint_quality_daily_endpoint_day_unique" ON "llm_endpoint_quality_daily" USING btree ("endpoint_id","day");--> statement-breakpoint
CREATE INDEX "llm_endpoint_quality_daily_endpoint_idx" ON "llm_endpoint_quality_daily" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "llm_endpoint_quality_daily_day_idx" ON "llm_endpoint_quality_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "llm_endpoint_runtime_circuit_state_idx" ON "llm_endpoint_runtime" USING btree ("circuit_state");--> statement-breakpoint
CREATE INDEX "llm_endpoint_runtime_cooldown_idx" ON "llm_endpoint_runtime" USING btree ("cooldown_until");--> statement-breakpoint
CREATE INDEX "llm_endpoints_enabled_idx" ON "llm_endpoints" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "llm_endpoints_provider_idx" ON "llm_endpoints" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "llm_endpoints_model_idx" ON "llm_endpoints" USING btree ("model");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_endpoints_name_unique" ON "llm_endpoints" USING btree ("name");--> statement-breakpoint
CREATE INDEX "llm_routing_decisions_capability_created_at_idx" ON "llm_routing_decisions" USING btree ("capability","created_at");--> statement-breakpoint
CREATE INDEX "llm_routing_decisions_selected_endpoint_idx" ON "llm_routing_decisions" USING btree ("selected_endpoint_id");--> statement-breakpoint
ALTER TABLE "llm_decision_log" ADD CONSTRAINT "llm_decision_log_endpoint_id_llm_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."llm_endpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_decision_log_endpoint_created_at_idx" ON "llm_decision_log" USING btree ("endpoint_id","created_at");
--> statement-breakpoint
INSERT INTO "llm_endpoints" ("id","name","provider","model","endpoint","api_key_env","enabled","base_weight","timeout_ms","max_retries","response_format","json_schema_nullable","max_tokens","created_at","updated_at")
VALUES
	('lep_seed_primary','Seed Primary','openai','gpt-4o-mini','https://api.openai.com/v1/chat/completions','OPENAI_API_KEY',true,1,20000,1,'json_object',false,NULL,NOW(),NOW()),
	('lep_seed_secondary','Seed Secondary','openrouter','openai/gpt-4o-mini','https://openrouter.ai/api/v1/chat/completions','OPENROUTER_API_KEY',true,1,30000,1,'json_object',false,NULL,NOW(),NOW())
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "llm_endpoint_capabilities" ("id","endpoint_id","capability","created_at")
VALUES
	('lec_seed_match_primary','lep_seed_primary','matching_primary',NOW()),
	('lec_seed_match_secondary','lep_seed_secondary','matching_secondary',NOW()),
	('lec_seed_cat_primary','lep_seed_primary','categorization_primary',NOW()),
	('lec_seed_cat_secondary','lep_seed_secondary','categorization_secondary',NOW())
ON CONFLICT ("endpoint_id","capability") DO NOTHING;
