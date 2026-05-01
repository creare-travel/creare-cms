'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';

const APPROVED_SLUGS = [
  'beylerbeyi-1869tm-empire-interrupted',
  'bodrum-beach-gamestm-rhythm-competition-celebration',
  'cocktail-ateliertm-mix-move-connect',
  'driven-by-performancetm',
  'golden-horn-regattatm',
  'imperial-flavorstm-culinary-atelier',
  'masterchef-bodrumtm-culinary-competition',
  'princes-islands-regattatm',
  'the-salon-of-handstm',
];

const isEmpty = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const extractBlocksText = (value) => {
  if (!Array.isArray(value)) return '';

  return value
    .flatMap((block) => (Array.isArray(block?.children) ? block.children : []))
    .map((child) => (typeof child?.text === 'string' ? child.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const fieldStatus = (experience) => {
  const seoTitle = experience.meta_title || experience.seo_title || null;
  const seoDescription = experience.meta_description || experience.seo_description || null;
  const descriptionText = extractBlocksText(experience.description);

  const checks = {
    title: !isEmpty(experience.title),
    slug: !isEmpty(experience.slug),
    short_description: !isEmpty(experience.short_description),
    description: !isEmpty(descriptionText),
    wow_moment: !isEmpty(experience.wow_moment),
    differentiator: !isEmpty(experience.differentiator),
    cover_image: Boolean(experience.cover_image),
    meta_title: !isEmpty(seoTitle),
    meta_description: !isEmpty(seoDescription),
    mood: !isEmpty(experience.mood),
    intensity: !isEmpty(experience.intensity),
    audience_segment: !isEmpty(experience.audience_segment),
    geo_experience_type: !isEmpty(experience.geo_experience_type),
    mood_entity: Boolean(experience.mood_entity),
    intensity_entity: Boolean(experience.intensity_entity),
    audience_entity: Boolean(experience.audience_entity),
    experience_type_entity: Boolean(experience.experience_type_entity),
    publishedAt: Boolean(experience.publishedAt),
  };

  return { checks, seoTitle, seoDescription, descriptionText };
};

const computeMveScore = (checks) => {
  const weights = {
    title: 10,
    slug: 10,
    short_description: 8,
    description: 12,
    wow_moment: 8,
    differentiator: 8,
    cover_image: 10,
    meta_title: 5,
    meta_description: 5,
    mood: 4,
    intensity: 4,
    audience_segment: 4,
    geo_experience_type: 4,
    mood_entity: 2,
    intensity_entity: 2,
    audience_entity: 2,
    experience_type_entity: 2,
    publishedAt: 4,
  };

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const earned = Object.entries(weights).reduce(
    (sum, [field, weight]) => sum + (checks[field] ? weight : 0),
    0
  );

  return Math.round((earned / total) * 100);
};

const getMissingFields = (checks) =>
  Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([field]) => field);

const recommendAction = (checks) => {
  if (!checks.cover_image) return 'ADD COVER IMAGE FIRST';
  if (!checks.wow_moment || !checks.differentiator) return 'COMPLETE SIGNATURE POSITIONING';
  if (!checks.meta_title || !checks.meta_description) return 'COMPLETE SEO FIELDS';
  if (!checks.mood_entity || !checks.intensity_entity || !checks.audience_entity || !checks.experience_type_entity) {
    return 'BACKFILL ONTOLOGY RELATIONS';
  }
  if (!checks.publishedAt) return 'READY TO PUBLISH AFTER FINAL REVIEW';
  return 'READY';
};

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experiences = await strapi.documents(EXPERIENCE_UID).findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
      populate: [
        'cover_image',
        'mood_entity',
        'intensity_entity',
        'audience_entity',
        'experience_type_entity',
      ],
    });

    const bySlug = new Map(experiences.map((experience) => [experience.slug, experience]));
    const found = [];
    const missingRecords = [];

    for (const slug of APPROVED_SLUGS) {
      const experience = bySlug.get(slug);

      if (!experience) {
        missingRecords.push(slug);
        continue;
      }

      const { checks } = fieldStatus(experience);
      const missingFields = getMissingFields(checks);
      const mveScore = computeMveScore(checks);
      const jsonLdReady =
        checks.title &&
        checks.slug &&
        checks.short_description &&
        checks.description &&
        checks.wow_moment &&
        checks.differentiator &&
        checks.meta_title &&
        checks.meta_description &&
        checks.mood &&
        checks.audience_segment &&
        checks.geo_experience_type;
      const publishReady =
        jsonLdReady &&
        checks.cover_image &&
        checks.intensity &&
        checks.mood_entity &&
        checks.intensity_entity &&
        checks.audience_entity &&
        checks.experience_type_entity;

      found.push({
        slug: experience.slug,
        title: experience.title,
        currentStatus: experience.publishedAt ? 'published' : 'draft',
        missingFields,
        mveScore,
        jsonLdReady: jsonLdReady ? 'YES' : 'NO',
        publishReady: publishReady ? 'YES' : 'NO',
        recommendedNextAction: recommendAction(checks),
      });
    }

    const readyToPublishCount = found.filter((item) => item.publishReady === 'YES').length;
    const blockedCount = found.length - readyToPublishCount;
    const missingCoverImageCount = found.filter((item) => item.missingFields.includes('cover_image')).length;
    const missingWowMomentCount = found.filter((item) => item.missingFields.includes('wow_moment')).length;
    const missingDifferentiatorCount = found.filter((item) => item.missingFields.includes('differentiator')).length;
    const missingSeoCount = found.filter(
      (item) => item.missingFields.includes('meta_title') || item.missingFields.includes('meta_description')
    ).length;
    const missingOntologyRelationCount = found.filter(
      (item) =>
        item.missingFields.includes('mood_entity') ||
        item.missingFields.includes('intensity_entity') ||
        item.missingFields.includes('audience_entity') ||
        item.missingFields.includes('experience_type_entity')
    ).length;

    const priorityOrder = [...found].sort((a, b) => {
      if (a.publishReady !== b.publishReady) return a.publishReady === 'YES' ? -1 : 1;
      if (a.mveScore !== b.mveScore) return b.mveScore - a.mveScore;
      return a.missingFields.length - b.missingFields.length;
    });

    console.log('CREARE MVE COMPLETION PLAN\n');

    for (const item of found) {
      console.log(`- slug: ${item.slug}`);
      console.log(`  title: ${item.title}`);
      console.log(`  current status: ${item.currentStatus}`);
      console.log(`  missing fields: ${item.missingFields.length ? item.missingFields.join(', ') : 'none'}`);
      console.log(`  MVE score: ${item.mveScore}`);
      console.log(`  JSON-LD readiness: ${item.jsonLdReady}`);
      console.log(`  publish readiness: ${item.publishReady}`);
      console.log(`  recommended next action: ${item.recommendedNextAction}`);
    }

    if (missingRecords.length) {
      console.log('\n- missing approved records from current database:');
      for (const slug of missingRecords) {
        console.log(`  - ${slug}`);
      }
    }

    console.log('\nGLOBAL REPORT:');
    console.log(`- total approved records scanned: ${APPROVED_SLUGS.length}`);
    console.log(`- ready to publish count: ${readyToPublishCount}`);
    console.log(`- blocked count: ${blockedCount}`);
    console.log(`- missing cover image count: ${missingCoverImageCount}`);
    console.log(`- missing wow_moment count: ${missingWowMomentCount}`);
    console.log(`- missing differentiator count: ${missingDifferentiatorCount}`);
    console.log(`- missing SEO count: ${missingSeoCount}`);
    console.log(`- missing ontology relation count: ${missingOntologyRelationCount}`);
    console.log(
      `- priority order for completion: ${priorityOrder.map((item) => item.slug).join(', ')}`
    );

    console.log('\nSTATUS: MVE COMPLETION AUDIT COMPLETE');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
