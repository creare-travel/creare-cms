import { Core } from '@strapi/strapi';

export default ({ env }: { env: any }): Core.Config.Database => ({
  connection: {
    client: 'postgres',
    connection: {
      connectionString: env('DATABASE_URL'),
      ssl: {
        rejectUnauthorized: false,
      },
    },
  },
});
