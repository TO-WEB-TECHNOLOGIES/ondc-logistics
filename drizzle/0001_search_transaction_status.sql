ALTER TABLE "ondc_transactions" ADD COLUMN "status" varchar DEFAULT 'pending' NOT NULL;
ALTER TABLE "ondc_transactions" ADD COLUMN "error_code" varchar;
ALTER TABLE "ondc_transactions" ADD COLUMN "error_message" varchar;
