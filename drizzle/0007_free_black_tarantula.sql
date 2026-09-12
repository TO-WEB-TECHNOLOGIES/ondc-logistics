ALTER TABLE "logistics_order" ADD COLUMN "cancellation_status" varchar;--> statement-breakpoint
ALTER TABLE "logistics_order" ADD COLUMN "cancellation_reason_id" varchar;--> statement-breakpoint
ALTER TABLE "logistics_order" ADD COLUMN "cancelled_by" varchar;