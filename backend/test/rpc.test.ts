import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopbackHostFor } from '../src/rpc.js';

test('RPC loopback uses an IPv4 address for an IPv4 listener', () => {
  assert.equal(loopbackHostFor({ family: 'IPv4' }), '127.0.0.1');
});

test('RPC loopback uses an IPv6 address for an IPv6 listener', () => {
  assert.equal(loopbackHostFor({ family: 'IPv6' }), '::1');
});
