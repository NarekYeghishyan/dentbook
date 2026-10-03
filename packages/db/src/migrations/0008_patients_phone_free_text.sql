ALTER TABLE "patients" DROP CONSTRAINT "patients_phone_e164";--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_phone_not_blank" CHECK (btrim(phone) <> '');