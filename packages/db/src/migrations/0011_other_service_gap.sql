-- "Other" (a one-time service, 0009) now keeps the clinic's slot step free after the visit,
-- like the buffer after a catalogue service. "Other" services and bookings made before that
-- had no buffer: they get it here.

UPDATE "services" AS s
SET "buffer_min" = c."slot_step_min"
FROM "clinics" AS c
WHERE c."id" = s."clinic_id" AND s."one_time" AND s."buffer_min" = 0;
--> statement-breakpoint

-- blocked_until moves with the buffer (CHECK appointments_blocked_until). A booking whose
-- longer time would run into the dentist's next booking keeps its old time: the EXCLUDE
-- constraint (§2.1) would refuse the update and stop the whole migration.
UPDATE "appointments" AS a
SET
  "buffer_min" = c."slot_step_min",
  "blocked_until" = a."end_at" + c."slot_step_min" * interval '1 minute'
FROM "services" AS s, "clinics" AS c
WHERE s."id" = a."service_id"
  AND c."id" = a."clinic_id"
  AND s."one_time"
  AND a."buffer_min" = 0
  AND NOT EXISTS (
    SELECT 1
    FROM "appointments" AS b
    WHERE b."dentist_id" = a."dentist_id"
      AND b."id" <> a."id"
      AND a."status" IN ('hold', 'pending', 'confirmed')
      AND b."status" IN ('hold', 'pending', 'confirmed')
      AND tstzrange(b."start_at", b."blocked_until")
        && tstzrange(a."end_at", a."end_at" + c."slot_step_min" * interval '1 minute')
  );
