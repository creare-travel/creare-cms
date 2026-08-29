import { factories } from "@strapi/strapi";

export default factories.createCoreRouter(
  "api::experience-landing.experience-landing",
  {
    config: {
      find: { auth: false },
    },
  },
);
