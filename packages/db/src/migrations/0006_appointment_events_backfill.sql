-- History for bookings made before appointment_events existed (0005). Only two facts are
-- known about them: creation (created_at, source) and cancellation (cancelled_at,
-- cancelled_by). Earlier moves and edits were never stored, so they are not invented here.

-- created: widget -> client, telegram -> the dentist of the booking, admin -> staff
INSERT INTO "appointment_events" ("clinic_id", "appointment_id", "type", "actor", "user_id", "dentist_id", "created_at")
SELECT
  "clinic_id",
  "id",
  'created',
  CASE "source" WHEN 'widget' THEN 'client' WHEN 'telegram' THEN 'dentist' ELSE 'staff' END,
  CASE WHEN "source" = 'admin' THEN "created_by" END,
  CASE WHEN "source" = 'telegram' THEN "dentist_id" END,
  "created_at"
FROM "appointments"
WHERE "status" NOT IN ('hold', 'expired');
--> statement-breakpoint

-- cancelled: cancelled_by clinic -> staff (who exactly is unknown)
INSERT INTO "appointment_events" ("clinic_id", "appointment_id", "type", "actor", "user_id", "dentist_id", "created_at")
SELECT
  "clinic_id",
  "id",
  'cancelled',
  CASE "cancelled_by"
    WHEN 'client' THEN 'client'
    WHEN 'dentist' THEN 'dentist'
    WHEN 'clinic' THEN 'staff'
    ELSE 'system'
  END,
  NULL,
  CASE WHEN "cancelled_by" = 'dentist' THEN "dentist_id" END,
  "cancelled_at"
FROM "appointments"
WHERE "status" = 'cancelled';
