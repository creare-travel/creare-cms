import { Core } from '@strapi/strapi';

export default ({ env }: { env: any }): Core.Config.Database => ({
  connection: {
    client: 'postgres',
    connection: {
      host: env('PGHOST'),
      port: env.int('PGPORT'),
      database: env('PGDATABASE'),
      user: env('PGUSER'),
      password: env('PGPASSWORD'),
      ssl: {
        rejectUnauthorized: false,
      },
    },
  },
});
