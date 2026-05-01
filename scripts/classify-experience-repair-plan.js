'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';

const extractBlocksText = (value) => {
  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .flatMap((block) => (Array.isArray(block?.children) ? block.children : []))
    .map((child) => (typeof child?.text === 'string' ? child.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const isEmpty = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeSlugComparable = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/tm(?=-|$)/g, '')
    .replace(/[^a-z0-9]+/g, '');

const tokenize = (value) => {
  const text = normalizeText(value);
  return text ? new Set(text.split(' ')) : new Set();
};

const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
};

const similarityScore = (left, right) => {
  const titleScore = jaccard(tokenize(left.title), tokenize(right.title));
  const descriptionScore = jaccard(tokenize(left.descriptionText), tokenize(right.descriptionText));
  const shortDescriptionScore = jaccard(
    tokenize(left.short_description),
    tokenize(right.short_description)
  );

  return {
    titleScore,
    descriptionScore,
    shortDescriptionScore,
    strongest: Math.max(titleScore, descriptionScore, shortDescriptionScore),
  };
};

const missingFieldList = (experience) => {
  const missing = [];
  if (isEmpty(experience.title)) missing.push('title');
  if (isEmpty(experience.slug)) missing.push('slug');
  if (isEmpty(experience.short_description)) missing.push('short_description');
  if (isEmpty(experience.descriptionText)) missing.push('description');
  if (!experience.cover_image) missing.push('cover_image');
  if (isEmpty(experience.wow_moment)) missing.push('wow_moment');
  if (isEmpty(experience.differentiator)) missing.push('differentiator');
  if (isEmpty(experience.seoTitle)) missing.push('meta_title');
  if (isEmpty(experience.seoDescription)) missing.push('meta_description');
  if (!experience.publishedAt) missing.push('publishedAt');
  if (isEmpty(experience.mood)) missing.push('mood');
  if (isEmpty(experience.intensity)) missing.push('intensity');
  if (isEmpty(experience.audience_segment)) missing.push('audience_segment');
  if (isEmpty(experience.geo_experience_type)) missing.push('geo_experience_type');
  if (experience.mood && !experience.mood_entity) missing.push('mood_entity');
  if (experience.intensity && !experience.intensity_entity) missing.push('intensity_entity');
  if (experience.audience_segment && !experience.audience_entity) missing.push('audience_entity');
  if (experience.geo_experience_type && !experience.experience_type_entity) missing.push('experience_type_entity');
  return missing;
};

const qualityScore = (experience, similarRecords) => {
  let score = 100;
  const penalties = {
    short_description: 8,
    description: 15,
    cover_image: 8,
    wow_moment: 12,
    differentiator: 12,
    meta_title: 4,
    meta_description: 4,
    publishedAt: 15,
    mood: 5,
    intensity: 5,
    audience_segment: 5,
    geo_experience_type: 5,
    mood_entity: 3,
    intensity_entity: 3,
    audience_entity: 3,
    experience_type_entity: 3,
  };

  for (const missing of missingFieldList(experience)) {
    score -= penalties[missing] || 2;
  }

  if (experience.slug.includes('tm')) score -= 4;
  if (similarRecords.some((item) => item.strongDuplicate)) score -= 15;
  if (similarRecords.some((item) => item.sameComparableSlug)) score -= 12;
  if (isEmpty(experience.wow_moment) && isEmpty(experience.differentiator)) score -= 10;

  return Math.max(0, Math.min(100, score));
};

const classifyExperience = (experience, similarRecords, missingFields) => {
  const hasCoreIdentity = !isEmpty(experience.title) && !isEmpty(experience.slug) && !isEmpty(experience.descriptionText);
  const hasSignaturePositioning = !isEmpty(experience.wow_moment) || !isEmpty(experience.differentiator);
  const strongDuplicates = similarRecords.filter((item) => item.strongDuplicate);
  const hasComparableSlugDuplicate = similarRecords.some((item) => item.sameComparableSlug);
  const onlySmallGaps = missingFields.length > 0 && missingFields.length <= 3;
  const meaningfulDescription = !isEmpty(experience.descriptionText) || !isEmpty(experience.short_description);
  const legacySignals = [
    experience.slug.includes('tm'),
    strongDuplicates.length > 0 && strongDuplicates.some((item) => item.titleScore >= 0.7),
    strongDuplicates.length > 0 && strongDuplicates.some((item) => item.descriptionScore >= 0.7),
    hasComparableSlugDuplicate,
    isEmpty(experience.wow_moment) && isEmpty(experience.differentiator),
    isEmpty(experience.short_description) || !meaningfulDescription,
  ].filter(Boolean).length;

  const reasons = [];

  if (experience.slug.includes('tm')) {
    reasons.push('slug contains tm artifact');
  }
  if (hasComparableSlugDuplicate) {
    reasons.push('same concept appears with a cleaner comparable slug');
  }
  if (strongDuplicates.length > 0) {
    reasons.push(
      `strong overlap with ${strongDuplicates.map((item) => item.slug).join(', ')}`
    );
  }
  if (isEmpty(experience.wow_moment) && isEmpty(experience.differentiator)) {
    reasons.push('missing both wow_moment and differentiator');
  }
  if (isEmpty(experience.short_description)) {
    reasons.push('missing short_description');
  }
  if (!meaningfulDescription) {
    reasons.push('missing meaningful description');
  }

  if ((!hasSignaturePositioning && isEmpty(experience.descriptionText)) || !hasCoreIdentity) {
    return {
      classification: 'INCOMPLETE / LOW VALUE',
      action: 'DELETE',
      confidence: 0.9,
      reasons,
    };
  }

  if (legacySignals >= 2 && (hasComparableSlugDuplicate || strongDuplicates.length > 0)) {
    return {
      classification: 'LEGACY / TM VARIANT',
      action: 'ARCHIVE',
      confidence: 0.9,
      reasons,
    };
  }

  if (strongDuplicates.length > 0) {
    return {
      classification: 'MERGE CANDIDATE',
      action: 'MERGE',
      confidence: 0.75,
      reasons,
    };
  }

  if (onlySmallGaps) {
    return {
      classification: 'READY FOR MVE COMPLETION',
      action: 'READY_TO_PUBLISH_AFTER_FIX',
      confidence: 0.85,
      reasons: reasons.length ? reasons : ['valid concept with only small completion gaps'],
    };
  }

  return {
    classification: 'CORE EXPERIENCE',
    action: 'KEEP_AND_COMPLETE',
    confidence: 0.8,
    reasons: reasons.length ? reasons : ['unique concept with clear identity'],
  };
};

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const rawExperiences = await strapi.documents(EXPERIENCE_UID).findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
      populate: [
        'mood_entity',
        'intensity_entity',
        'audience_entity',
        'experience_type_entity',
        'cover_image',
        'gallery',
      ],
    });

    const experiences = rawExperiences.map((experience) => ({
      ...experience,
      descriptionText: extractBlocksText(experience.description),
      seoTitle: experience.meta_title || experience.seo_title || '',
      seoDescription: experience.meta_description || experience.seo_description || '',
      comparableSlug: normalizeSlugComparable(experience.slug),
    }));

    const classifications = [];
    const buckets = {
      'CORE EXPERIENCE': 0,
      'LEGACY / TM VARIANT': 0,
      'MERGE CANDIDATE': 0,
      'INCOMPLETE / LOW VALUE': 0,
      'READY FOR MVE COMPLETION': 0,
    };

    for (const experience of experiences) {
      const similarRecords = experiences
        .filter((candidate) => candidate.documentId !== experience.documentId)
        .map((candidate) => ({
          title: candidate.title,
          slug: candidate.slug,
          ...similarityScore(experience, candidate),
          sameComparableSlug: candidate.comparableSlug === experience.comparableSlug,
        }))
        .map((item) => ({
          ...item,
          strongDuplicate:
            item.sameComparableSlug ||
            item.titleScore >= 0.85 ||
            item.descriptionScore >= 0.7 ||
            (item.titleScore >= 0.6 && item.shortDescriptionScore >= 0.6),
        }))
        .filter((item) => item.strongDuplicate || item.strongest >= 0.35)
        .sort((a, b) => b.strongest - a.strongest)
        .slice(0, 5);

      const missingFields = missingFieldList(experience);
      const score = qualityScore(experience, similarRecords);
      const { classification, action, confidence, reasons } = classifyExperience(
        experience,
        similarRecords,
        missingFields
      );

      buckets[classification] += 1;
      classifications.push({
        title: experience.title,
        slug: experience.slug,
        classification,
        similarRecords,
        missingFields,
        qualityScore: score,
        confidence,
        reasons,
        recommendedAction: action,
      });
    }

    const keep = classifications.filter((item) => item.recommendedAction === 'KEEP_AND_COMPLETE');
    const merge = classifications.filter((item) => item.recommendedAction === 'MERGE');
    const deleteList = classifications.filter((item) => item.recommendedAction === 'DELETE');
    const completeFirst = classifications.filter((item) => item.recommendedAction === 'READY_TO_PUBLISH_AFTER_FIX');
    const falsePositives = classifications.filter(
      (item) =>
        item.classification === 'LEGACY / TM VARIANT' &&
        item.reasons.length === 1 &&
        item.reasons[0] === 'slug contains tm artifact'
    );

    console.log('CREARE EXPERIENCE CLASSIFICATION REPORT V2\n');

    for (const item of classifications) {
      console.log(`- title: ${item.title}`);
      console.log(`  slug: ${item.slug}`);
      console.log(`  classification: ${item.classification}`);
      console.log(`  confidence score: ${Math.round(item.confidence * 100)}`);
      console.log(`  exact reasons: ${item.reasons.length ? item.reasons.join('; ') : 'none'}`);
      console.log(
        `  similar records: ${
          item.similarRecords.length
            ? item.similarRecords
                .map(
                  (record) =>
                    `${record.slug} (title ${Math.round(record.titleScore * 100)}%, description ${Math.round(
                      record.descriptionScore * 100
                    )}%, strongest ${Math.round(record.strongest * 100)}%)`
                )
                .join(', ')
            : 'none'
        }`
      );
      console.log(`  missing fields: ${item.missingFields.length ? item.missingFields.join(', ') : 'none'}`);
      console.log(`  quality score: ${item.qualityScore}`);
      console.log(`  recommended action: ${item.recommendedAction}`);
    }

    console.log('\nGLOBAL REPORT:');
    console.log(`- total experiences: ${classifications.length}`);
    console.log(`- CORE count: ${buckets['CORE EXPERIENCE']}`);
    console.log(`- LEGACY count: ${buckets['LEGACY / TM VARIANT']}`);
    console.log(`- MERGE candidates: ${buckets['MERGE CANDIDATE']}`);
    console.log(`- INCOMPLETE count: ${buckets['INCOMPLETE / LOW VALUE']}`);
    console.log(`- READY_FOR_MVE count: ${buckets['READY FOR MVE COMPLETION']}`);
    console.log(`- false-positive warnings: ${falsePositives.length}`);

    console.log('\nTOP RISKS:');
    console.log('- duplicate concepts');
    console.log('- empty signature fields (wow_moment / differentiator)');
    console.log('- missing media');
    console.log('- missing ontology');

    console.log('\nACTION PLAN:');
    console.log(`- KEEP: ${keep.map((item) => item.slug).join(', ') || 'none'}`);
    console.log(`- MERGE: ${merge.map((item) => item.slug).join(', ') || 'none'}`);
    console.log(`- DELETE: ${deleteList.map((item) => item.slug).join(', ') || 'none'}`);
    console.log(
      `- COMPLETE FIRST: ${completeFirst.map((item) => item.slug).join(', ') || 'none'}`
    );
    console.log(
      `- LEGACY / ARCHIVE: ${classifications
        .filter((item) => item.classification === 'LEGACY / TM VARIANT')
        .map((item) => item.slug)
        .join(', ') || 'none'}`
    );
    console.log(
      `- recommended clean dataset: ${classifications
        .filter((item) => item.classification === 'CORE EXPERIENCE' || item.classification === 'READY FOR MVE COMPLETION')
        .map((item) => item.slug)
        .join(', ') || 'none'}`
    );

    console.log('\nSTATUS: EXPERIENCE CLASSIFICATION V2 COMPLETE');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
