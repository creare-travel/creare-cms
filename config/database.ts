import { Core } from '@strapi/strapi';

export default ({ env }: { env: any }): Core.Config.Database => ({
  connection: {
    client: 'postgres',
    connection: {
      host: env('DATABASE_HOST', 'postgres.railway.internal'),
      port: env.int('DATABASE_PORT', 5432),
      database: env('DATABASE_NAME', 'railway'),
      user: env('DATABASE_USERNAME', 'postgres'),
      password: env('DATABASE_PASSWORD'),
      ssl: {
        rejectUnauthorized: false,
      },
    },
    debug: false,
  },
});
