-- What the Drizzle DSL cannot express (ADR-0003). Requires btree_gist from 0000.

-- CLAUDE.md §2.1, verbatim: double booking is impossible at the database level.
-- Violation -> SQLSTATE 23P01 -> API error slot_taken.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_dentist_overlap" EXCLUDE USING gist (
  dentist_id WITH =,
  tstzrange(start_at, end_at) WITH &&
) WHERE (status IN ('hold', 'pending', 'confirmed'));
--> statement-breakpoint

-- Range lookups for a dentist's schedule exceptions (block / extra).
CREATE INDEX "schedule_exceptions_dentist_range_idx"
  ON "schedule_exceptions" USING gist (dentist_id, tstzrange(start_at, end_at));
