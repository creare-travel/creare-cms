'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';
const PRODUCTION_URL =
  process.env.CREARE_PRODUCTION_STRAPI_URL ||
  'https://creare-cms-production.up.railway.app';

const CONCEPTS = [
  { key: 'beylerbeyi-1869', label: 'Beylerbeyi 1869', tokens: ['beylerbeyi', '1869'] },
  { key: 'bodrum-beach-games', label: 'Bodrum Beach Games', tokens: ['bodrum', 'beach', 'games'] },
  { key: 'cocktail-atelier', label: 'Cocktail Atelier', tokens: ['cocktail', 'atelier'] },
  { key: 'driven-by-performance', label: 'Driven by Performance', tokens: ['driven', 'performance'] },
  { key: 'golden-horn-regatta', label: 'Golden Horn Regatta', tokens: ['golden', 'horn', 'regatta'] },
  { key: 'imperial-flavors', label: 'Imperial Flavors', tokens: ['imperial', 'flavors'] },
  { key: 'masterchef-bodrum', label: 'Masterchef Bodrum', tokens: ['masterchef', 'bodrum'] },
  { key: 'princes-islands-regatta', label: 'Princes Islands Regatta', tokens: ['princes', 'islands', 'regatta'] },
  { key: 'the-salon-of-hands', label: 'The Salon of Hands', tokens: ['salon', 'hands'] },
];

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/™/g, ' tm ')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsTm = (slug) => /tm(?:-|$)/i.test(slug || '');

const matchesConcept = (record, concept) => {
  const haystack = `${normalizeText(record.title)} ${normalizeText(record.slug)}`;
  return concept.tokens.every((token) => haystack.includes(token));
};

const pickBestRecord = (records, concept) => {
  const matches = records.filter((record) => matchesConcept(record, concept));

  if (!matches.length) {
    return null;
  }

  return matches.sort((a, b) => {
    const aClean = containsTm(a.slug) ? 1 : 0;
    const bClean = containsTm(b.slug) ? 1 : 0;
    if (aClean !== bClean) return aClean - bClean;
    return normalizeText(a.title).length - normalizeText(b.title).length;
  })[0];
};

const toLocalShape = (record) => ({
  id: record.id ?? null,
  documentId: record.documentId ?? null,
  title: record.title || null,
  slug: record.slug || null,
  publishedAt: record.publishedAt || null,
  updatedAt: record.updatedAt || null,
});

const toProductionShape = (item) => ({
  id: item.id ?? null,
  documentId: item.documentId ?? null,
  title: item.title || null,
  slug: item.slug || null,
  publishedAt: item.publishedAt || null,
  updatedAt: item.updatedAt || null,
});

const getCanonicalSlug = (localRecord, productionRecord) => {
  if (productionRecord?.slug && !containsTm(productionRecord.slug)) return productionRecord.slug;
  if (localRecord?.slug && !containsTm(localRecord.slug)) return localRecord.slug;
  return productionRecord?.slug || localRecord?.slug || null;
};

const getConflictRisk = (localRecord, productionRecord) => {
  if (!localRecord || !productionRecord) return 'high';
  if (localRecord.slug === productionRecord.slug) return 'low';
  if (containsTm(localRecord.slug) !== containsTm(productionRecord.slug)) return 'medium';
  return 'high';
};

const getPublishStatusComparison = (localRecord, productionRecord) => ({
  localPublished: Boolean(localRecord?.publishedAt),
  productionPublished: Boolean(productionRecord?.publishedAt),
});

const fetchProductionExperiences = async () => {
  const url = `${PRODUCTION_URL}/api/experiences?pagination[pageSize]=100&locale=en`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Production request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
};

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const localExperiences = await strapi.documents(EXPERIENCE_UID).findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
    });
    const productionExperiences = await fetchProductionExperiences();

    const comparison = CONCEPTS.map((concept) => {
      const localRecord = pickBestRecord(localExperiences, concept);
      const productionRecord = pickBestRecord(productionExperiences, concept);
      const canonicalSlug = getCanonicalSlug(localRecord, productionRecord);

      return {
        concept: concept.label,
        local: localRecord ? toLocalShape(localRecord) : null,
        production: productionRecord ? toProductionShape(productionRecord) : null,
        slugsMatch: Boolean(localRecord?.slug && productionRecord?.slug && localRecord.slug === productionRecord.slug),
        localContainsTm: containsTm(localRecord?.slug),
        productionContainsTm: containsTm(productionRecord?.slug),
        recommendedCanonicalSlug: canonicalSlug,
        conflictRisk: getConflictRisk(localRecord, productionRecord),
        publishStatusComparison: getPublishStatusComparison(localRecord, productionRecord),
      };
    });

    console.log(
      JSON.stringify(
        {
          title: 'CREARE LOCAL VS PRODUCTION SLUG AUDIT',
          summary: {
            totalConceptsScanned: comparison.length,
            localOnly: comparison.filter((item) => item.local && !item.production).length,
            productionOnly: comparison.filter((item) => !item.local && item.production).length,
            matches: comparison.filter((item) => item.slugsMatch).length,
            tmConflicts: comparison.filter(
              (item) => item.localContainsTm || item.productionContainsTm
            ).length,
          },
          comparison,
        },
        null,
        2
      )
    );
    console.log('\nSTATUS: LOCAL VS PRODUCTION SLUG AUDIT COMPLETE');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error('Local vs production slug audit failed.');
  console.error(error);
  process.exit(1);
});
