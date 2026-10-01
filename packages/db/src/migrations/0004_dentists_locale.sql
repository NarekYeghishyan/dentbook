ALTER TABLE "dentists" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_locale" CHECK (locale IN ('en', 'ru', 'hy'));