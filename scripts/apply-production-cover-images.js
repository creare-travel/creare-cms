'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';
const MEDIA_UID = 'plugin::upload.file';

const usage = () => {
  console.log('Usage: node scripts/apply-production-cover-images.js --dry-run');
  console.log('   or: node scripts/apply-production-cover-images.js --apply');
  console.log('   or: node scripts/apply-production-cover-images.js');
};

const MAPPINGS = [
  {
    slug: 'princes-islands-regatta',
    assetId: 6,
    alternativeText: 'Privately chartered sailing yachts moving in formation between the Princes Islands off Istanbul.',
    caption: 'A regatta environment shaped through precision, fleet rhythm, and private maritime control.',
  },
  {
    slug: 'imperial-flavors-culinary-atelier',
    assetId: 10,
    alternativeText: 'Refined culinary composition reflecting Ottoman-inspired gastronomy in an intimate atelier setting in Istanbul.',
    caption: 'Ottoman culinary craft translated into a composed, small-group gastronomic atelier.',
  },
  {
    slug: 'driven-by-performance',
    assetId: 4,
    alternativeText: 'Performance driving setting with high-speed circuit energy and precision automotive focus.',
    caption: 'A private motorsport environment designed around control, pace, and competitive precision.',
  },
  {
    slug: 'beylerbeyi-1869-empire-interrupted',
    assetId: 17,
    alternativeText: 'Historical visual reference connected to imperial memory and the narrative world of Beylerbeyi 1869 in Istanbul.',
    caption: 'An editorial image that supports the tension, memory, and historical atmosphere of Beylerbeyi 1869.',
  },
  {
    slug: 'bodrum-beach-games-rhythm-competition-celebration',
    assetId: 19,
    alternativeText: 'Private shoreline setting in Bodrum combining open-air energy, movement, and social rhythm.',
    caption: 'A private beach atmosphere where competition, rhythm, and curated social energy unfold together.',
  },
  {
    slug: 'cocktail-atelier-mix-move-connect',
    assetId: 20,
    alternativeText: 'A refined garden and dining atmosphere suited to a private cocktail atelier experience in Bodrum.',
    caption: 'A private mixology setting shaped by garden atmosphere, social rhythm, and culinary precision.',
  },
  {
    slug: 'golden-horn-regatta',
    assetId: 21,
    alternativeText: 'Historic waterfront atmosphere evoking the Golden Horn as a controlled regatta environment in Istanbul.',
    caption: 'A regatta framed by urban history, coordinated movement, and a disciplined waterfront setting.',
  },
  {
    slug: 'masterchef-bodrum-culinary-competition',
    assetId: 22,
    alternativeText: 'Open-air culinary atmosphere suited to a private team cooking competition in Bodrum.',
    caption: 'A private culinary competition environment where pressure, presentation, and shared energy meet.',
  },
  {
    slug: 'the-salon-of-hands',
    assetId: 25,
    alternativeText: 'Quiet studio image supporting a ceramic and sound-based hands-on experience centered on clay and form.',
    caption: 'A quiet studio mood oriented around clay, form, and material sensitivity.',
  },
];

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
    const experiences = await experienceService.findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
      populate: ['cover_image'],
    });
    const mediaAssets = await strapi.db.query(MEDIA_UID).findMany({
      select: ['id', 'name', 'alternativeText', 'caption', 'url'],
    });

    const experienceBySlug = new Map(experiences.map((experience) => [experience.slug, experience]));
    const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));

    const recordsScanned = MAPPINGS.length;
    const matchedRecords = [];
    const missingSlugs = [];
    const missingAssetIds = [];
    const coverImagesToAttach = [];
    const recordsSkippedBecauseCoverAlreadyExists = [];
    const mediaMetadataFieldsToUpdate = [];
    const blockedItems = [];

    for (const mapping of MAPPINGS) {
      const experience = experienceBySlug.get(mapping.slug) || null;
      const asset = mediaById.get(mapping.assetId) || null;

      if (!experience) {
        missingSlugs.push(mapping.slug);
      }

      if (!asset) {
        missingAssetIds.push(mapping.assetId);
      }

      if (!experience || !asset) {
        blockedItems.push({
          slug: mapping.slug,
          assetId: mapping.assetId,
          reason: !experience && !asset ? 'experience and asset missing' : !experience ? 'experience missing' : 'asset missing',
        });
        continue;
      }

      const recordPlan = {
        slug: experience.slug,
        title: experience.title,
        assetId: asset.id,
        assetName: asset.name || null,
        coverAlreadyExists: Boolean(experience.cover_image),
        plannedCoverAttachment: null,
        plannedMediaMetadataUpdates: {},
        skippedMediaMetadataFields: {},
      };

      if (experience.cover_image) {
        recordsSkippedBecauseCoverAlreadyExists.push({
          slug: experience.slug,
          title: experience.title,
          currentCoverId: experience.cover_image.id || null,
        });
      } else {
        recordPlan.plannedCoverAttachment = {
          field: 'cover_image',
          assetId: asset.id,
        };
        coverImagesToAttach.push({
          slug: experience.slug,
          title: experience.title,
          assetId: asset.id,
          assetName: asset.name || null,
        });
      }

      for (const field of ['alternativeText', 'caption']) {
        const nextValue = mapping[field];
        const currentValue = asset[field] ?? null;

        if (isEmpty(currentValue)) {
          recordPlan.plannedMediaMetadataUpdates[field] = nextValue;
          mediaMetadataFieldsToUpdate.push({
            assetId: asset.id,
            assetName: asset.name || null,
            slug: experience.slug,
            field,
            value: nextValue,
          });
        } else {
          recordPlan.skippedMediaMetadataFields[field] = currentValue;
        }
      }

      matchedRecords.push(recordPlan);

      if (isApply) {
        if (!experience.cover_image) {
          await experienceService.update({
            documentId: experience.documentId,
            locale: experience.locale || 'en',
            status: experience.publishedAt ? 'published' : 'draft',
            data: {
              cover_image: asset.id,
            },
          });
        }

        const mediaUpdates = {};
        if (isEmpty(asset.alternativeText)) {
          mediaUpdates.alternativeText = mapping.alternativeText;
        }
        if (isEmpty(asset.caption)) {
          mediaUpdates.caption = mapping.caption;
        }

        if (Object.keys(mediaUpdates).length > 0) {
          await strapi.db.query(MEDIA_UID).update({
            where: { id: asset.id },
            data: mediaUpdates,
          });
        }
      }
    }

    const report = {
      title: 'CREARE PRODUCTION COVER IMAGE DRY-RUN REPORT',
      mode: isDryRun ? 'dry-run' : 'apply',
      summary: {
        recordsScanned,
        matchedRecords: matchedRecords.length,
        missingSlugs: missingSlugs.length,
        missingAssetIds: missingAssetIds.length,
        coverImagesToAttach: coverImagesToAttach.length,
        recordsSkippedBecauseCoverAlreadyExists: recordsSkippedBecauseCoverAlreadyExists.length,
        mediaMetadataFieldsToUpdate: mediaMetadataFieldsToUpdate.length,
        blockedItems: blockedItems.length,
      },
      matchedRecords,
      missingSlugs,
      missingAssetIds,
      coverImagesToAttach,
      recordsSkippedBecauseCoverAlreadyExists,
      mediaMetadataFieldsToUpdate,
      blockedItems,
      confirmation: {
        noPublishActionWillHappen: true,
        slugsWillNotBeChanged: true,
        publishedAtWillNotBeChanged: true,
      },
    };

    console.log(JSON.stringify(report, null, 2));

    if (isDryRun) {
      console.log('\nSTATUS: PRODUCTION COVER IMAGE DRY-RUN READY');
      return;
    }

    if (missingSlugs.length || missingAssetIds.length) {
      console.error('Apply aborted because one or more mapped production slugs or asset ids are missing.');
      process.exit(1);
    }
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
