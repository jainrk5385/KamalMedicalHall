
import './monitoring.js'; // first, so the error reporter is ready before anything else runs
import http from 'node:http';
import compression from 'compression';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { observe } from './observability.js';
import {
  cachePolicy,
  corsMiddleware,
  generalLimit,
  httpGate,
  uploadSignLimit,
  writeLimit,
} from './security.js';
import { closingAlertTick } from './cash.js';
import { config } from './config.js';
import { connectToMongo } from './db.js';
import { errorHandler } from './http.js';
import { sweepDuty } from './partnerState.js';
import { attachRealtime } from './realtime.js';

import { chatAdmin, chatRouter } from './routes/chat.js';
import { adminExtras, exportDownload, reviewsRouter } from './routes/extras.js';
import { otpRouter } from './otp.js';
import { announcementsAdmin, announcementsPublic } from './routes/announcements.js';
import { shopAdmin, shopPublic } from './routes/shop.js';
import { accountRouter, customersAdmin } from './routes/customers.js';
import { smsAdmin } from './routes/sms.js';
import { general } from './routes/general.js';
import { orders, razorpayWebhook } from './routes/orders.js';
import { adminRouter, partnerRouter } from './routes/staff.js';

import { User } from './models/User.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(observe);
  app.use(httpGate);
  app.use(helmet());
  app.use(corsMiddleware);
  app.use(compression());
  app.use(cachePolicy);

  // Razorpay webhook needs the raw body before the JSON parser.
  app.use('/webhooks/razorpay', razorpayWebhook);

  app.use(express.json({ limit: '100kb' }));

  app.use(
    '/auth',
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(generalLimit);

  app.post('/uploads/sign', uploadSignLimit);
  app.post('/chat/messages', writeLimit);
  app.post('/reviews', writeLimit);
  app.post('/orders', writeLimit);
  app.post('/admin/broadcast', writeLimit);
  app.get('/admin/export-link', writeLimit);
  app.post('/admin/sms/test', writeLimit);
  app.post('/account/requests', writeLimit);

// Authentication: Pearl SMS by default; static OTP is limited to approved reviewer numbers.
  app.use('/auth/otp', otpRouter);

  // Public routes.
  app.use('/', shopPublic);
  app.use('/', announcementsPublic);

  // Admin routes.
  app.use('/admin', shopAdmin);
  app.use('/admin', announcementsAdmin);
  app.use('/admin', smsAdmin);
  app.use('/admin', customersAdmin);
  app.use('/admin', adminRouter);
  app.use('/admin', chatAdmin);
  app.use('/admin', adminExtras);

  // Account and general routes.
  app.use('/account', accountRouter);
  app.use('/', general);

  // Orders and customer-facing features.
  app.use('/orders', orders);
  app.use('/chat', chatRouter);
  app.use('/reviews', reviewsRouter);
  app.use('/export', exportDownload);

  // Delivery partner routes.
  app.use('/partner', partnerRouter);

  // Not found handler.
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Not found',
      },
    });
  });

  app.use(errorHandler);

  return app;
}

/** HTTP server with the real-time (socket.io) channel attached. */
export function createServer() {
  const server = http.createServer(createApp());

  attachRealtime(server);

  return server;
}

/** Provisions the first admin(s) from environment configuration. */
export async function bootstrap() {
  for (const phone of config.bootstrapAdminPhones) {
    await User.findOneAndUpdate(
      { phone },
      {
        $set: {
          role: 'admin',
          name: 'Store Admin',
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    );
  }
}

if (
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.js')
) {
  // Connect to MongoDB.
  await connectToMongo();

  await bootstrap();

  await sweepDuty().catch((error) => {
    console.error('duty sweep failed', error);
  });

  setInterval(() => {
    void closingAlertTick().catch((error) => {
      console.error('closing alert failed', error);
    });
  }, 60 * 1000).unref();

  setInterval(() => {
    void sweepDuty().catch((error) => {
      console.error('duty sweep failed', error);
    });
  }, 10 * 60 * 1000).unref();

  createServer().listen(config.port, () => {
    console.log(`API listening on :${config.port} (auth: ${config.authMode})`);
  });
}
