-- A booking has one note, and the client's notes history shows it as one entry (Q19): a new
-- text of the booking note changes that entry instead of adding another one. Until now every
-- new text was added as a new entry. Here each booking keeps its newest entry (the current
-- text, by whoever wrote it), dated by when the booking note first appeared, and loses the
-- rest. The booking history (appointment_events) still has every version.

-- Until now an entry never changed: its text was written when the entry was made
UPDATE "patient_notes" SET "updated_at" = "created_at";
--> statement-breakpoint

-- The newest entry of each booking takes the time of the booking's first entry
UPDATE "patient_notes" AS n
SET "created_at" = f."first_at"
FROM (
  SELECT
    "appointment_id",
    min("created_at") AS "first_at",
    (array_agg("id" ORDER BY "created_at" DESC, "id" DESC))[1] AS "newest_id"
  FROM "patient_notes"
  WHERE "appointment_id" IS NOT NULL
  GROUP BY "appointment_id"
) AS f
WHERE n."id" = f."newest_id";
--> statement-breakpoint

-- The older entries of a booking go: updated_at still holds when each one was written
DELETE FROM "patient_notes" AS n
WHERE n."appointment_id" IS NOT NULL
  AND n."id" <> (
    SELECT p."id"
    FROM "patient_notes" AS p
    WHERE p."appointment_id" = n."appointment_id"
    ORDER BY p."updated_at" DESC, p."id" DESC
    LIMIT 1
  );
--> statement-breakpoint

-- The entry shows the booking's current note and follows the booking's current client;
-- a booking whose note was removed has no entry
DELETE FROM "patient_notes" AS n
USING "appointments" AS a
WHERE a."id" = n."appointment_id" AND (a."notes" IS NULL OR btrim(a."notes") = '');
--> statement-breakpoint

UPDATE "patient_notes" AS n
SET "text" = btrim(a."notes"), "patient_id" = a."patient_id"
FROM "appointments" AS a
WHERE a."id" = n."appointment_id"
  AND a."patient_id" IS NOT NULL
  AND (n."text" <> btrim(a."notes") OR n."patient_id" <> a."patient_id");
