CREATE TABLE "logistics_order" (
	"order_id" varchar PRIMARY KEY NOT NULL,
	"transaction_id" varchar NOT NULL,
	"bpp_id" varchar,
	"bpp_uri" varchar,
	"provider_id" varchar,
	"state" varchar,
	"order_created_at" timestamp with time zone,
	"order_updated_at" timestamp with time zone,
	"items" jsonb,
	"fulfillments" jsonb,
	"quote" jsonb,
	"linked_order" jsonb,
	"billing" jsonb,
	"payment" jsonb,
	"cancellation_terms" jsonb,
	"tags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "logistics_order_transaction_id_idx" ON "logistics_order" USING btree ("transaction_id");