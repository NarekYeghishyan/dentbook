CREATE TABLE "appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"user_id" uuid,
	"dentist_id" uuid,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_events_type" CHECK (type IN ('created', 'confirmed', 'updated', 'moved', 'cancelled', 'completed', 'no_show')),
	CONSTRAINT "appointment_events_actor" CHECK (actor IN ('client', 'dentist', 'staff', 'system')),
	CONSTRAINT "appointment_events_user_is_staff" CHECK (user_id IS NULL OR actor = 'staff'),
	CONSTRAINT "appointment_events_dentist_acts" CHECK (dentist_id IS NULL OR actor = 'dentist')
);
--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."appointments"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_events_appointment_idx" ON "appointment_events" USING btree ("appointment_id","created_at");