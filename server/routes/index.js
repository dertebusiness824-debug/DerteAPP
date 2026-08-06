import express from 'express';
import config from '../config.js';
import { queryOne } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import zadarma from '../services/zadarma.js';
import adminRouter from './admin.js';
import appointmentsRouter from './appointments.js';
import authRouter from './auth.js';
import chatRouter from './chat.js';
import notificationsRouter from './notifications.js';
import publicRouter from './public.js';
import shopsRouter from './shops.js';
import telephonyRouter, { webhookRouter } from './telephony.js';
import webhooksRouter from './webhooks.js';

const router = express.Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let database = 'up';
    try {
      await queryOne('SELECT 1 AS ok');
    } catch {
      database = 'down';
    }
    res.status(database === 'up' ? 200 : 503).json({
      app: config.appName,
      status: database === 'up' ? 'ok' : 'degraded',
      env: config.env,
      database,
      telephony: zadarma.isConfigured() ? 'configured' : 'not_configured',
      time: new Date().toISOString(),
    });
  }),
);

// Unauthenticated, signature-verified provider callbacks.
router.use('/webhooks', webhooksRouter);
router.use('/telephony/webhooks', webhookRouter);

router.use('/auth', authRouter);
router.use('/shops', shopsRouter);
router.use('/appointments', appointmentsRouter);
router.use('/chat', chatRouter);
router.use('/notifications', notificationsRouter);
router.use('/telephony', telephonyRouter);
router.use('/admin', adminRouter);
router.use('/public', publicRouter);

export default router;
