'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
};

const normalizeTitle = (value) => {
  return normalizeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®]/g, ' ')
    .replace(/([a-z0-9])tm\b/gi, '$1')
    .replace(/\btm\b/gi, ' ')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

const richnessScore = (experience) => {
  let score = 0;

  if (normalizeString(experience.one_line_hook)) score += 20;
  if (textLength(experience.designed_for) > 0) score += 25;
  if (textLength(experience.experience_flow) > 0) score += 25;
  if (textLength(experience.description) > 0) score += Math.min(textLength(experience.description), 3000) / 20;
  if (normalizeString(experience.short_description)) score += 10;

  return score;
};

const keywordMatch = (haystack, keywords) => keywords.some((keyword) => haystack.includes(keyword));

const suggestGeoExperienceType = (experience, haystack) => {
  if (experience.category === 'signature') {
    return 'signature';
  }

  if (experience.category === 'black') {
    return 'private';
  }

  if (experience.category === 'lab') {
    if (
      keywordMatch(haystack, [
        'regatta',
        'beach',
        'water',
        'sailing',
        'season',
        'summer',
        'bodrum',
        'outdoor',
      ])
    ) {
      return 'seasonal';
    }

    return 'private';
  }

  return null;
};

const suggestMood = (haystack) => {
  if (keywordMatch(haystack, ['cocktail', 'celebration', 'champagne', 'party', 'dj'])) {
    return 'celebration';
  }

  if (keywordMatch(haystack, ['culinary', 'gastronomy', 'food', 'farm', 'table', 'chef', 'masterchef', 'flavor', 'dining'])) {
    return 'gastronomy';
  }

  if (keywordMatch(haystack, ['opera', 'performance', 'show', 'music', 'salon'])) {
    return 'performance';
  }

  if (keywordMatch(haystack, ['regatta', 'driving', 'beach games', 'competition', 'challenge', 'racing', 'wind', 'paddle'])) {
    return 'adventure';
  }

  if (keywordMatch(haystack, ['studio', 'stillness', 'calm', 'quiet', 'hands', 'gallery', 'clay'])) {
    return 'stillness';
  }

  return 'exploration';
};

const suggestAudienceSegment = (experience, haystack) => {
  if (keywordMatch(haystack, ['brand activation', 'brand-hosted', 'international brands', 'activation'])) {
    return 'brand_activation';
  }

  if (keywordMatch(haystack, ['executive', 'leadership', 'decision-making under uncertainty'])) {
    return 'executive';
  }

  if (keywordMatch(haystack, ['corporate', 'team', 'retreat', 'delegation', 'incentive', 'mice'])) {
    return 'corporate';
  }

  if (keywordMatch(haystack, ['private group', 'private groups', 'privately', 'private'])) {
    return 'private_group';
  }

  if (keywordMatch(haystack, ['luxury', 'collector', 'connoisseur', 'patrons', 'cultural traveler'])) {
    return 'luxury_traveler';
  }

  return experience.category === 'lab' ? 'corporate' : 'private_group';
};

const suggestIntensity = (haystack) => {
  if (keywordMatch(haystack, ['driving', 'competition', 'high-performance', 'racing', 'beach games'])) {
    return 'high';
  }

  if (keywordMatch(haystack, ['exploration', 'journey', 'workshop', 'regatta', 'sailing', 'lens', 'atelier'])) {
    return 'medium';
  }

  return 'low';
};

const chooseCanonicalExperiences = (experiences) => {
  const grouped = new Map();

  for (const experience of experiences) {
    const key = normalizeTitle(experience.title);

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(experience);
  }

  return [...grouped.values()]
    .map((group) =>
      [...group].sort((left, right) => {
        const scoreDiff = richnessScore(right) - richnessScore(left);

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
      })[0]
    )
    .sort((left, right) => left.title.localeCompare(right.title));
};

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experiences = await strapi.documents('api::experience.experience').findMany({
      locale: 'en',
      status: 'draft',
      populate: ['destination'],
      sort: ['title:asc'],
    });

    const canonicalExperiences = chooseCanonicalExperiences(experiences);
    const suggestions = canonicalExperiences.map((experience) => {
      const haystack = normalizeTitle(
        [
          experience.title,
          experience.short_description,
          experience.one_line_hook,
          collectText(experience.description),
          collectText(experience.designed_for),
          experience.location,
          experience.destination?.name,
        ]
          .filter(Boolean)
          .join(' ')
      );

      return {
        title: experience.title,
        slug: experience.slug,
        destination: experience.destination?.name || null,
        currentCategory: experience.category || null,
        currentExperienceType: experience.experience_type || null,
        currentGeoExperienceType: experience.geo_experience_type || null,
        currentAudienceFieldType: 'blocks',
        currentAudienceSegment: experience.audience_segment || null,
        currentIntentLevel: experience.intent_level || null,
        suggestedGeoExperienceType: suggestGeoExperienceType(experience, haystack),
        suggestedMood: suggestMood(haystack),
        suggestedAudienceSegment: suggestAudienceSegment(experience, haystack),
        suggestedIntensity: suggestIntensity(haystack),
      };
    });

    console.log(
      JSON.stringify(
        {
          reviewed: suggestions.length,
          suggestions,
          notes: [
            'destination already exists as a relation',
            'experience_type already exists and remains unchanged for editorial/domain use',
            'audience already exists as blocks content and remains unchanged for editorial use',
            'geo_experience_type and audience_segment are the new machine-readable GEO/AI fields',
            'mood and intensity remain part of the machine-readable enrichment layer',
          ],
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
