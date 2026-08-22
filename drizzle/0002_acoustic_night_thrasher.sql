CREATE TABLE "on_search_callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar NOT NULL,
	"message_id" varchar NOT NULL,
	"bpp_id" varchar NOT NULL,
	"bpp_uri" varchar,
	"payload" jsonb NOT NULL,
	"status" varchar DEFAULT 'staged' NOT NULL,
	"error_message" varchar,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ondc_transactions" ADD COLUMN "status" varchar DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "ondc_transactions" ADD COLUMN "error_code" varchar;--> statement-breakpoint
ALTER TABLE "ondc_transactions" ADD COLUMN "error_message" varchar;--> statement-breakpoint
ALTER TABLE "ondc_transactions" ADD COLUMN "callback_message_id" varchar;--> statement-breakpoint
ALTER TABLE "ondc_transactions" ADD COLUMN "callback_timestamp" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "on_search_callbacks_identity_idx" ON "on_search_callbacks" USING btree ("transaction_id","message_id","bpp_id");--> statement-breakpoint
CREATE INDEX "on_search_callbacks_transaction_id_idx" ON "on_search_callbacks" USING btree ("transaction_id");