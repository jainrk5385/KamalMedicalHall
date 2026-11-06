# OTP reviewer-mode implementation

## Files changed

- `backend/src/models/SmsSettings.ts` — adds `otpChannel: "sms" | "static"` and reviewer phone allowlist.
- `backend/src/models/OtpModeAudit.ts` — records OTP mode / allowlist changes.
- `backend/src/sms.ts` — loads the persisted channel and reviewer allowlist; missing/legacy mode defaults to SMS.
- `backend/src/routes/sms.ts` — admin-only mode update, phone normalization, allowlist validation, and audit entry.
- `backend/src/otp.ts` — issues a hashed, five-minute, one-time `123456` OTP only for allowlisted phones; all other numbers continue using Pearl SMS.
- `backend/src/server.ts` — updates the auth-route comment.
- `mobile/src/api/endpoints.ts` — types the new settings.
- `mobile/src/screens/admin/SmsSettings.tsx` — adds the SMS / Static reviewer selector and allowlist editor.
- `mobile/src/localization/en/common.json` and `mobile/src/localization/hi/common.json` — clarifies the reviewer OTP banner.
- `docs/OTP_REVIEW_MODE.md` — setup and security instructions.

Obsolete, unreferenced `backend/src/otp-backup.ts` and `backend/src/sms-backup.ts` were removed. They contained legacy Firebase/Twilio code and prevented the current backend TypeScript project from typechecking.

## Applying the bundle

Copy the listed changed files into the existing repository and remove the two obsolete backup source files if present. Preserve the existing `.env` files, Firebase `google-services.json`, signing keys, and all production credentials; these are intentionally not included in this sanitized source bundle.

Run backend and mobile typechecks before committing and deploying.
