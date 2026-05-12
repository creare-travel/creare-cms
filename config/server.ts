import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => {
  const nodeEnv = env('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const publicUrl = env('STRAPI_PUBLIC_URL', undefined);

  if (isProduction && !publicUrl) {
    throw new Error(
      'Production server misconfiguration: STRAPI_PUBLIC_URL is required when NODE_ENV=production.'
    );
  }

  return {
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    url: publicUrl,
    app: {
      keys: env.array('APP_KEYS'),
    },
  };
};

export default config;
