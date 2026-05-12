import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const nodeEnv = env('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const cloudinaryName = env('CLOUDINARY_NAME');
  const cloudinaryKey = env('CLOUDINARY_KEY');
  const cloudinarySecret = env('CLOUDINARY_SECRET');

  if (isProduction) {
    const missing = [
      !cloudinaryName ? 'CLOUDINARY_NAME' : null,
      !cloudinaryKey ? 'CLOUDINARY_KEY' : null,
      !cloudinarySecret ? 'CLOUDINARY_SECRET' : null,
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `Production upload misconfiguration: missing required Cloudinary env vars: ${missing.join(', ')}.`
      );
    }
  }

  return {
    upload: {
      config: {
        provider: 'cloudinary',
        providerOptions: {
          cloud_name: cloudinaryName,
          api_key: cloudinaryKey,
          api_secret: cloudinarySecret,
        },
        actionOptions: {
          upload: {},
          delete: {},
        },
      },
    },
  };
};

export default config;
