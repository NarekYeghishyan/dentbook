CREATE TABLE "patient_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"author" text NOT NULL,
	"user_id" uuid,
	"dentist_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_notes_author" CHECK (author IN ('client', 'dentist', 'staff', 'system')),
	CONSTRAINT "patient_notes_user_is_staff" CHECK (user_id IS NULL OR author = 'staff'),
	CONSTRAINT "patient_notes_dentist_writes" CHECK (dentist_id IS NULL OR author = 'dentist'),
	CONSTRAINT "patient_notes_text" CHECK (btrim(text) <> '' AND char_length(text) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_appointment_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "public"."appointments"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_dentist_fk" FOREIGN KEY ("clinic_id","dentist_id") REFERENCES "public"."dentists"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_notes_patient_idx" ON "patient_notes" USING btree ("patient_id","created_at");