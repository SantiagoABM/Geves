ALTER TABLE "devices" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "usage_seconds" bigint;--> statement-breakpoint
ALTER TABLE "license_keys" ADD COLUMN "device_validity_days" integer;--> statement-breakpoint
ALTER TABLE "verification_log" ADD COLUMN "usage_seconds" bigint;--> statement-breakpoint
CREATE INDEX "verification_log_at_idx" ON "verification_log" USING btree ("at");--> statement-breakpoint
ALTER TABLE "license_keys" ADD CONSTRAINT "device_validity_days_min" CHECK ("license_keys"."device_validity_days" is null or "license_keys"."device_validity_days" >= 1);