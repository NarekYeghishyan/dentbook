-- Q11: запись держит время вместе с буфером после приёма; EXCLUDE (§2.1) строится по
-- blocked_until = end_at + buffer_min. Сгенерировано drizzle-kit, дополнено вручную:
-- заполнение существующих строк и замена EXCLUDE (DSL Drizzle их не выражает).
ALTER TABLE "appointments" ADD COLUMN "blocked_until" timestamp with time zone;--> statement-breakpoint
UPDATE "appointments" SET "blocked_until" = "end_at" + "buffer_min" * interval '1 minute';--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "blocked_until" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_blocked_until" CHECK (blocked_until = end_at + buffer_min * interval '1 minute');--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_dentist_overlap";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_dentist_overlap" EXCLUDE USING gist (
  dentist_id WITH =,
  tstzrange(start_at, blocked_until) WITH &&
) WHERE (status IN ('hold', 'pending', 'confirmed'));
