# DentBook Public Booking API

This is the API behind the DentBook booking form. Use it if you build your own booking form
instead of [embedding ours](../embed.md). Most clinics don't need it: the embedded form
already calls these endpoints.

- **Base URL:** `https://<platform-domain>/v1/public`. The test environment is
  `https://dentbook.mashna.am/v1/public`.
- **Format:** JSON over HTTPS. Field names are `snake_case`.
- **Time:** every instant is ISO 8601 in UTC, for example `2026-09-21T14:00:00.000Z`. Show it
  to the client in the office time zone, which responses return as `time_zone`.
- **Version:** `v1`. Fields may be added to responses. Nothing is renamed or removed
  without a new version.

## Authentication

Every request carries the clinic's publishable key and runs from an allowed website:

```http
Authorization: Bearer pk_…
Origin: https://www.your-clinic.com
```

- The key comes from the clinic panel: **Website → New key**. It's meant to be public: it
  sits in your website's HTML.
- Protection comes from the list of allowed websites on the key. The `Origin` header must
  match one of them exactly (scheme, host, port; no trailing slash). Otherwise the answer is
  `403 origin_not_allowed`.
- The key can only read services and free times and create bookings. It can't see other
  bookings or client data.
- A revoked key, or the key of a suspended clinic, gets `401 invalid_key`.
- Browsers send `Origin` on their own, and CORS preflight is supported. A server-side
  integration must set `Origin` explicitly to one of the allowed websites.

## Rate limits

| Limit                                          | Default     | Response           |
| ---------------------------------------------- | ----------- | ------------------ |
| Requests per key                               | 60 / minute | `429 rate_limited` |
| `POST /holds` and `POST /verifications` per IP | 10 / minute | `429 rate_limited` |
| SMS codes per phone number                     | 5 / hour    | `429 rate_limited` |

## Errors

Every error has the same shape. Some add fields next to `error`:

```json
{
  "error": { "code": "slot_taken", "message": "The time is no longer available" },
  "alternatives": ["2026-09-21T14:30:00.000Z", "2026-09-21T15:00:00.000Z"]
}
```

Rely on `code`, not `message`: codes are stable, messages are for people.

| HTTP | `code`                  | When                                                            |
| ---- | ----------------------- | --------------------------------------------------------------- |
| 400  | `validation_failed`     | A field is missing or malformed; `message` names the fields     |
| 400  | `verification_required` | No captcha answer (captcha is on), or no SMS code yet           |
| 400  | `verification_failed`   | Wrong or expired SMS code (3 attempts), or failed captcha       |
| 401  | `invalid_key`           | Unknown or revoked key, or suspended clinic                     |
| 403  | `origin_not_allowed`    | `Origin` is not on the key's list                               |
| 404  | `not_found`             | Unknown service, office, hold or booking — or not this clinic's |
| 409  | `slot_taken`            | The time was just taken; `alternatives` lists free times nearby |
| 409  | `validation_failed`     | Cancelling a booking that has already started or finished       |
| 410  | `hold_expired`          | The hold ran out before the booking was confirmed               |
| 429  | `rate_limited`          | Too many requests; wait for `Retry-After` seconds when present  |
| 503  | `internal_error`        | SMS is not set up on the platform yet                           |
| 500  | `internal_error`        | Something broke on our side                                     |

## Booking flow

```
GET /config ─► GET /services ─► GET /availability ─► POST /holds ─► POST /verifications ─► POST /appointments
                                                          │               (SMS code)             │
                                                          └── DELETE /holds/:id (client left)     └─► token → status / cancel
```

1. Show services and free times.
2. When the client picks a time, **hold** it. The time is theirs for 10 minutes; show a
   countdown.
3. Ask for the phone number and send an **SMS code**. Pass the captcha answer if captcha is on.
4. **Confirm** with the hold, the code and the client's details. The response carries a
   `token`. Keep it: it lets the client check or cancel the booking later.

A dentist is assigned automatically: the free dentist with the highest priority in the
clinic.

## Endpoints

### `GET /config`

Form settings: clinic name and language, colors, offices, captcha.

```json
{
  "clinic": { "name": "Smile Dental", "locale": "en", "currency": "USD" },
  "theme": { "primary_color": "#0d9488" },
  "locations": [
    {
      "id": "d5c4…",
      "name": "Main office",
      "address": "12 Main St",
      "phone": "+12025550100",
      "time_zone": "America/New_York"
    }
  ],
  "captcha": { "provider": "turnstile", "site_key": "0x4AAA…" }
}
```

