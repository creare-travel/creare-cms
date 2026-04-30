'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { buildSuggestions } = require('./lib/experience-entity-enrichment');

const usage = () => {
  console.log('Usage: node scripts/apply-experience-entity-enrichment.js --dry-run');
  console.log('   or: node scripts/apply-experience-entity-enrichment.js --apply');
};

const MACHINE_FIELDS = [
  'geo_experience_type',
  'mood',
  'audience_segment',
  'intensity',
];

const main = async () => {
  const isDryRun = process.argv.includes('--dry-run');
  const isApply = process.argv.includes('--apply');

  if ((isDryRun && isApply) || (!isDryRun && !isApply)) {
    usage();
    process.exit(1);
  }

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const service = strapi.documents('api::experience.experience');
    const experiences = await service.findMany({
      locale: 'en',
      status: 'draft',
      populate: ['destination'],
      sort: ['title:asc'],
    });

    const suggestions = buildSuggestions(experiences);
    const exactTitleMap = new Map(suggestions.map((entry) => [entry.title, entry]));
    const reviewed = [];
    const skipped = [];
    let changedCount = 0;

    for (const experience of suggestions) {
      const match = exactTitleMap.get(experience.title);

      if (!match) {
        skipped.push({
          title: experience.title,
          reason: 'no exact suggestion match',
        });
        continue;
      }

      const before = {
        geo_experience_type: match.currentGeoExperienceType,
        mood: match.currentMood,
        audience_segment: match.currentAudienceSegment,
        intensity: match.currentIntensity,
      };
      const after = {
        geo_experience_type: match.suggestedGeoExperienceType,
        mood: match.suggestedMood,
        audience_segment: match.suggestedAudienceSegment,
        intensity: match.suggestedIntensity,
      };

      const changedFields = MACHINE_FIELDS.filter((field) => before[field] !== after[field]);

      if (changedFields.length > 0) {
        changedCount += 1;
      }

      reviewed.push({
        title: match.title,
        slug: match.slug,
        changedFields,
        before,
        after,
      });

      if (isApply && changedFields.length > 0) {
        const data = {};

        for (const field of changedFields) {
          data[field] = after[field];
        }

        await service.update({
          documentId: experiences.find((entry) => entry.title === match.title)?.documentId,
          locale: 'en',
          data,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          matchedEntries: reviewed.length,
          skippedEntries: skipped.length,
          entriesWithChanges: changedCount,
          reviewed,
          skipped,
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
