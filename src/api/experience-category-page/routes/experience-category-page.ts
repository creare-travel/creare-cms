import { factories } from "@strapi/strapi";

export default factories.createCoreRouter(
  "api::experience-category-page.experience-category-page",
  {
    config: {
      find: { auth: false },
      findOne: { auth: false },
    },
  },
);
