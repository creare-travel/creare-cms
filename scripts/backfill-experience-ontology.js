'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const usage = () => {
  console.log('Usage: node scripts/backfill-experience-ontology.js --dry-run');
  console.log('   or: node scripts/backfill-experience-ontology.js --apply');
};

const FIELD_MAPPINGS = [
  {
    enumField: 'mood',
    relationField: 'mood_entity',
    uid: 'api::mood.mood',
  },
  {
    enumField: 'audience_segment',
    relationField: 'audience_entity',
    uid: 'api::audience-segment.audience-segment',
  },
  {
    enumField: 'geo_experience_type',
    relationField: 'experience_type_entity',
    uid: 'api::experience-type.experience-type',
  },
  {
    enumField: 'intensity',
    relationField: 'intensity_entity',
    uid: 'api::intensity.intensity',
  },
];

const normalizeOntologySlug = (field, value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const raw = String(value).trim();

  if (!raw) {
    return null;
  }

  if (field === 'audience_segment') {
    return raw
      .toLowerCase()
      .replace(/luxury_traveler/g, 'luxury-traveler')
      .replace(/private_group/g, 'private-group')
      .replace(/brand_activation/g, 'brand-activation')
      .replace(/_/g, '-');
  }

  return raw.toLowerCase().replace(/_/g, '-');
};

const summarizeField = (summary, field, status, payload) => {
  if (!summary[field]) {
    summary[field] = {
      matched: 0,
      missing: 0,
      alreadyPopulated: 0,
      emptyEnum: 0,
      normalizationIssues: [],
      missingMatches: [],
    };
  }

  if (status === 'matched') {
    summary[field].matched += 1;
  } else if (status === 'missing') {
    summary[field].missing += 1;
    summary[field].missingMatches.push(payload);
  } else if (status === 'alreadyPopulated') {
    summary[field].alreadyPopulated += 1;
  } else if (status === 'emptyEnum') {
    summary[field].emptyEnum += 1;
  } else if (status === 'normalizationIssue') {
    summary[field].normalizationIssues.push(payload);
  }
};

