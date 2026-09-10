ALTER TABLE "init_order_fulfillments" RENAME COLUMN "start_vehicle_registration" TO "vehicle_registration";
--> statement-breakpoint
ALTER TABLE "init_order_fulfillments" DROP COLUMN "end_vehicle_registration";
