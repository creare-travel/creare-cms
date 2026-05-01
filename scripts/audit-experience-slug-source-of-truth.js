'use strict';

const fs = require('fs');
const path = require('path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';
const EXPERIENCE_SCHEMA_PATH = path.join(
  process.cwd(),
  'src/api/experience/content-types/experience/schema.json'
);
const EXPERIENCE_LIFECYCLE_PATH = path.join(
  process.cwd(),
  'src/api/experience/content-types/experience/lifecycles.ts'
);
const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');

const isEmpty = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const isKebabCase = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '');

const walk = (dir) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(js|ts|json)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
};

const findTmReferences = () => {
  const files = walk(SCRIPTS_DIR);
  const references = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      if (/\btm\b|tm-|handstm|regattatm|performancetm|flavorstm|ateliertm|lenstm|istanbultm/i.test(line)) {
        references.push({
          file: path.relative(process.cwd(), filePath),
          line: index + 1,
          snippet: line.trim(),
        });
      }
    });
  }

  return references;
};

const main = async () => {
  const schema = JSON.parse(fs.readFileSync(EXPERIENCE_SCHEMA_PATH, 'utf8'));
  const lifecycleContent = fs.readFileSync(EXPERIENCE_LIFECYCLE_PATH, 'utf8');
  const tmReferences = findTmReferences();

  const slugField = schema.attributes?.slug || null;
  const oldSlugFields = Object.keys(schema.attributes || {}).filter((fieldName) =>
    /(old|previous|legacy).*slug|slug.*(old|previous|legacy)/i.test(fieldName)
  );

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experiences = await strapi.documents(EXPERIENCE_UID).findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
    });

    const records = experiences.map((experience) => {
      const slug = experience.slug || '';
      const containsTm = /tm(?:-|$)/i.test(slug);
      const hasLegacyField = oldSlugFields.some((fieldName) => !isEmpty(experience[fieldName]));

      return {
        id: experience.id ?? null,
        documentId: experience.documentId ?? null,
        title: experience.title || null,
        currentSlug: slug || null,
        containsTm,
        createdAt: experience.createdAt || null,
        updatedAt: experience.updatedAt || null,
        publishedAt: experience.publishedAt || null,
        slugLockFieldPresent: false,
        oldSlugFields: oldSlugFields.reduce((acc, fieldName) => {
          acc[fieldName] = experience[fieldName] ?? null;
          return acc;
        }, {}),
        frontendUrlLikelyUsesThisSlug: Boolean(
          !isEmpty(slug) && isKebabCase(slug) && experience.publishedAt
        ),
        hasLegacyField,
      };
    });

    const cleanSlugsCount = records.filter((record) => record.currentSlug && !record.containsTm).length;
    const tmSlugCount = records.filter((record) => record.containsTm).length;
    const staleReportsLikely = tmSlugCount > 0 ? 'real current slugs' : 'possibly stale reports';

    const scriptsReferencingTm = tmReferences.length
      ? tmReferences.map((ref) => `${ref.file}:${ref.line}`)
      : [];

    const report = {
      title: 'CREARE SLUG SOURCE-OF-TRUTH AUDIT',
      summary: {
        totalRecordsScanned: records.length,
        cleanSlugsCount,
        tmSlugCount,
        slugLockDetected:
          /Slugs are immutable after first creation/.test(lifecycleContent) &&
          /beforeUpdate/.test(lifecycleContent)
            ? 'YES'
            : 'NO',
        scriptsReferencingTm,
        previousReportsLikelyUsed: staleReportsLikely,
        recommendedNextAction:
          tmSlugCount > 0
            ? 'Treat current tm slugs as the real local source-of-truth until a deliberate cleanup/migration runs. Update audit/apply scripts to target the active environment explicitly.'
            : 'Use current clean slugs as canonical and retire any remaining tm-based script references.',
      },
      schemaAudit: {
        slugFieldName: slugField ? 'slug' : null,
        slugIsUnique: slugField?.type === 'uid' ? 'UID-enforced' : 'NO',
        slugTargetField: slugField?.targetField || null,
        slugLockLifecycleExists: fs.existsSync(EXPERIENCE_LIFECYCLE_PATH),
        slugLockLifecyclePath: path.relative(process.cwd(), EXPERIENCE_LIFECYCLE_PATH),
        legacySlugFieldsInSchema: oldSlugFields,
      },
      records,
      tmReferenceDetails: tmReferences,
    };

    console.log(JSON.stringify(report, null, 2));
    console.log('\nSTATUS: SLUG SOURCE-OF-TRUTH AUDIT COMPLETE');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error('Slug source-of-truth audit failed.');
  console.error(error);
  process.exit(1);
});
