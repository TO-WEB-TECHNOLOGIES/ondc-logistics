CREATE TABLE "ondc_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar NOT NULL,
	"message_id" varchar NOT NULL,
	"action" varchar NOT NULL,
	"domain" varchar,
	"country" varchar,
	"city" varchar,
	"core_version" varchar,
	"bap_id" varchar,
	"bap_uri" varchar,
	"bpp_id" varchar,
	"bpp_uri" varchar,
	"timestamp" timestamp with time zone,
	"ttl" varchar,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_search_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"holiday_date" date
);
--> statement-breakpoint
CREATE TABLE "logistics_search_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"location_type" varchar,
	"gps" varchar,
	"area_code" varchar,
	"name" varchar,
	"building" varchar,
	"locality" varchar,
	"street" varchar,
	"city" varchar,
	"state" varchar,
	"country" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_search_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"weight_value" numeric(18, 6),
	"weight_unit" varchar,
	"length_value" numeric(18, 6),
	"length_unit" varchar,
	"breadth_value" numeric(18, 6),
	"breadth_unit" varchar,
	"height_value" numeric(18, 6),
	"height_unit" varchar,
	"category" varchar,
	"value_amount" numeric(18, 2),
	"value_currency" varchar,
	"dangerous_goods" boolean
);
--> statement-breakpoint
CREATE TABLE "logistics_search_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"type" varchar,
	"collection_amount" numeric(18, 2),
	"currency" varchar
);
--> statement-breakpoint
CREATE TABLE "logistics_search_provider_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"days" varchar,
	"duration" varchar,
	"range_start" time,
	"range_end" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_db_id" uuid NOT NULL,
	"category_id" varchar,
	"fulfillment_type" varchar,
	"authorization_start_type" varchar,
	"authorization_end_type" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lsp_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_db_id" uuid NOT NULL,
	"parent_item_id" uuid,
	"category_id" varchar,
	"fulfillment_db_id" uuid,
	"catalog_item_id" varchar,
	"descriptor_code" varchar,
	"name" varchar,
	"short_description" varchar,
	"long_description" varchar,
	"tat_label" varchar,
	"tat_duration" varchar,
	"tat_timestamp" timestamp with time zone,
	"price_amount" numeric(18, 2),
	"price_currency" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lsp_provider_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_db_id" uuid NOT NULL,
	"category_id" varchar,
	"time_label" varchar,
	"duration" varchar,
	"timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lsp_provider_fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_db_id" uuid NOT NULL,
	"fulfillment_id" varchar,
	"type" varchar,
	"pickup_duration" varchar,
	"motorable_distance" numeric(18, 6),
	"motorable_distance_unit" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lsp_provider_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_db_id" uuid NOT NULL,
	"location_id" varchar,
	"gps" varchar,
	"street" varchar,
	"city" varchar,
	"state" varchar,
	"area_code" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lsp_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"provider_id" varchar NOT NULL,
	"name" varchar,
	"short_description" varchar,
	"long_description" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lsp_static_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_db_id" uuid NOT NULL,
	"static_terms_url" varchar,
	"static_terms_new_url" varchar,
	"effective_date" timestamp with time zone,
	"version" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logistics_search_holidays" ADD CONSTRAINT "logistics_search_holidays_schedule_id_logistics_search_provider_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."logistics_search_provider_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_search_locations" ADD CONSTRAINT "logistics_search_locations_search_id_logistics_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."logistics_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_search_payloads" ADD CONSTRAINT "logistics_search_payloads_search_id_logistics_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."logistics_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_search_payments" ADD CONSTRAINT "logistics_search_payments_search_id_logistics_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."logistics_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_search_provider_schedules" ADD CONSTRAINT "logistics_search_provider_schedules_search_id_logistics_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."logistics_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_searches" ADD CONSTRAINT "logistics_searches_transaction_db_id_ondc_transactions_id_fk" FOREIGN KEY ("transaction_db_id") REFERENCES "public"."ondc_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_catalog_items" ADD CONSTRAINT "lsp_catalog_items_provider_db_id_lsp_providers_id_fk" FOREIGN KEY ("provider_db_id") REFERENCES "public"."lsp_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_catalog_items" ADD CONSTRAINT "lsp_catalog_items_parent_item_id_lsp_catalog_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."lsp_catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_catalog_items" ADD CONSTRAINT "lsp_catalog_items_fulfillment_db_id_lsp_provider_fulfillments_id_fk" FOREIGN KEY ("fulfillment_db_id") REFERENCES "public"."lsp_provider_fulfillments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_provider_categories" ADD CONSTRAINT "lsp_provider_categories_provider_db_id_lsp_providers_id_fk" FOREIGN KEY ("provider_db_id") REFERENCES "public"."lsp_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_provider_fulfillments" ADD CONSTRAINT "lsp_provider_fulfillments_provider_db_id_lsp_providers_id_fk" FOREIGN KEY ("provider_db_id") REFERENCES "public"."lsp_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_provider_locations" ADD CONSTRAINT "lsp_provider_locations_provider_db_id_lsp_providers_id_fk" FOREIGN KEY ("provider_db_id") REFERENCES "public"."lsp_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_providers" ADD CONSTRAINT "lsp_providers_search_id_logistics_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."logistics_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lsp_static_terms" ADD CONSTRAINT "lsp_static_terms_provider_db_id_lsp_providers_id_fk" FOREIGN KEY ("provider_db_id") REFERENCES "public"."lsp_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ondc_transactions_transaction_id_idx" ON "ondc_transactions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ondc_transactions_message_id_idx" ON "ondc_transactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ondc_transactions_action_idx" ON "ondc_transactions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "logistics_search_holidays_schedule_id_idx" ON "logistics_search_holidays" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "logistics_search_locations_search_id_idx" ON "logistics_search_locations" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "logistics_search_payloads_search_id_idx" ON "logistics_search_payloads" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "logistics_search_payments_search_id_idx" ON "logistics_search_payments" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "logistics_search_provider_schedules_search_id_idx" ON "logistics_search_provider_schedules" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "logistics_searches_transaction_db_id_idx" ON "logistics_searches" USING btree ("transaction_db_id");--> statement-breakpoint
CREATE INDEX "lsp_catalog_items_provider_db_id_idx" ON "lsp_catalog_items" USING btree ("provider_db_id");--> statement-breakpoint
CREATE INDEX "lsp_catalog_items_parent_item_id_idx" ON "lsp_catalog_items" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "lsp_catalog_items_fulfillment_db_id_idx" ON "lsp_catalog_items" USING btree ("fulfillment_db_id");--> statement-breakpoint
CREATE INDEX "lsp_provider_categories_provider_db_id_idx" ON "lsp_provider_categories" USING btree ("provider_db_id");--> statement-breakpoint
CREATE INDEX "lsp_provider_fulfillments_provider_db_id_idx" ON "lsp_provider_fulfillments" USING btree ("provider_db_id");--> statement-breakpoint
CREATE INDEX "lsp_provider_locations_provider_db_id_idx" ON "lsp_provider_locations" USING btree ("provider_db_id");--> statement-breakpoint
CREATE INDEX "lsp_providers_search_id_idx" ON "lsp_providers" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "lsp_providers_provider_id_idx" ON "lsp_providers" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "lsp_static_terms_provider_db_id_idx" ON "lsp_static_terms" USING btree ("provider_db_id");