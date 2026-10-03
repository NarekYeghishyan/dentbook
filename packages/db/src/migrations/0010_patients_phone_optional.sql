ALTER TABLE "patients" DROP CONSTRAINT "patients_phone_not_blank";--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_phone_not_blank" CHECK (phone IS NULL OR btrim(phone) <> '');