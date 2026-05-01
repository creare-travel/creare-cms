'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';

const usage = () => {
  console.log('Usage: node scripts/apply-editorial-completion-fields.js --dry-run');
  console.log('   or: node scripts/apply-editorial-completion-fields.js --apply');
  console.log('   or: node scripts/apply-editorial-completion-fields.js');
};

const PATCHES = {
  'bodrum-beach-gamestm-rhythm-competition-celebration': {
    short_description:
      'A high-energy private beach experience in Bodrum where teams move between water competition, rhythmic social moments, and curated service.',
  },
  'beylerbeyi-1869tm-empire-interrupted': {
    meta_title: 'Beylerbeyi 1869 | Historical Palace Experience in Istanbul | CREARE',
    meta_description:
      'A historical decision experience inside Beylerbeyi Palace where guests move through layered perspectives, reconstructing a moment of imperial fragility through space, narrative, and interpretation.',
  },
  'cocktail-ateliertm-mix-move-connect': {
    meta_title: 'Cocktail Atelier | Private Mixology Experience in Bodrum | CREARE',
    meta_description:
      'A private mixology-led social atelier in Bodrum where guests create, present, and share signature cocktails within a choreographed garden setting shaped by rhythm, hosting, and interaction.',
  },
  'imperial-flavorstm-culinary-atelier': {
    meta_title: 'Imperial Flavors | Ottoman Culinary Atelier in Istanbul | CREARE',
    meta_description:
      'A small-group culinary atelier exploring Ottoman palace cuisine through guided preparation, plating, and visual composition in a refined Michelin-recognized setting.',
  },
  'masterchef-bodrumtm-culinary-competition': {
    meta_title: 'Masterchef Bodrum | Private Culinary Competition by CREARE',
    meta_description:
      'A private open-air culinary competition in Bodrum where teams create and present dishes under Michelin-level evaluation, combining collaboration, pressure, and celebratory energy.',
  },
};

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === '';

const main = async () => {
  const isApply = process.argv.includes('--apply');
  const isDryRun = process.argv.includes('--dry-run') || !isApply;

  if ((isApply && process.argv.includes('--dry-run')) || process.argv.length > 3) {
    usage();
    process.exit(1);
  }

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experienceService = strapi.documents(EXPERIENCE_UID);
    const targetSlugs = Object.keys(PATCHES);
    const experiences = await experienceService.findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
    });

    const bySlug = new Map(experiences.map((experience) => [experience.slug, experience]));
    const scanned = [];
    const fieldsToUpdate = [];
    const skippedBecausePopulated = [];
    const blockedItems = [];

    for (const slug of targetSlugs) {
      const experience = bySlug.get(slug);
      const patch = PATCHES[slug];

      if (!experience) {
        blockedItems.push({
          slug,
          reason: 'record not found in current database',
        });
        continue;
      }

      const plannedUpdates = {};
      const skippedFields = {};

      for (const [field, nextValue] of Object.entries(patch)) {
        const currentValue = experience[field] ?? null;

        if (isEmpty(currentValue)) {
          plannedUpdates[field] = nextValue;
          fieldsToUpdate.push({
            slug: experience.slug,
            title: experience.title,
            field,
            value: nextValue,
          });
        } else {
          skippedFields[field] = currentValue;
          skippedBecausePopulated.push({
            slug: experience.slug,
            title: experience.title,
            field,
            currentValue,
          });
        }
      }

      scanned.push({
        slug: experience.slug,
        title: experience.title,
        plannedUpdates,
        skippedFields,
      });

      if (isApply && Object.keys(plannedUpdates).length > 0) {
        await experienceService.update({
          documentId: experience.documentId,
          locale: experience.locale || 'en',
          status: experience.publishedAt ? 'published' : 'draft',
          data: plannedUpdates,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          summary: {
            recordsScanned: targetSlugs.length,
            matchedRecords: scanned.length,
            fieldsToUpdate: fieldsToUpdate.length,
            fieldsSkippedBecauseAlreadyPopulated: skippedBecausePopulated.length,
            blockedItems: blockedItems.length,
          },
          records: scanned,
          fieldsToUpdate,
          fieldsSkippedBecauseAlreadyPopulated: skippedBecausePopulated,
          blockedItems,
          confirmation:
            'This script only updates the approved editorial text fields when empty and does not publish records, modify media, ontology fields, relations, wow_moment, or differentiator.',
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
