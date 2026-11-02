import assert from 'node:assert/strict';
import type { Router } from 'express';
import { test } from 'node:test';

// Give route-module imports isolated, non-production configuration. No DB connection is made.
process.env.AUTH_MODE = 'sms';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/kmh-admin-route-tests';
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
process.env.NODE_ENV = 'test';

const [{ adminRouter }, { authed }, { User }, { default: DeliveryPartner }, { ServicePincode }] = await Promise.all([
  import('../src/routes/staff.js'),
  import('../src/auth.js'),
  import('../src/models/User.js'),
  import('../src/models/DeliveryPartner.js'),
  import('../src/models/ServicePincode.js'),
]);

type RouteLayer = {
  handle?: unknown;
  route?: { path: string; methods: Record<string, boolean> };
};

function routeIndex(router: Router, method: string, path: string): number {
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;
  return layers.findIndex((layer) => layer.route?.path === path && layer.route.methods[method]);
}

function routeHandler(router: Router, method: string, path: string): (req: unknown, res: unknown) => Promise<void> {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack?: Array<{ handle?: unknown }> } }> }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  const handler = layer?.route?.stack?.at(-1)?.handle;
  assert.equal(typeof handler, 'function', `${method.toUpperCase()} ${path} handler must exist`);
  return handler as (req: unknown, res: unknown) => Promise<void>;
}

test('partner creation, attendance, and broadcast routes are registered behind admin auth', () => {
  const layers = (adminRouter as unknown as { stack: RouteLayer[] }).stack;
  const authIndex = layers.findIndex((layer) => layer.handle === authed);
  assert.ok(authIndex >= 0, 'admin router must include bearer authentication');

  for (const [method, path] of [
    ['post', '/partners'],
    ['post', '/pincodes'],
    ['get', '/attendance'],
    ['post', '/broadcast'],
  ]) {
    const index = routeIndex(adminRouter, method, path);
    assert.ok(index > authIndex, `${method.toUpperCase()} ${path} must follow admin auth`);
  }
});

test('delivery partner creation removes its user record if profile creation fails', async () => {
  const userModel = User as any;
  const partnerModel = DeliveryPartner as any;
  const originalUserCreate = userModel.create;
  const originalUserDeleteOne = userModel.deleteOne;
  const originalPartnerCreate = partnerModel.create;
  let cleanedUp = false;

  userModel.create = async () => ({ _id: { toString: () => 'new-user-id' } });
  userModel.deleteOne = () => ({ exec: async () => { cleanedUp = true; return { deletedCount: 1 }; } });
  partnerModel.create = async () => { throw new Error('profile creation failed'); };

  try {
    await assert.rejects(
      routeHandler(adminRouter, 'post', '/partners')({ body: { name: 'New Partner', phone: '9876543210' } }, {}),
      /profile creation failed/,
    );
    assert.equal(cleanedUp, true);
  } finally {
    userModel.create = originalUserCreate;
    userModel.deleteOne = originalUserDeleteOne;
    partnerModel.create = originalPartnerCreate;
  }
});

test('pincode creation uses idempotent bulk upserts and returns the unique count', async () => {
  const pincodeModel = ServicePincode as any;
  const originalBulkWrite = pincodeModel.bulkWrite;
  let operations: any[] = [];
  const response: { code?: number; body?: unknown; status: (code: number) => unknown; json: (body: unknown) => void } = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; },
  };

  pincodeModel.bulkWrite = async (ops: any[]) => { operations = ops; return { ok: 1 }; };

  try {
    await routeHandler(adminRouter, 'post', '/pincodes')(
      { body: { pincodes: ['302020', '302020', '302021'] } },
      response,
    );
    assert.equal(operations.length, 2);
    assert.equal(operations.every((op) => op.updateOne.upsert === true), true);
    assert.equal(response.code, 201);
    assert.deepEqual(response.body, { added: 2 });
  } finally {
    pincodeModel.bulkWrite = originalBulkWrite;
  }
});
