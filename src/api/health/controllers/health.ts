import type { Core } from '@strapi/strapi';

const strapiVersion = require('@strapi/strapi/package.json').version as string;

const isProduction = process.env.NODE_ENV === 'production';

const isCloudinaryConfigured = () =>
  [process.env.CLOUDINARY_NAME, process.env.CLOUDINARY_KEY, process.env.CLOUDINARY_SECRET].every(
    (value) => typeof value === 'string' && value.trim().length > 0
  );

const isDatabaseConfigured = () => {
  const client = (process.env.DATABASE_CLIENT ?? '').trim();
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  const databaseFilename = (process.env.DATABASE_FILENAME ?? '').trim();

  if (isProduction) {
    return client === 'postgres' && databaseUrl.length > 0;
  }

  if (client === 'postgres') {
    return databaseUrl.length > 0;
  }

  return databaseFilename.length > 0 || client === 'sqlite' || databaseUrl.length > 0;
};

const isPublicUrlConfigured = () => (process.env.STRAPI_PUBLIC_URL ?? '').trim().length > 0;

const isCorsConfigured = () => {
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    return false;
  }

  if (isProduction) {
    return origins.length > 0;
  }

  return true;
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async health(ctx: any) {
    ctx.body = {
      status: 'ok',
      app: 'creare-cms',
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
      strapiVersion,
      databaseConfigured: isDatabaseConfigured(),
      cloudinaryConfigured: isCloudinaryConfigured(),
      publicUrlConfigured: isPublicUrlConfigured(),
      corsConfigured: isCorsConfigured(),
    };
  },

  async ready(ctx: any) {
    try {
      await strapi.db.connection.raw('select 1');

      ctx.body = {
        status: 'ready',
      };
    } catch {
      ctx.status = 503;
      ctx.body = {
        status: 'not_ready',
      };
    }
  },
});