`captcha` is `null` when it's off. When it's on, render Cloudflare Turnstile with
`site_key` and send its answer as `captcha_token` to `POST /verifications`.

### `GET /services`

Services open to online booking, in the clinic's order.

```json
[
  {
    "id": "e20d…",
    "name": "Consultation",
    "description": null,
    "duration_min": 30,
    "price": "80.00",
    "currency": "USD"
  }
]
```

`price` is a decimal string, or `null` when the clinic doesn't show prices.

### `GET /availability`

Free start times: `?service_id=…&location_id=…&from=2026-09-21&to=2026-09-27`. `from` and
`to` are office-local dates, up to 31 days. Past dates, times inside the clinic's minimum
notice and dates beyond its booking horizon come back empty.

```json
{
  "time_zone": "America/New_York",
  "duration_min": 30,
  "days": [
    { "date": "2026-09-21", "slots": ["2026-09-21T13:00:00.000Z", "2026-09-21T13:15:00.000Z"] },
    { "date": "2026-09-22", "slots": [] }
  ]
}
```

A time is listed if at least one dentist who provides the service is free. Free times are
cached for up to 60 seconds, so a listed time can be gone by the time you hold it. That's
what `409 slot_taken` is for.

### `POST /holds`

Hold a time for 10 minutes. The same database constraint that prevents double bookings
guards it, so at most one client gets a given dentist's time.

```json
// request
{ "service_id": "e20d…", "location_id": "d5c4…", "start_at": "2026-09-21T13:00:00.000Z" }
// 201
{ "hold_id": "7b1e…", "expires_at": "2026-09-18T20:10:00.000Z",
  "start_at": "2026-09-21T13:00:00.000Z", "end_at": "2026-09-21T13:30:00.000Z",
  "dentist": { "id": "a1f0…", "full_name": "Dr. Anna" } }
```

If the time is taken, the response is `409 slot_taken` with `alternatives`: up to 6 free
times the same day closest to the one asked for, in time order.

### `DELETE /holds/:id`

Release a hold when the client leaves or goes back. The time frees up at once instead of
after 10 minutes. `204` on success.

### `POST /verifications`

Send a 6-digit SMS code to the client's phone. The phone number must be in E.164 format,
for example `+12025550123`. A code lives 5 minutes and allows 3 attempts.

```json
// request
{ "phone": "+12025550123", "locale": "en", "captcha_token": "0.Ab…" }
// 201
{ "verification_id": "c3d9…", "expires_at": "2026-09-18T20:05:00.000Z" }
```

`locale` (`en`, `ru`, `hy`) sets the SMS language; by default it's the clinic's.

### `POST /appointments`

Confirm the booking.

```json
// request
{
  "hold_id": "7b1e…",
  "verification_id": "c3d9…",
  "code": "482913",
  "client": { "full_name": "Jane Client", "phone": "+12025550123", "email": "jane@example.com" },
  "notes": "First visit"
}
// 201
{
  "id": "7b1e…", "status": "confirmed",
  "start_at": "2026-09-21T13:00:00.000Z", "end_at": "2026-09-21T13:30:00.000Z",
  "time_zone": "America/New_York",
  "service": { "id": "e20d…", "name": "Consultation" },
  "dentist": { "id": "a1f0…", "full_name": "Dr. Anna" },
  "location": { "id": "d5c4…", "name": "Main office", "address": "12 Main St" },
  "token": "q8…"
}
```

- `status` is `confirmed`, or `pending` if the clinic confirms bookings by hand. A pending
  booking still holds the time. The client gets an SMS once it's confirmed.
- `client.phone` must be the phone that received the code. `email` and `notes` are
  optional.
- Clients get SMS reminders 24 hours and 2 hours before the visit.

### `GET /appointments/:id?token=…`

The booking as in the confirmation response, without `token`. `status` can also be
`cancelled`, `completed` or `no_show`.

### `POST /appointments/:id/cancel`

Cancel by the client: `{ "token": "q8…" }`. It works only for a booking that hasn't started
yet. The time frees up at once, reminders are called off, and the dentist is told.
Repeating the call is safe: it returns the cancelled booking again.

## Privacy

Client names, phone numbers and emails are used only for the booking and its SMS. They never
appear in platform logs.
