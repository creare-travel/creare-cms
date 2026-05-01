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
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
};

const isKebabCase = (slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '');

const getRiskWeight = (risk) => {
  if (risk === 'critical') return 3;
  if (risk === 'medium') return 2;
  return 1;
};

const addIssue = (issues, experience, issueFound, whyItMatters, suggestedFix, riskLevel) => {
  issues.push({
    title: experience.title || '(untitled)',
    slug: experience.slug || '(missing-slug)',
    issueFound,
    whyItMatters,
    suggestedFix,
    riskLevel,
  });
};

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const schema = strapi.contentType(EXPERIENCE_UID);
    const attributes = schema.attributes || {};
    const experiences = await strapi.documents(EXPERIENCE_UID).findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
      populate: [
        'destination',
        'cover_image',
        'gallery',
        'mood_entity',
        'intensity_entity',
        'audience_entity',
        'experience_type_entity',
      ],
    });

    const slugCounts = new Map();
    const titleCounts = new Map();

    for (const experience of experiences) {
      slugCounts.set(experience.slug, (slugCounts.get(experience.slug) || 0) + 1);
      titleCounts.set(experience.title, (titleCounts.get(experience.title) || 0) + 1);
    }

    const issues = [];
    let recordsFullyHealthy = 0;
    let recordsNeedingAttention = 0;
    let jsonLdReadyRecords = 0;
    let blockedRecords = 0;
    let criticalIssues = 0;
    let mediumIssues = 0;
    let lowIssues = 0;

    for (const experience of experiences) {
      const recordIssues = [];
      const descriptionText = extractBlocksText(experience.description);
      const wowMoment = experience.wow_moment || '';
      const differentiator = experience.differentiator || '';
      const seoTitle =
        experience.meta_title || experience.seo_title || null;
      const seoDescription =
        experience.meta_description || experience.seo_description || null;

      if (isEmpty(experience.title)) {
        addIssue(
          recordIssues,
          experience,
          'Missing title',
          'Title is a core identity field for admin usability, SEO, and JSON-LD naming.',
          'Add a non-empty experience title.',
          'critical'
        );
      }

      if (isEmpty(experience.slug)) {
        addIssue(
          recordIssues,
          experience,
          'Missing slug',
          'Slug is required for routing, canonical URLs, and structured data references.',
          'Ensure the experience has a stable slug.',
          'critical'
        );
      } else if (!isKebabCase(experience.slug)) {
        addIssue(
          recordIssues,
          experience,
          'Slug is not kebab-case',
          'Inconsistent slug formatting can weaken URL consistency and JSON-LD cleanliness.',
          'Normalize the slug to lowercase kebab-case.',
          'medium'
        );
      }

      if (slugCounts.get(experience.slug) > 1) {
        addIssue(
          recordIssues,
          experience,
          'Duplicate slug detected',
          'Duplicate slugs can break routing and cause ambiguous structured data.',
          'Resolve the duplicate and keep one canonical slug.',
          'critical'
        );
      }

      if (titleCounts.get(experience.title) > 1) {
        addIssue(
          recordIssues,
          experience,
          'Duplicate title detected',
          'Duplicate titles can confuse editors and create ambiguous AI/entity references.',
          'Differentiate the titles or consolidate the duplicated records.',
          'medium'
        );
      }

      if (isEmpty(experience.short_description)) {
        addIssue(
          recordIssues,
          experience,
          'Missing short_description',
          'Short description is commonly used for previews, snippets, and compact structured summaries.',
          'Add a concise short description.',
          'medium'
        );
      }

      if (isEmpty(descriptionText)) {
        addIssue(
          recordIssues,
          experience,
          'Missing main description',
          'Main description is needed for editorial depth and AI-readable narrative context.',
          'Add body content to the main description field.',
          'critical'
        );
      }

      if (isEmpty(experience.category)) {
        addIssue(
          recordIssues,
          experience,
          'Missing category',
          'Category is a core experience classifier used across filtering and semantic positioning.',
          'Set a valid main category.',
          'medium'
        );
      }

      if (!experience.publishedAt) {
        addIssue(
          recordIssues,
          experience,
          'Missing publishedAt',
          'Unpublished records are not production-ready and cannot be relied on for live JSON-LD output.',
          'Publish the experience when editorially ready.',
          'critical'
        );
      }

      const enumRelationPairs = [
        ['mood', 'mood_entity'],
        ['intensity', 'intensity_entity'],
        ['audience_segment', 'audience_entity'],
        ['geo_experience_type', 'experience_type_entity'],
      ];

      for (const [enumField, relationField] of enumRelationPairs) {
        const enumValue = experience[enumField] ?? null;
        const relationValue = experience[relationField] ?? null;

        if (enumValue && !relationValue) {
          addIssue(
            recordIssues,
            experience,
            `${enumField} exists but ${relationField} is missing`,
            'Ontology relations power richer entity-aware API output and JSON-LD semantics.',
            `Backfill ${relationField} from the existing ${enumField} value.`,
            'medium'
          );
        }

        if (!enumValue && relationValue) {
          addIssue(
            recordIssues,
            experience,
            `${relationField} exists but ${enumField} is missing`,
            'The scalar enum fallback is still part of the current compatibility layer.',
            `Restore or align ${enumField} with the related ontology entity.`,
            'medium'
          );
        }
      }

      if (isEmpty(wowMoment)) {
        addIssue(
          recordIssues,
          experience,
          'Missing wow_moment',
          'wow_moment helps AI positioning, conversion framing, and structured narrative differentiation.',
          'Add a concrete wow_moment statement.',
          'medium'
        );
      } else if (wowMoment.trim().length < 80) {
        addIssue(
          recordIssues,
          experience,
          'wow_moment is too short',
          'A very short wow_moment usually lacks enough specificity for AI-readable positioning.',
          'Expand wow_moment with clearer experiential detail.',
          'low'
        );
      }

      if (isEmpty(differentiator)) {
        addIssue(
          recordIssues,
          experience,
          'Missing differentiator',
          'differentiator clarifies why the experience is distinct for sales, AI, and JSON-LD augmentation.',
          'Add a concrete differentiator statement.',
          'medium'
        );
      } else if (differentiator.trim().length < 80) {
        addIssue(
          recordIssues,
          experience,
          'differentiator is too short',
          'A short differentiator may not communicate true uniqueness to AI systems or editors.',
          'Expand the differentiator with more explicit uniqueness.',
          'low'
        );
      }

      if (!experience.cover_image) {
        addIssue(
          recordIssues,
          experience,
          'Missing cover_image',
          'Missing hero media weakens previews, social sharing, and rich result presentation.',
          'Attach a cover image to the experience.',
          'medium'
        );
      }

      if (isEmpty(seoTitle)) {
        addIssue(
          recordIssues,
          experience,
          'Missing SEO title',
          'SEO title supports search presentation and AI-readable page identity.',
          'Populate seo_title or meta_title.',
          'low'
        );
      }

      if (isEmpty(seoDescription)) {
        addIssue(
          recordIssues,
          experience,
          'Missing SEO description',
          'SEO description improves snippet quality and structured summary coverage.',
          'Populate seo_description or meta_description.',
          'low'
        );
      }

      const jsonLdReady =
        !isEmpty(experience.title) &&
        !isEmpty(experience.slug) &&
        isKebabCase(experience.slug) &&
        !isEmpty(experience.short_description) &&
        !isEmpty(descriptionText) &&
        !isEmpty(experience.category) &&
        !isEmpty(wowMoment) &&
        !isEmpty(differentiator) &&
        Boolean(experience.publishedAt);

      const blocked =
        isEmpty(experience.title) ||
        isEmpty(experience.slug) ||
        isEmpty(descriptionText) ||
        !experience.publishedAt;

      if (jsonLdReady) {
        jsonLdReadyRecords += 1;
      }

      if (blocked) {
        blockedRecords += 1;
      }

      if (recordIssues.length === 0) {
        recordsFullyHealthy += 1;
      } else {
        recordsNeedingAttention += 1;
      }

      for (const issue of recordIssues) {
        issues.push(issue);
        if (issue.riskLevel === 'critical') criticalIssues += 1;
        else if (issue.riskLevel === 'medium') mediumIssues += 1;
        else lowIssues += 1;
      }
    }

    issues.sort((a, b) => getRiskWeight(b.riskLevel) - getRiskWeight(a.riskLevel) || a.slug.localeCompare(b.slug));

    console.log('CREARE DATA INTEGRITY AUDIT REPORT\n');

    for (const issue of issues) {
      console.log(`- experience title: ${issue.title}`);
      console.log(`  slug: ${issue.slug}`);
      console.log(`  issue found: ${issue.issueFound}`);
      console.log(`  why it matters: ${issue.whyItMatters}`);
      console.log(`  suggested fix: ${issue.suggestedFix}`);
      console.log(`  risk level: ${issue.riskLevel}`);
    }

    console.log('\nSUMMARY:');
    console.log(`- total records scanned: ${experiences.length}`);
    console.log(`- records fully healthy: ${recordsFullyHealthy}`);
    console.log(`- records needing attention: ${recordsNeedingAttention}`);
    console.log(`- critical issues: ${criticalIssues}`);
    console.log(`- medium issues: ${mediumIssues}`);
    console.log(`- low issues: ${lowIssues}`);
    console.log(`- JSON-LD ready records: ${jsonLdReadyRecords}`);
    console.log(`- blocked records: ${blockedRecords}`);
    console.log('\nSTATUS: DATA INTEGRITY AUDIT COMPLETE');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
