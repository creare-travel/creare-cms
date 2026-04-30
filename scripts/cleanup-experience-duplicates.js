'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const usage = () => {
  console.log('Usage: node scripts/cleanup-experience-duplicates.js --dry-run');
  console.log('   or: node scripts/cleanup-experience-duplicates.js --apply');
};

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
};

const stripTrademarkArtifacts = (value) => {
  return normalizeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®]/g, ' ')
    .replace(/([a-z0-9])tm\b/gi, '$1')
    .replace(/\btm\b/gi, ' ');
};

const normalizeTitleForComparison = (value) => {
  return stripTrademarkArtifacts(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const cleanSeoSlug = (value) => {
  return stripTrademarkArtifacts(value)
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
};

const collectText = (value) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    return Object.values(value).map(collectText).filter(Boolean).join(' ');
  }

  return '';
};

const textLength = (value) => normalizeString(collectText(value)).length;

const hasContent = (value) => normalizeString(collectText(value)).length > 0;

const isPlaceholderContent = (value) => normalizeString(collectText(value)).toLowerCase().includes('lorem ipsum');

const buildRichnessScore = (experience) => {
  let score = 0;

  if (hasContent(experience.one_line_hook)) {
    score += 25;
  }

  if (hasContent(experience.designed_for)) {
    score += 35;
  }

  if (hasContent(experience.experience_flow)) {
    score += 35;
  }

  if (hasContent(experience.short_description)) {
    score += 10;
  }

  if (hasContent(experience.program)) {
    score += 10;
  }

  if (hasContent(experience.venue_details)) {
    score += 10;
  }

  const descriptionSize = textLength(experience.description);
  score += Math.min(descriptionSize, 3000) / 20;

  if (isPlaceholderContent(experience.description) || isPlaceholderContent(experience.short_description)) {
    score -= 100;
  }

  return Number(score.toFixed(2));
};

const sortCandidates = (left, right) => {
  if (right.richnessScore !== left.richnessScore) {
    return right.richnessScore - left.richnessScore;
  }

  const rightDescriptionLength = textLength(right.description);
  const leftDescriptionLength = textLength(left.description);

  if (rightDescriptionLength !== leftDescriptionLength) {
    return rightDescriptionLength - leftDescriptionLength;
  }

  const rightUpdated = new Date(right.updatedAt || right.createdAt || 0).getTime();
  const leftUpdated = new Date(left.updatedAt || left.createdAt || 0).getTime();

  return rightUpdated - leftUpdated;
};

const planDuplicateCleanup = (experiences) => {
  const groups = new Map();

  for (const experience of experiences) {
    const key = normalizeTitleForComparison(experience.title);

    if (!key) {
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push({
      ...experience,
      normalizedTitle: key,
      cleanedSlug: cleanSeoSlug(experience.title),
      richnessScore: buildRichnessScore(experience),
      descriptionLength: textLength(experience.description),
    });
  }

  const duplicatePlans = [];

  for (const candidates of groups.values()) {
    if (candidates.length < 2) {
      continue;
    }

    const ordered = [...candidates].sort(sortCandidates);
    const keep = ordered[0];
    const remove = ordered.slice(1);
    const slugChange =
      keep.cleanedSlug && keep.cleanedSlug !== keep.slug
        ? {
            documentId: keep.documentId,
            title: keep.title,
            from: keep.slug,
            to: keep.cleanedSlug,
          }
        : null;

    duplicatePlans.push({
      normalizedTitle: keep.normalizedTitle,
      keep,
      remove,
      slugChange,
    });
  }

  return duplicatePlans.sort((left, right) =>
    left.normalizedTitle.localeCompare(right.normalizedTitle)
  );
};

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

    const experienceService = strapi.documents('api::experience.experience');
    const publishedExperiences = await experienceService.findMany({
      locale: 'en',
      status: 'published',
    });
    const publishedDocumentIds = new Set(
      publishedExperiences.map((experience) => experience.documentId)
    );

    const experiences = await experienceService.findMany({
      locale: 'en',
      status: 'draft',
      populate: ['destination'],
    });

    const duplicatePlans = planDuplicateCleanup(experiences);
    const summary = {
      mode: isDryRun ? 'dry-run' : 'apply',
      totalExperiences: experiences.length,
      duplicateGroupsFound: duplicatePlans.length,
      entriesToKeep: duplicatePlans.length,
      entriesToDelete: duplicatePlans.reduce((sum, plan) => sum + plan.remove.length, 0),
      slugChanges: duplicatePlans.filter((plan) => plan.slugChange).length,
    };

    console.log(JSON.stringify(summary, null, 2));

    for (const plan of duplicatePlans) {
      console.log(
        JSON.stringify(
          {
            normalizedTitle: plan.normalizedTitle,
            keep: {
              documentId: plan.keep.documentId,
              title: plan.keep.title,
              slug: plan.keep.slug,
              cleanedSlug: plan.keep.cleanedSlug,
              richnessScore: plan.keep.richnessScore,
            },
            delete: plan.remove.map((entry) => ({
              documentId: entry.documentId,
              title: entry.title,
              slug: entry.slug,
              richnessScore: entry.richnessScore,
            })),
            slugChange: plan.slugChange,
          },
          null,
          2
        )
      );
    }

    if (isDryRun) {
      return;
    }

    for (const plan of duplicatePlans) {
      if (plan.slugChange) {
        await experienceService.update({
          documentId: plan.keep.documentId,
          locale: plan.keep.locale || 'en',
          data: {
            slug: plan.slugChange.to,
          },
        });

        if (publishedDocumentIds.has(plan.keep.documentId)) {
          await experienceService.publish({
            documentId: plan.keep.documentId,
            locale: plan.keep.locale || 'en',
          });
        }
      }

      for (const entry of plan.remove) {
        await experienceService.delete({
          documentId: entry.documentId,
        });
      }
    }
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
