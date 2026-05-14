'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';
const MEDIA_UID = 'plugin::upload.file';

const TARGETS = [
  {
    slug: 'table-to-farm-bodrum',
    filename: 'creare_bodrum_editorial_dining_hero.jpg',
  },
  {
    slug: 'floating-salon-d-opera',
    filename: 'Floating Opera_Istanbul.png',
  },
];

const usage = () => {
  console.log('Usage: node scripts/sync-whitelist-cover-images.js --dry-run');
  console.log('   or: node scripts/sync-whitelist-cover-images.js --apply');
  console.log('   or: node scripts/sync-whitelist-cover-images.js');
};

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === '';

function normalizeMedia(asset) {
  if (!asset) return null;

  return {
    id: asset.id,
    name: asset.name || null,
    provider: asset.provider || null,
    url: asset.url || null,
    alternativeText: asset.alternativeText ?? null,
    caption: asset.caption ?? null,
    publicId: asset.provider_metadata?.public_id || null,
  };
}

async function main() {
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
    const [draftExperiences, publishedExperiences, mediaAssets] = await Promise.all([
      experienceService.findMany({
        locale: 'en',
        status: 'draft',
        filters: { slug: { $in: TARGETS.map((target) => target.slug) } },
        populate: ['cover_image'],
      }),
      experienceService.findMany({
        locale: 'en',
        status: 'published',
        filters: { slug: { $in: TARGETS.map((target) => target.slug) } },
        populate: ['cover_image'],
      }),
      strapi.db.query(MEDIA_UID).findMany({
        select: ['id', 'name', 'url', 'provider', 'alternativeText', 'caption', 'provider_metadata'],
      }),
    ]);

    const draftBySlug = new Map(draftExperiences.map((record) => [record.slug, record]));
    const publishedBySlug = new Map(publishedExperiences.map((record) => [record.slug, record]));
    const mediaByFilename = new Map(mediaAssets.map((asset) => [asset.name, asset]));

    const records = [];
    const blockedItems = [];

    for (const target of TARGETS) {
      const draft = draftBySlug.get(target.slug) || null;
      const published = publishedBySlug.get(target.slug) || null;
      const asset = mediaByFilename.get(target.filename) || null;

      const draftCover = normalizeMedia(draft?.cover_image);
      const publishedCover = normalizeMedia(published?.cover_image);
      const matchedAsset = normalizeMedia(asset);

      const recordReport = {
        targetSlug: target.slug,
        targetFilename: target.filename,
        draft: draft
          ? {
              title: draft.title,
              slug: draft.slug,
              documentId: draft.documentId,
              visibility_status: draft.visibility_status ?? null,
              publishedAt: draft.publishedAt ?? null,
              cover_image: draftCover,
            }
          : null,
        published: published
          ? {
              title: published.title,
              slug: published.slug,
              documentId: published.documentId,
              visibility_status: published.visibility_status ?? null,
              publishedAt: published.publishedAt ?? null,
              cover_image: publishedCover,
            }
          : null,
        matchedMediaAsset: matchedAsset,
        verification: {
          assetFound: Boolean(asset),
          alternativeTextExists: Boolean(asset && !isEmpty(asset.alternativeText)),
          captionExists: Boolean(asset && !isEmpty(asset.caption)),
          draftAndPublishedAligned:
            Boolean(draft && published) &&
            (draftCover?.id || null) === (publishedCover?.id || null) &&
            (draftCover?.alternativeText || null) === (publishedCover?.alternativeText || null) &&
            (draftCover?.caption || null) === (publishedCover?.caption || null),
        },
        plannedActions: {
          attachDraftCoverImage:
            Boolean(draft && asset && !draft.cover_image) ? { assetId: asset.id } : null,
          attachPublishedCoverImage:
            Boolean(published && asset && !published.cover_image) ? { assetId: asset.id } : null,
          updateMediaAlternativeText:
            Boolean(asset && isEmpty(asset.alternativeText)) ? 'blocked-until-manual-copy-confirmed' : null,
          updateMediaCaption:
            Boolean(asset && isEmpty(asset.caption)) ? 'blocked-until-manual-copy-confirmed' : null,
        },
      };

      if (!draft && !published) {
        blockedItems.push({
          slug: target.slug,
          filename: target.filename,
          reason: 'target experience not found in draft or published state',
        });
      }

      if (!asset) {
        blockedItems.push({
          slug: target.slug,
          filename: target.filename,
          reason: 'matching media filename not found in Strapi media library',
        });
      }

      records.push(recordReport);

      if (!isApply) {
        continue;
      }

      if (!asset) {
        continue;
      }

      if (draft && !draft.cover_image) {
        await experienceService.update({
          documentId: draft.documentId,
          locale: draft.locale || 'en',
          status: 'draft',
          data: {
            cover_image: asset.id,
          },
        });
      }

      if (published && !published.cover_image) {
        await experienceService.update({
          documentId: published.documentId,
          locale: published.locale || 'en',
          status: 'published',
          data: {
            cover_image: asset.id,
          },
        });
      }
    }

    const report = {
      title: 'CREARE MEDIA RELATION SYNC DRY-RUN REPORT',
      mode: isDryRun ? 'dry-run' : 'apply',
      summary: {
        targetsScanned: TARGETS.length,
        targetRecordsFound: records.filter((record) => record.draft || record.published).length,
        mediaMatchesFound: records.filter((record) => record.matchedMediaAsset).length,
        blockedItems: blockedItems.length,
      },
      records,
      blockedItems,
      confirmation: {
        noNonEmptyFieldsWillBeOverwritten: true,
        noMediaWillBeDeleted: true,
        noUnrelatedRecordsWillBePublished: true,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await strapi.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
