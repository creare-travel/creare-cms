'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { buildSuggestions } = require('./lib/experience-entity-enrichment');

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experiences = await strapi.documents('api::experience.experience').findMany({
      locale: 'en',
      status: 'draft',
      populate: ['destination'],
      sort: ['title:asc'],
    });

    console.log(
      JSON.stringify(
        {
          reviewed: buildSuggestions(experiences).length,
          suggestions: buildSuggestions(experiences),
          notes: [
            'destination already exists as a relation',
            'experience_type already exists and remains unchanged for editorial/domain use',
            'audience already exists as blocks content and remains unchanged for editorial use',
            'geo_experience_type and audience_segment are the new machine-readable GEO/AI fields',
            'mood and intensity remain part of the machine-readable enrichment layer',
          ],
        },
        null,
        2
      )
    );
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
