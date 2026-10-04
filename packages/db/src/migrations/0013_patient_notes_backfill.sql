-- Notes written before the client's notes history (patient_notes, 0012) existed. The client
-- card kept one text (patients.notes, written by the front desk; who exactly is unknown), and
-- each booking keeps its own note (appointments.notes). Both become entries of the history.
-- Earlier versions of a booking note are not restored: only its current text is known for sure.

-- The client card note: front desk, at the card's last change
INSERT INTO "patient_notes" ("clinic_id", "patient_id", "author", "text", "created_at")
SELECT "clinic_id", "id", 'staff', btrim("notes"), "updated_at"
FROM "patients"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';
--> statement-breakpoint

-- A booking note: whoever changed it last in the booking history (appointment_events, 0005);
-- never changed there — whoever made the booking: widget -> client, telegram -> the dentist
-- of the booking, admin -> staff
INSERT INTO "patient_notes" ("clinic_id", "patient_id", "appointment_id", "author", "user_id", "dentist_id", "text", "created_at")
SELECT
  a."clinic_id",
  a."patient_id",
  a."id",
  coalesce(
    e."actor",
    CASE a."source" WHEN 'widget' THEN 'client' WHEN 'telegram' THEN 'dentist' ELSE 'staff' END
  ),
  CASE WHEN e."id" IS NOT NULL THEN e."user_id" WHEN a."source" = 'admin' THEN a."created_by" END,
  CASE WHEN e."id" IS NOT NULL THEN e."dentist_id" WHEN a."source" = 'telegram' THEN a."dentist_id" END,
  btrim(a."notes"),
  coalesce(e."created_at", a."created_at")
FROM "appointments" AS a
LEFT JOIN LATERAL (
  SELECT ev."id", ev."actor", ev."user_id", ev."dentist_id", ev."created_at"
  FROM "appointment_events" AS ev
  WHERE ev."appointment_id" = a."id" AND ev."changes" ? 'notes'
  ORDER BY ev."created_at" DESC
  LIMIT 1
) AS e ON true
WHERE a."notes" IS NOT NULL
  AND btrim(a."notes") <> ''
  AND a."patient_id" IS NOT NULL
  AND a."status" NOT IN ('hold', 'expired');
