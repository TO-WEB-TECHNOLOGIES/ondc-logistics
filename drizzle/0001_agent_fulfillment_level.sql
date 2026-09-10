ALTER TABLE "init_order_fulfillments" RENAME COLUMN "start_agent_name" TO "agent_name";
--> statement-breakpoint
ALTER TABLE "init_order_fulfillments" ADD COLUMN "agent_phone" varchar;
--> statement-breakpoint
ALTER TABLE "init_order_fulfillments" DROP COLUMN "start_agent_phone";
--> statement-breakpoint
ALTER TABLE "init_order_fulfillments" DROP COLUMN "end_agent_name";
--> statement-breakpoint
ALTER TABLE "init_order_fulfillments" DROP COLUMN "end_agent_phone";
