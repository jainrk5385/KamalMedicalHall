import assert from 'node:assert/strict';
import type { Router } from 'express';
import { test } from 'node:test';

// Give route-module imports isolated, non-production configuration. No DB connection is made.
process.env.AUTH_MODE = 'sms';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/kmh-admin-route-tests';
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
process.env.NODE_ENV = 'test';

const [{ adminRouter }, { authed }] = await Promise.all([
  import('../src/routes/staff.js'),
  import('../src/auth.js'),
]);

type RouteLayer = {
  handle?: unknown;
  route?: { path: string; methods: Record<string, boolean> };
};

function routeIndex(router: Router, method: string, path: string): number {
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;
  return layers.findIndex((layer) => layer.route?.path === path && layer.route.methods[method]);
}

test('partner creation, attendance, and broadcast routes are registered behind admin auth', () => {
  const layers = (adminRouter as unknown as { stack: RouteLayer[] }).stack;
  const authIndex = layers.findIndex((layer) => layer.handle === authed);
  assert.ok(authIndex >= 0, 'admin router must include bearer authentication');

  for (const [method, path] of [
    ['post', '/partners'],
    ['get', '/attendance'],
    ['post', '/broadcast'],
  ]) {
    const index = routeIndex(adminRouter, method, path);
    assert.ok(index > authIndex, `${method.toUpperCase()} ${path} must follow admin auth`);
  }
});
