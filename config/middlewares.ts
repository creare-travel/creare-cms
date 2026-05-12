import type { Core } from '@strapi/strapi';

const isProduction = process.env.NODE_ENV === 'production';
const devDefaultOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4028',
  'http://127.0.0.1:3000',
];

const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (configuredOrigins.includes('*')) {
  throw new Error(
    'CORS misconfiguration: wildcard "*" is not allowed in CORS_ORIGIN. Use an explicit comma-separated allowlist instead.'
  );
}

if (isProduction && configuredOrigins.length === 0) {
  throw new Error(
    'Production CORS misconfiguration: CORS_ORIGIN must include at least one explicit allowed origin when NODE_ENV=production.'
  );
}

const corsOrigins = isProduction
  ? configuredOrigins
  : Array.from(new Set([...devDefaultOrigins, ...configuredOrigins]));

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:', 'res.cloudinary.com', '*.cloudinary.com'],
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      credentials: false,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
