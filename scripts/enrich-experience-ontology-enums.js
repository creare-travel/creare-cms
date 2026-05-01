'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const usage = () => {
  console.log('Usage: node scripts/enrich-experience-ontology-enums.js --dry-run');
  console.log('   or: node scripts/enrich-experience-ontology-enums.js --apply');
};

const ENRICHMENT_MAP = {
  'floating-salon-d-opera': {
    mood: 'performance',
    audience_segment: 'private_group',
    geo_experience_type: 'signature',
    intensity: 'low',
  },
  'cocktail-atelier-mix-move-connect': {
    mood: 'celebration',
    audience_segment: 'corporate',
    geo_experience_type: 'signature',
    intensity: 'medium',
  },
  'masterchef-bodrum-culinary-competition': {
    mood: 'celebration',
    audience_segment: 'corporate',
    geo_experience_type: 'signature',
    intensity: 'high',
  },
  'golden-horn-regatta': {
    audience_segment: 'executive',
  },
  'open-studio-istanbul': {
    intensity: 'low',
  },
  'imperial-flavors-culinary-atelier': {
    mood: 'gastronomy',
    audience_segment: 'private_group',
    geo_experience_type: 'signature',
    intensity: 'medium',
  },
  'istanbul-through-the-lens': {
    mood: 'exploration',
    audience_segment: 'private_group',
    geo_experience_type: 'signature',
    intensity: 'medium',
  },
  'silk-road-istanbul': {
    mood: 'exploration',
    audience_segment: 'private_group',
    geo_experience_type: 'signature',
    intensity: 'high',
  },
  'table-to-farm-bodrum': {
    mood: 'gastronomy',
    audience_segment: 'private_group',
    geo_experience_type: 'signature',
    intensity: 'low',
  },
  'the-salon-of-hands': {
    mood: 'performance',
    audience_segment: 'corporate',
    geo_experience_type: 'signature',
    intensity: 'medium',
  },
};

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === '';

const main = async () => {
  const isDryRun = process.argv.includes('--dry-run');
  const isApply = process.argv.includes('--apply');

  if ((isDryRun && isApply) || (!isDryRun && !isApply) || process.argv.length > 3) {
    usage();
    process.exit(1);
  }

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experienceService = strapi.documents('api::experience.experience');
    const targetSlugs = Object.keys(ENRICHMENT_MAP);
    const experiences = await experienceService.findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
    });

    const experienceBySlug = new Map(experiences.map((experience) => [experience.slug, experience]));
    const notFound = [];
    const reviewed = [];
    const updated = [];
    const skipped = [];

    for (const slug of targetSlugs) {
      const experience = experienceBySlug.get(slug);
      const desired = ENRICHMENT_MAP[slug];

      if (!experience) {
        notFound.push(slug);
        continue;
      }

      const updates = {};
      const skippedFields = {};

      for (const [field, nextValue] of Object.entries(desired)) {
        const currentValue = experience[field] ?? null;

        if (isEmpty(currentValue)) {
          updates[field] = nextValue;
        } else {
          skippedFields[field] = currentValue;
        }
      }

      const changedFields = Object.keys(updates);

      const record = {
        title: experience.title,
        slug: experience.slug,
        currentValues: {
          mood: experience.mood ?? null,
          audience_segment: experience.audience_segment ?? null,
          geo_experience_type: experience.geo_experience_type ?? null,
          intensity: experience.intensity ?? null,
        },
        updates,
        skippedFields,
      };

      reviewed.push(record);

      if (changedFields.length === 0) {
        skipped.push({
          slug: experience.slug,
          title: experience.title,
          reason: 'all targeted fields already populated',
          skippedFields,
        });
        continue;
      }

      if (!isDryRun) {
        await experienceService.update({
          documentId: experience.documentId,
          data: updates,
        });
      }

      updated.push({
        slug: experience.slug,
        title: experience.title,
        updatedFields: updates,
        skippedFields,
      });
    }

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          summary: {
            targets: targetSlugs.length,
            found: reviewed.length,
            notFound: notFound.length,
            updated: updated.length,
            skipped: skipped.length,
          },
          reviewed,
          updated,
          skipped,
          notFound,
          confirmation:
            'This script only fills currently empty enum ontology fields on matched Experience records and does not modify titles, slugs, publish state, relations, or existing non-empty enum values.',
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
