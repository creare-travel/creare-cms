import { factories } from "@strapi/strapi";

export default factories.createCoreRouter(
  "api::cultural-world-page.cultural-world-page",
  {
    config: {
      find: { auth: false },
    },
  },
);
