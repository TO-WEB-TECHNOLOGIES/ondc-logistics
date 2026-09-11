ALTER TABLE "logistics_order" ADD COLUMN "tracking_url" varchar;--> statement-breakpoint
ALTER TABLE "logistics_order" ADD COLUMN "tracking_status" varchar;--> statement-breakpoint
ALTER TABLE "logistics_order" ADD COLUMN "tracking_gps" varchar;--> statement-breakpoint
ALTER TABLE "logistics_order" ADD COLUMN "tracking_location_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "logistics_order" ADD COLUMN "tracking_updated_at" timestamp with time zone;