const main = async () => {
  const isDryRun = process.argv.includes('--dry-run');
  const isApply = process.argv.includes('--apply');

  if ((isDryRun && isApply) || (!isDryRun && !isApply) || process.argv.length > 3) {
    usage();
    process.exit(1);
  }

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experienceService = strapi.documents('api::experience.experience');
    const ontologyServices = Object.fromEntries(
      FIELD_MAPPINGS.map((mapping) => [mapping.uid, strapi.documents(mapping.uid)])
    );

    const [experiences, moodEntities, audienceEntities, experienceTypeEntities, intensityEntities] =
      await Promise.all([
        experienceService.findMany({
          locale: 'en',
          status: 'draft',
          sort: ['title:asc'],
          populate: ['mood_entity', 'audience_entity', 'experience_type_entity', 'intensity_entity'],
        }),
        ontologyServices['api::mood.mood'].findMany({ status: 'draft', sort: ['name:asc'] }),
        ontologyServices['api::audience-segment.audience-segment'].findMany({
          status: 'draft',
          sort: ['name:asc'],
        }),
        ontologyServices['api::experience-type.experience-type'].findMany({
          status: 'draft',
          sort: ['name:asc'],
        }),
        ontologyServices['api::intensity.intensity'].findMany({ status: 'draft', sort: ['name:asc'] }),
      ]);

    const ontologyByUid = {
      'api::mood.mood': new Map(moodEntities.map((entry) => [entry.slug, entry])),
      'api::audience-segment.audience-segment': new Map(audienceEntities.map((entry) => [entry.slug, entry])),
      'api::experience-type.experience-type': new Map(
        experienceTypeEntities.map((entry) => [entry.slug, entry])
      ),
      'api::intensity.intensity': new Map(intensityEntities.map((entry) => [entry.slug, entry])),
    };

    const reviewed = [];
    const perFieldSummary = {};
    const experiencesWithNoEnumValues = [];
    const experiencesAlreadyPartiallyMapped = [];
    const skipped = [];
    const updated = [];

    for (const experience of experiences) {
      const enumValues = {};
      const matchedOntologyEntities = {};
      const missingMatches = {};
      const alreadyPopulatedRelations = {};
      const normalizationIssues = {};
      const pendingRelationUpdates = {};

      let hasAnyEnumValue = false;
      let hasAnyPopulatedRelation = false;
      let hasMissingEnumValue = false;
      let hasMissingOntologyMatch = false;

      for (const mapping of FIELD_MAPPINGS) {
        const rawValue = experience[mapping.enumField] ?? null;
        const normalizedSlug = normalizeOntologySlug(mapping.enumField, rawValue);
        const currentRelation = experience[mapping.relationField] || null;

        enumValues[mapping.enumField] = rawValue;

        if (!rawValue) {
          hasMissingEnumValue = true;
          summarizeField(perFieldSummary, mapping.enumField, 'emptyEnum');
          continue;
        }

        hasAnyEnumValue = true;

        if (normalizedSlug !== rawValue) {
          normalizationIssues[mapping.enumField] = {
            raw: rawValue,
            normalizedSlug,
          };
          summarizeField(perFieldSummary, mapping.enumField, 'normalizationIssue', {
            experienceSlug: experience.slug,
            raw: rawValue,
            normalizedSlug,
          });
        }

        const ontologyMatch = ontologyByUid[mapping.uid].get(normalizedSlug) || null;

        if (!ontologyMatch) {
          hasMissingOntologyMatch = true;
          missingMatches[mapping.enumField] = {
            raw: rawValue,
            normalizedSlug,
          };
          summarizeField(perFieldSummary, mapping.enumField, 'missing', {
            experienceSlug: experience.slug,
            raw: rawValue,
            normalizedSlug,
          });
        } else {
          matchedOntologyEntities[mapping.enumField] = {
            slug: ontologyMatch.slug,
            name: ontologyMatch.name,
            documentId: ontologyMatch.documentId,
          };
          summarizeField(perFieldSummary, mapping.enumField, 'matched');
        }

        if (currentRelation) {
          hasAnyPopulatedRelation = true;
          alreadyPopulatedRelations[mapping.relationField] = {
            slug: currentRelation.slug || null,
            name: currentRelation.name || null,
            documentId: currentRelation.documentId || null,
            matchesEnumTarget:
              Boolean(ontologyMatch) && currentRelation.slug === ontologyMatch.slug,
          };
          summarizeField(perFieldSummary, mapping.enumField, 'alreadyPopulated');
        } else if (ontologyMatch) {
          pendingRelationUpdates[mapping.relationField] = ontologyMatch.documentId;
        }
      }

      if (!hasAnyEnumValue) {
        experiencesWithNoEnumValues.push({
          title: experience.title,
          slug: experience.slug,
        });
      }

      if (hasAnyPopulatedRelation) {
        experiencesAlreadyPartiallyMapped.push({
          title: experience.title,
          slug: experience.slug,
          alreadyPopulatedRelations,
        });
      }

      const skipReasons = [];

      if (hasMissingEnumValue) {
        skipReasons.push('missing one or more enum values');
      }

      if (hasMissingOntologyMatch) {
        skipReasons.push('missing ontology match for one or more enum values');
      }

      const pendingUpdateFields = Object.keys(pendingRelationUpdates);
      const hasAlreadyPopulatedMismatches = Object.values(alreadyPopulatedRelations).some(
        (relation) => relation.matchesEnumTarget === false
      );

      if (hasAlreadyPopulatedMismatches) {
        skipReasons.push('one or more populated relation fields do not match enum target');
      }

      if (isApply) {
        if (skipReasons.length > 0) {
          skipped.push({
            title: experience.title,
            slug: experience.slug,
            reasons: skipReasons,
          });
        } else if (pendingUpdateFields.length === 0) {
          skipped.push({
            title: experience.title,
            slug: experience.slug,
            reasons: ['all ontology relation fields already populated'],
          });
        } else {
          await experienceService.update({
            documentId: experience.documentId,
            locale: 'en',
            data: pendingUpdateFields.reduce((acc, field) => {
              acc[field] = pendingRelationUpdates[field];
              return acc;
            }, {}),
          });

          updated.push({
            title: experience.title,
            slug: experience.slug,
            updatedFields: pendingUpdateFields,
            matchedOntologyEntities,
          });
        }
      }

      reviewed.push({
        title: experience.title,
        slug: experience.slug,
        enumValues,
        matchedOntologyEntities,
        missingMatches,
        alreadyPopulatedRelations,
        normalizationIssues,
        pendingRelationUpdates,
        skipped: skipReasons,
      });
    }

    const summary = {
      totalExperiencesScanned: experiences.length,
      successfulMatches: Object.fromEntries(
        Object.entries(perFieldSummary).map(([field, data]) => [field, data.matched])
      ),
      missingOntologyMatches: Object.fromEntries(
        Object.entries(perFieldSummary)
          .filter(([, data]) => data.missingMatches.length > 0)
          .map(([field, data]) => [field, data.missingMatches])
      ),
      normalizationIssues: Object.fromEntries(
        Object.entries(perFieldSummary)
          .filter(([, data]) => data.normalizationIssues.length > 0)
          .map(([field, data]) => [field, data.normalizationIssues])
      ),
      experiencesWithNoEnumValues,
      experiencesAlreadyPartiallyMapped,
      experiencesUpdated: updated.length,
      experiencesSkipped: skipped.length,
      skipped,
      fieldStats: perFieldSummary,
      relationFieldsPopulatedPerCollection: updated.reduce((acc, entry) => {
        for (const field of entry.updatedFields) {
          acc[field] = (acc[field] || 0) + 1;
        }
        return acc;
      }, {}),
      potentialRisks: [
        'Relation fields require populate in API consumers once backfill is applied.',
        'Experiences with already populated relation fields should be checked for enum-to-relation consistency before apply.',
        'Experiences with empty enum values will remain unlinked unless enriched first.',
      ],
    };

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          reviewed,
          updated,
          summary,
          confirmation: isDryRun
            ? 'No Experience records were updated by this script.'
            : 'Enum fields, titles, slugs, and publication state were not modified by this script.',
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
