import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firebaseWebSendError } from '../src/auth/firebaseWebErrors';

describe('Firebase web OTP errors', () => {
  it('explains when the current website domain is not authorized', () => {
    const error = firebaseWebSendError({ code: 'auth/unauthorized-domain' });
    assert.equal(error.code, 'otp_unauthorized-domain');
    assert.match(error.message, /not enabled for this website/i);
  });

  it('explains common phone auth and browser verification failures', () => {
    assert.match(firebaseWebSendError({ code: 'auth/operation-not-allowed' }).message, /not enabled/i);
    assert.match(firebaseWebSendError({ code: 'auth/captcha-check-failed' }).message, /verify this browser/i);
    assert.match(firebaseWebSendError({ code: 'auth/network-request-failed' }).message, /internet connection/i);
  });

  it('keeps unknown Firebase errors safe and generic', () => {
    const error = firebaseWebSendError({ code: 'auth/internal-error', message: 'private backend detail' });
    assert.equal(error.message, 'Could not send the OTP. Please try again.');
    assert.doesNotMatch(error.message, /private backend detail/);
  });
});
