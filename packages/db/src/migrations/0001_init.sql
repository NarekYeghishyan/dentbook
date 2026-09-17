CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"patient_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"source" text NOT NULL,
	"public_token" text DEFAULT encode(gen_random_bytes(24), 'hex') NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "appointments_public_token_key" UNIQUE("public_token"),
	CONSTRAINT "appointments_range" CHECK (end_at > start_at),
	CONSTRAINT "appointments_buffer_min" CHECK (buffer_min >= 0),
	CONSTRAINT "appointments_status" CHECK (status IN ('hold', 'pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired')),
	CONSTRAINT "appointments_source" CHECK (source IN ('widget', 'admin', 'telegram')),
	CONSTRAINT "appointments_cancelled_by" CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'clinic', 'dentist', 'system')),
	CONSTRAINT "appointments_hold_has_expiry" CHECK (status <> 'hold' OR hold_expires_at IS NOT NULL),
	CONSTRAINT "appointments_patient_required" CHECK (status IN ('hold', 'expired') OR patient_id IS NOT NULL),
	CONSTRAINT "appointments_cancel_consistent" CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" "citext",
	"phone_verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "patients_clinic_phone_key" UNIQUE("clinic_id","phone"),
	CONSTRAINT "patients_phone_e164" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_verifications_phone_e164" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_verifications_attempts" CHECK (attempts >= 0),
	CONSTRAINT "phone_verifications_consumed_verified" CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "dentist_services" (
	"clinic_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "dentist_services_pkey" PRIMARY KEY("dentist_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "dentists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"telegram_chat_id" bigint,
	"telegram_blocked" boolean DEFAULT false NOT NULL,
	"telegram_linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dentists_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "dentists_telegram_chat_id_key" UNIQUE("telegram_chat_id")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "resources_kind" CHECK (kind IN ('room', 'chair', 'equipment'))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_min" integer NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"price" numeric(12, 2),
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "services_duration_min" CHECK (duration_min > 0),
	CONSTRAINT "services_buffer_min" CHECK (buffer_min >= 0),
	CONSTRAINT "services_price" CHECK (price IS NULL OR price >= 0)
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_token_key" UNIQUE("token"),
	CONSTRAINT "api_keys_token_prefix" CHECK (token LIKE 'pk\_%')
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency" char(3) NOT NULL,
	"min_lead_min" integer DEFAULT 120 NOT NULL,
	"slot_step_min" integer DEFAULT 15 NOT NULL,
	"max_advance_days" integer DEFAULT 60 NOT NULL,
	"booking_requires_confirmation" boolean DEFAULT false NOT NULL,
	"widget_theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_locale_format" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "clinics_currency_format" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "clinics_min_lead_min" CHECK (min_lead_min >= 0),
	CONSTRAINT "clinics_slot_step_min" CHECK (slot_step_min > 0),
	CONSTRAINT "clinics_max_advance_days" CHECK (max_advance_days > 0),
	CONSTRAINT "clinics_status" CHECK (status IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"timezone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_role" CHECK (role IN ('owner', 'admin', 'registrar', 'operator')),
	CONSTRAINT "users_operator_has_no_clinic" CHECK ((role = 'operator') = (clinic_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"patient_id" uuid,
	"dentist_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_channel" CHECK (channel IN ('sms', 'telegram')),
	CONSTRAINT "notifications_kind" CHECK (kind IN ('appointment_created', 'appointment_confirmed', 'appointment_cancelled', 'appointment_rescheduled', 'reminder_24h', 'reminder_2h')),
	CONSTRAINT "notifications_status" CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "notifications_one_recipient" CHECK (num_nonnulls(patient_id, dentist_id) = 1),
	CONSTRAINT "notifications_attempts" CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"clinic_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_tokens_hash_format" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "telegram_link_tokens_expiry" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"location_id" uuid,
	"type" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_exceptions_type" CHECK (type IN ('block', 'extra')),
	CONSTRAINT "schedule_exceptions_range" CHECK (end_at > start_at),
	CONSTRAINT "schedule_exceptions_extra_location" CHECK (type = 'block' OR location_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_hours_weekday" CHECK (weekday BETWEEN 1 AND 7),
	CONSTRAINT "working_hours_not_empty" CHECK (start_time <> end_time)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "public"."services"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_services" ADD CONSTRAINT "dentist_services_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_services" ADD CONSTRAINT "dentist_services_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentist_services" ADD CONSTRAINT "dentist_services_service_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "public"."services"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_location_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."appointments"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_location_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_location_fk" FOREIGN KEY ("clinic_id","location_id") REFERENCES "public"."locations"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_clinic_start_idx" ON "appointments" USING btree ("clinic_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_dentist_start_idx" ON "appointments" USING btree ("dentist_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("patient_id") WHERE patient_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_hold_expiry_idx" ON "appointments" USING btree ("hold_expires_at") WHERE status = 'hold';--> statement-breakpoint
CREATE INDEX "phone_verifications_lookup_idx" ON "phone_verifications" USING btree ("clinic_id","phone","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "dentist_services_service_idx" ON "dentist_services" USING btree ("clinic_id","service_id");--> statement-breakpoint
CREATE INDEX "dentists_clinic_priority_idx" ON "dentists" USING btree ("clinic_id","priority");--> statement-breakpoint
CREATE INDEX "api_keys_clinic_idx" ON "api_keys" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "users_clinic_idx" ON "users" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("scheduled_for") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "notifications_appointment_idx" ON "notifications" USING btree ("appointment_id") WHERE appointment_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reminder_once_idx" ON "notifications" USING btree ("appointment_id","kind","channel",coalesce(patient_id, dentist_id)) WHERE kind IN ('reminder_24h', 'reminder_2h') AND status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_dentist_idx" ON "telegram_link_tokens" USING btree ("dentist_id");--> statement-breakpoint
CREATE INDEX "working_hours_dentist_idx" ON "working_hours" USING btree ("dentist_id","weekday");