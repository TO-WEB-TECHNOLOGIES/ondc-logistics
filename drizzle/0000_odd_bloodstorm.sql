CREATE TABLE "ondc_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar NOT NULL,
	"message_id" varchar NOT NULL,
	"action" varchar NOT NULL,
	"parent_transaction_id" varchar,
	"order_id" varchar,
	"order_state" varchar,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"error_code" varchar,
	"error_message" varchar,
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
	"callback_message_id" varchar,
	"callback_timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_db_id" uuid NOT NULL,
	"category_id" varchar,
	"fulfillment_type" varchar,
	"authorization_start_type" varchar,
	"authorization_end_type" varchar,
	"start_gps" varchar,
	"start_address_name" varchar,
	"start_address_building" varchar,
	"start_address_locality" varchar,
	"start_address_street" varchar,
	"start_address_city" varchar,
	"start_address_state" varchar,
	"start_address_country" varchar,
	"start_area_code" varchar,
	"end_gps" varchar,
	"end_address_name" varchar,
	"end_address_building" varchar,
	"end_address_locality" varchar,
	"end_address_street" varchar,
	"end_address_city" varchar,
	"end_address_state" varchar,
	"end_address_country" varchar,
	"end_area_code" varchar,
	"schedule_days" varchar,
	"schedule_duration" varchar,
	"schedule_range_start" time,
	"schedule_range_end" time,
	"schedule_holidays" date[],
	"payload_weight_value" numeric(18, 6),
	"payload_weight_unit" varchar,
	"payload_length_value" numeric(18, 6),
	"payload_length_unit" varchar,
	"payload_breadth_value" numeric(18, 6),
	"payload_breadth_unit" varchar,
	"payload_height_value" numeric(18, 6),
	"payload_height_unit" varchar,
	"payload_category" varchar,
	"payload_value_amount" numeric(18, 2),
	"payload_value_currency" varchar,
	"payload_dangerous_goods" boolean,
	"payment_type" varchar,
	"payment_collection_amount" numeric(18, 2),
	"payment_currency" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "on_search_callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"transaction_id" varchar NOT NULL,
	"message_id" varchar NOT NULL,
	"bpp_id" varchar NOT NULL,
	"bpp_uri" varchar,
	"status" varchar DEFAULT 'staged' NOT NULL,
	"error_message" varchar,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_provider_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_row_id" uuid NOT NULL,
	"category_id" varchar,
	"time_label" varchar,
	"duration" varchar,
	"timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_provider_fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_row_id" uuid NOT NULL,
	"fulfillment_id" varchar,
	"type" varchar,
	"pickup_duration" varchar,
	"motorable_distance" numeric(18, 6),
	"motorable_distance_unit" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_provider_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_row_id" uuid NOT NULL,
	"fulfillment_row_id" uuid,
	"catalog_item_id" varchar NOT NULL,
	"parent_item_id" varchar,
	"category_id" varchar,
	"fulfillment_id" varchar,
	"descriptor_code" varchar,
	"name" varchar,
	"short_description" varchar,
	"long_description" varchar,
	"tat_label" varchar,
	"tat_duration" varchar,
	"tat_timestamp" timestamp with time zone,
	"price_amount" numeric(18, 2),
	"price_currency" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_provider_static_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_row_id" uuid NOT NULL,
	"static_terms_url" varchar,
	"static_terms_new_url" varchar,
	"effective_date" timestamp with time zone,
	"version" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"callback_id" uuid NOT NULL,
	"provider_id" varchar NOT NULL,
	"name" varchar,
	"short_description" varchar,
	"long_description" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_order_cancellation_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid NOT NULL,
	"fulfillment_state_code" varchar,
	"fulfillment_state_short_desc" varchar,
	"cancellation_fee_percentage" numeric(5, 2),
	"cancellation_fee_amount" numeric(18, 2),
	"cancellation_fee_currency" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_order_fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid NOT NULL,
	"fulfillment_id" varchar NOT NULL,
	"type" varchar,
	"awb_no" varchar,
	"tracking" boolean,
	"state_code" varchar,
	"state_short_desc" varchar,
	"start_gps" varchar,
	"start_address_name" varchar,
	"start_address_building" varchar,
	"start_address_locality" varchar,
	"start_address_street" varchar,
	"start_address_city" varchar,
	"start_address_state" varchar,
	"start_address_country" varchar,
	"start_address_area_code" varchar,
	"start_authorization_type" varchar,
	"start_contact_phone" varchar,
	"start_contact_email" varchar,
	"start_person_name" varchar,
	"start_agent_name" varchar,
	"start_agent_phone" varchar,
	"start_vehicle_registration" varchar,
	"start_time_duration" varchar,
	"start_time_timestamp" timestamp with time zone,
	"start_time_range_start" timestamp with time zone,
	"start_time_range_end" timestamp with time zone,
	"start_instruction_code" varchar,
	"start_instruction_short_desc" varchar,
	"start_instruction_long_desc" varchar,
	"start_instruction_additional_desc_content_type" varchar,
	"start_instruction_additional_desc_url" varchar,
	"start_instruction_images" varchar[],
	"end_gps" varchar,
	"end_address_name" varchar,
	"end_address_building" varchar,
	"end_address_locality" varchar,
	"end_address_street" varchar,
	"end_address_city" varchar,
	"end_address_state" varchar,
	"end_address_country" varchar,
	"end_address_area_code" varchar,
	"end_authorization_type" varchar,
	"end_contact_phone" varchar,
	"end_contact_email" varchar,
	"end_person_name" varchar,
	"end_agent_name" varchar,
	"end_agent_phone" varchar,
	"end_vehicle_registration" varchar,
	"end_time_duration" varchar,
	"end_time_timestamp" timestamp with time zone,
	"end_time_range_start" timestamp with time zone,
	"end_time_range_end" timestamp with time zone,
	"end_instruction_code" varchar,
	"end_instruction_short_desc" varchar,
	"end_instruction_long_desc" varchar,
	"end_instruction_additional_desc_content_type" varchar,
	"end_instruction_additional_desc_url" varchar,
	"end_instruction_images" varchar[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid NOT NULL,
	"item_id" varchar NOT NULL,
	"category_id" varchar,
	"fulfillment_id" varchar,
	"descriptor_code" varchar,
	"descriptor_name" varchar,
	"descriptor_short_desc" varchar,
	"descriptor_long_desc" varchar,
	"quantity_count" integer,
	"time_label" varchar,
	"time_duration" varchar,
	"time_timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_order_linked_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid NOT NULL,
	"descriptor_name" varchar,
	"quantity_count" integer,
	"quantity_measure_unit" varchar,
	"quantity_measure_value" numeric(18, 6),
	"price_amount" numeric(18, 2),
	"price_currency" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_order_quote_breakups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid NOT NULL,
	"item_id" varchar NOT NULL,
	"title_type" varchar NOT NULL,
	"price_amount" numeric(18, 2),
	"price_currency" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_order_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid NOT NULL,
	"settlement_counterparty" varchar NOT NULL,
	"settlement_type" varchar NOT NULL,
	"beneficiary_name" varchar,
	"upi_address" varchar,
	"settlement_bank_account_no" varchar,
	"settlement_ifsc_code" varchar,
	"settlement_status" varchar,
	"settlement_reference" varchar,
	"settlement_timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "init_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_db_id" uuid NOT NULL,
	"snapshot_type" varchar NOT NULL,
	"bpp_id" varchar,
	"bpp_uri" varchar,
	"provider_id" varchar,
	"billing_name" varchar,
	"billing_email" varchar,
	"billing_phone" varchar,
	"billing_tax_number" varchar,
	"billing_created_at" timestamp with time zone,
	"billing_updated_at" timestamp with time zone,
	"billing_address_name" varchar,
	"billing_address_building" varchar,
	"billing_address_locality" varchar,
	"billing_address_street" varchar,
	"billing_address_city" varchar,
	"billing_address_state" varchar,
	"billing_address_country" varchar,
	"billing_address_area_code" varchar,
	"payment_type" varchar,
	"payment_collected_by" varchar,
	"payment_collection_amount" numeric(18, 2),
	"payment_currency" varchar,
	"quote_price_amount" numeric(18, 2),
	"quote_price_currency" varchar,
	"quote_ttl" varchar,
	"order_created_at" timestamp with time zone,
	"order_updated_at" timestamp with time zone,
	"linked_order_retail_order_id" varchar,
	"linked_order_weight_unit" varchar,
	"linked_order_weight_value" numeric(18, 6),
	"linked_order_length_unit" varchar,
	"linked_order_length_value" numeric(18, 6),
	"linked_order_breadth_unit" varchar,
	"linked_order_breadth_value" numeric(18, 6),
	"linked_order_height_unit" varchar,
	"linked_order_height_value" numeric(18, 6),
	"linked_order_provider_descriptor_name" varchar,
	"linked_order_provider_address_name" varchar,
	"linked_order_provider_address_building" varchar,
	"linked_order_provider_address_locality" varchar,
	"linked_order_provider_address_city" varchar,
	"linked_order_provider_address_state" varchar,
	"linked_order_provider_address_area_code" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_provider_row_id" uuid,
	"init_order_row_id" uuid,
	"location_id" varchar NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"gps" varchar,
	"address_name" varchar,
	"address_building" varchar,
	"address_locality" varchar,
	"street" varchar,
	"city" varchar,
	"state" varchar,
	"country" varchar,
	"area_code" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_locations_exactly_one_owner" CHECK (num_nonnulls("provider_locations"."search_provider_row_id", "provider_locations"."init_order_row_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "tag_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" uuid NOT NULL,
	"code" varchar NOT NULL,
	"value" varchar
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"init_order_id" uuid,
	"init_order_fulfillment_id" uuid,
	"search_provider_fulfillment_id" uuid,
	"code" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_exactly_one_owner" CHECK (num_nonnulls("tags"."init_order_id", "tags"."init_order_fulfillment_id", "tags"."search_provider_fulfillment_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "logistics_searches" ADD CONSTRAINT "logistics_searches_transaction_db_id_ondc_transactions_id_fk" FOREIGN KEY ("transaction_db_id") REFERENCES "public"."ondc_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_search_callbacks" ADD CONSTRAINT "on_search_callbacks_search_id_logistics_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."logistics_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_provider_categories" ADD CONSTRAINT "search_provider_categories_provider_row_id_search_providers_id_fk" FOREIGN KEY ("provider_row_id") REFERENCES "public"."search_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_provider_fulfillments" ADD CONSTRAINT "search_provider_fulfillments_provider_row_id_search_providers_id_fk" FOREIGN KEY ("provider_row_id") REFERENCES "public"."search_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_provider_items" ADD CONSTRAINT "search_provider_items_provider_row_id_search_providers_id_fk" FOREIGN KEY ("provider_row_id") REFERENCES "public"."search_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_provider_items" ADD CONSTRAINT "search_provider_items_fulfillment_row_id_search_provider_fulfillments_id_fk" FOREIGN KEY ("fulfillment_row_id") REFERENCES "public"."search_provider_fulfillments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_provider_static_terms" ADD CONSTRAINT "search_provider_static_terms_provider_row_id_search_providers_id_fk" FOREIGN KEY ("provider_row_id") REFERENCES "public"."search_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_providers" ADD CONSTRAINT "search_providers_callback_id_on_search_callbacks_id_fk" FOREIGN KEY ("callback_id") REFERENCES "public"."on_search_callbacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_order_cancellation_terms" ADD CONSTRAINT "init_order_cancellation_terms_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_order_fulfillments" ADD CONSTRAINT "init_order_fulfillments_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_order_items" ADD CONSTRAINT "init_order_items_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_order_linked_order_items" ADD CONSTRAINT "init_order_linked_order_items_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_order_quote_breakups" ADD CONSTRAINT "init_order_quote_breakups_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_order_settlements" ADD CONSTRAINT "init_order_settlements_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "init_orders" ADD CONSTRAINT "init_orders_transaction_db_id_ondc_transactions_id_fk" FOREIGN KEY ("transaction_db_id") REFERENCES "public"."ondc_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_search_provider_row_id_search_providers_id_fk" FOREIGN KEY ("search_provider_row_id") REFERENCES "public"."search_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_init_order_row_id_init_orders_id_fk" FOREIGN KEY ("init_order_row_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_values" ADD CONSTRAINT "tag_values_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_init_order_id_init_orders_id_fk" FOREIGN KEY ("init_order_id") REFERENCES "public"."init_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_init_order_fulfillment_id_init_order_fulfillments_id_fk" FOREIGN KEY ("init_order_fulfillment_id") REFERENCES "public"."init_order_fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_search_provider_fulfillment_id_search_provider_fulfillments_id_fk" FOREIGN KEY ("search_provider_fulfillment_id") REFERENCES "public"."search_provider_fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ondc_transactions_transaction_id_idx" ON "ondc_transactions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ondc_transactions_message_id_idx" ON "ondc_transactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ondc_transactions_action_idx" ON "ondc_transactions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "logistics_searches_transaction_db_id_idx" ON "logistics_searches" USING btree ("transaction_db_id");--> statement-breakpoint
CREATE UNIQUE INDEX "on_search_callbacks_identity_idx" ON "on_search_callbacks" USING btree ("transaction_id","message_id","bpp_id");--> statement-breakpoint
CREATE INDEX "on_search_callbacks_transaction_id_idx" ON "on_search_callbacks" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "on_search_callbacks_search_id_idx" ON "on_search_callbacks" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "search_provider_categories_provider_row_id_idx" ON "search_provider_categories" USING btree ("provider_row_id");--> statement-breakpoint
CREATE INDEX "search_provider_fulfillments_provider_row_id_idx" ON "search_provider_fulfillments" USING btree ("provider_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_provider_items_provider_catalog_item_idx" ON "search_provider_items" USING btree ("provider_row_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "search_provider_items_provider_row_id_idx" ON "search_provider_items" USING btree ("provider_row_id");--> statement-breakpoint
CREATE INDEX "search_provider_items_fulfillment_row_id_idx" ON "search_provider_items" USING btree ("fulfillment_row_id");--> statement-breakpoint
CREATE INDEX "search_provider_static_terms_provider_row_id_idx" ON "search_provider_static_terms" USING btree ("provider_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_providers_callback_provider_idx" ON "search_providers" USING btree ("callback_id","provider_id");--> statement-breakpoint
CREATE INDEX "search_providers_callback_id_idx" ON "search_providers" USING btree ("callback_id");--> statement-breakpoint
CREATE INDEX "init_order_cancellation_terms_init_order_id_idx" ON "init_order_cancellation_terms" USING btree ("init_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "init_order_fulfillments_order_fulfillment_idx" ON "init_order_fulfillments" USING btree ("init_order_id","fulfillment_id");--> statement-breakpoint
CREATE INDEX "init_order_fulfillments_init_order_id_idx" ON "init_order_fulfillments" USING btree ("init_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "init_order_items_order_item_idx" ON "init_order_items" USING btree ("init_order_id","item_id");--> statement-breakpoint
CREATE INDEX "init_order_items_init_order_id_idx" ON "init_order_items" USING btree ("init_order_id");--> statement-breakpoint
CREATE INDEX "init_order_linked_order_items_init_order_id_idx" ON "init_order_linked_order_items" USING btree ("init_order_id");--> statement-breakpoint
CREATE INDEX "init_order_quote_breakups_init_order_id_idx" ON "init_order_quote_breakups" USING btree ("init_order_id");--> statement-breakpoint
CREATE INDEX "init_order_settlements_init_order_id_idx" ON "init_order_settlements" USING btree ("init_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "init_orders_transaction_snapshot_idx" ON "init_orders" USING btree ("transaction_db_id","snapshot_type");--> statement-breakpoint
CREATE INDEX "init_orders_transaction_db_id_idx" ON "init_orders" USING btree ("transaction_db_id");--> statement-breakpoint
CREATE INDEX "provider_locations_search_provider_row_id_idx" ON "provider_locations" USING btree ("search_provider_row_id");--> statement-breakpoint
CREATE INDEX "provider_locations_init_order_row_id_idx" ON "provider_locations" USING btree ("init_order_row_id");--> statement-breakpoint
CREATE INDEX "tag_values_tag_id_idx" ON "tag_values" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tags_init_order_id_idx" ON "tags" USING btree ("init_order_id");--> statement-breakpoint
CREATE INDEX "tags_init_order_fulfillment_id_idx" ON "tags" USING btree ("init_order_fulfillment_id");--> statement-breakpoint
CREATE INDEX "tags_search_provider_fulfillment_id_idx" ON "tags" USING btree ("search_provider_fulfillment_id");