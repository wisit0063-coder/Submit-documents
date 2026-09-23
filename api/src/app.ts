import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { router } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { env } from './config/env';

export function createApp() {
  const app = express();

  // Passenger (or the nginx container) sits in front of the app, so its
  // forwarded headers are trusted for the client IP.
  //
  // A hop count, never `true`: trusting every hop makes req.ip the leftmost
  // X-Forwarded-For entry, which the caller writes themselves. That would let
  // anyone rotate their apparent address freely and walk straight past the login
  // and sign-up rate limits, and would put forged addresses in the audit trail.
  app.set('trust proxy', env.trustProxyHops);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA is served by Apache from public_html, not from here.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // The SPA and the API share one domain, so no CORS layer is needed.
  app.use('/api', router);
  // Passenger may mount the app at /api already; accept both shapes.
  app.use('/', router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const appConfig = { port: env.port };
