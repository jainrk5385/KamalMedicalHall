# OTP reviewer mode

## Default behaviour

The application defaults to **Pearl SMS OTP**. The stored MongoDB `sms_settings` record
uses `otpChannel: "sms"` by default, including for existing records that do not yet have
an `otpChannel` field.

## Enable static OTP for a reviewer

1. Sign in to the Admin Panel with an authorized admin account.
2. Open **Admin → SMS Settings → OTP Authentication**.
3. Select **Static OTP (review)**.
4. Add only the dedicated reviewer/test phone numbers in the allowlist.
5. Save the settings.
6. For those allowlisted numbers, request OTP and enter `123456`.
7. All phone numbers not on the allowlist continue receiving real Pearl SMS OTP.

The static code is valid only after an OTP-send request creates a five-minute, one-time
OTP record. Existing resend cooldowns and maximum-attempt checks still apply.

## Return to normal production mode

Select **SMS OTP (Pearl)** and save. All users then receive real SMS OTP. The reviewer
allowlist remains stored but is inactive until reviewer mode is selected again.

## Security / verification notes

- Never add ordinary customer phone numbers to the reviewer allowlist.
- Prefer a dedicated reviewer customer account with non-sensitive demo data.
- Do not add a primary store-admin account to the reviewer allowlist. The application
  currently has role-based admin authorization, not a separate read-only reviewer role.
- OTP mode and allowlist changes are recorded in the `otp_mode_audit` collection.
- This feature does not grant admin access: the existing user record, active-account
  check, JWT issuance, and role middleware still apply.
- Google Play, Pine Labs, and Razorpay may have their own verification requirements.
  A static OTP login is a technical test path, not a guarantee of approval.
