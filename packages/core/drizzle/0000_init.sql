CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"prev_api_key_hash" text,
	"prev_api_key_expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"name" text,
	"platform" text,
	"app_version" text,
	"first_ip" text NOT NULL,
	"last_ip" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "devices_key_device_uq" UNIQUE("key_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "license_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_hint" text NOT NULL,
	"label" text NOT NULL,
	"max_devices" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "license_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "max_devices_min" CHECK ("license_keys"."max_devices" >= 1)
);
--> statement-breakpoint
CREATE TABLE "verification_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key_id" uuid,
	"app_slug" text NOT NULL,
	"device_id" text NOT NULL,
	"ip" text NOT NULL,
	"result" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_key_id_license_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."license_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_keys" ADD CONSTRAINT "license_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_keys_app_idx" ON "license_keys" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "verification_log_ip_at_idx" ON "verification_log" USING btree ("ip","at");