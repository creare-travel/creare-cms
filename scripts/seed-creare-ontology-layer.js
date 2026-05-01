'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const usage = () => {
  console.log('Usage: node scripts/seed-creare-ontology-layer.js --dry-run');
  console.log('   or: node scripts/seed-creare-ontology-layer.js --apply');
};

const ontologySeed = {
  mood: [
    {
      name: 'Exploration',
      slug: 'exploration',
      description: 'A mood centered on curiosity, discovery, movement, and unfolding perspective.',
      synonyms: ['discovery', 'curiosity', 'wandering'],
      semantic_tags: ['cultural-discovery', 'journey', 'observation'],
      visual_mood_tags: ['layered-city', 'thresholds', 'movement'],
      sound_landscape: 'Footsteps, ambient city textures, distant voices, evolving spatial acoustics.',
      sensory_keywords: ['curiosity', 'movement', 'texture', 'light', 'transition'],
      confidence_score: 0.96,
    },
    {
      name: 'Celebration',
      slug: 'celebration',
      description: 'A social and energetic mood built around joy, gathering, rhythm, and shared expression.',
      synonyms: ['festivity', 'joy', 'gathering'],
      semantic_tags: ['social-energy', 'ritual', 'shared-memory'],
      visual_mood_tags: ['sunset', 'gathering', 'spark'],
      sound_landscape: 'Music, conversation, applause, upbeat transitions, rising collective energy.',
      sensory_keywords: ['rhythm', 'connection', 'spark', 'energy', 'shared joy'],
      confidence_score: 0.95,
    },
    {
      name: 'Stillness',
      slug: 'stillness',
      description: 'A contemplative mood of curated quietude and inner refuge, emphasizing calm attention, slowness, and inward focus rather than mere silence.',
      synonyms: ['calm', 'quiet', 'presence'],
      semantic_tags: ['contemplation', 'pause', 'presence'],
      same_as: ['https://dbpedia.org/page/Inner_peace'],
      visual_mood_tags: ['soft-light', 'silence', 'minimalism'],
      sound_landscape: 'Low ambient sound, softened room tone, intimate pauses, restrained movement.',
      sensory_keywords: ['silence', 'focus', 'softness', 'presence', 'breath'],
      confidence_score: 0.94,
    },
    {
      name: 'Performance',
      slug: 'performance',
      description: 'A mood shaped by stagecraft, expression, timing, and deliberate emotional composition.',
      synonyms: ['theatricality', 'staging', 'expression'],
      semantic_tags: ['stage', 'narrative', 'dramaturgy'],
      visual_mood_tags: ['spotlight', 'gesture', 'choreography'],
      sound_landscape: 'Music-led transitions, silence before reveal, dynamic shifts in attention.',
      sensory_keywords: ['gesture', 'reveal', 'voice', 'timing', 'presence'],
      confidence_score: 0.97,
    },
    {
      name: 'Gastronomy',
      slug: 'gastronomy',
      description: 'A mood rooted in taste, craft, ritual, and culinary storytelling.',
      synonyms: ['culinary', 'taste', 'table culture', 'epicurean'],
      semantic_tags: ['food-culture', 'craft', 'sensory-ritual'],
      same_as: ['https://dbpedia.org/page/Epicureanism'],
      visual_mood_tags: ['table-setting', 'plating', 'ingredient-detail'],
      sound_landscape: 'Kitchen rhythm, glassware, conversation around table, intimate hosting cadence.',
      sensory_keywords: ['taste', 'aroma', 'texture', 'craft', 'ritual'],
      confidence_score: 0.98,
    },
    {
      name: 'Adventure',
      slug: 'adventure',
      description: 'A mood defined by momentum, uncertainty, challenge, and heightened engagement.',
      synonyms: ['challenge', 'momentum', 'excitement'],
      semantic_tags: ['movement', 'competition', 'adrenaline'],
      visual_mood_tags: ['open-water', 'speed', 'kinetic-motion'],
      sound_landscape: 'Wind, exertion, countdowns, water movement, acceleration, collective response.',
      sensory_keywords: ['momentum', 'risk', 'coordination', 'speed', 'intensity'],
      confidence_score: 0.95,
    },
  ],
  audienceSegment: [
    {
      name: 'Corporate',
      slug: 'corporate',
      description: 'Audience segment focused on team alignment, shared performance, and organizational outcomes.',
      synonyms: ['team', 'organization', 'company'],
      semantic_tags: ['b2b', 'team-experience', 'organizational-alignment'],
      same_as: ['https://schema.org/BusinessAudience'],
      confidence_score: 0.95,
    },
    {
      name: 'Luxury Traveler',
      slug: 'luxury-traveler',
      description: 'Audience segment seeking high-touch, rare, and deeply curated travel experiences.',
      synonyms: ['high-net-worth traveler', 'premium traveler', 'luxury guest'],
      semantic_tags: ['premium-travel', 'curation', 'rarity'],
      same_as: ['https://schema.org/TouristTrip'],
      confidence_score: 0.94,
    },
    {
      name: 'Private Group',
      slug: 'private-group',
      description: 'Audience segment centered on intimate, invitation-based, or closed-group participation.',
      synonyms: ['closed group', 'private guests', 'intimate gathering'],
      semantic_tags: ['private-access', 'small-group', 'intimacy'],
      same_as: ['https://schema.org/Audience'],
      confidence_score: 0.94,
    },
    {
      name: 'Brand Activation',
      slug: 'brand-activation',
      description: 'Audience segment oriented around hosted experiences designed for brand signaling and engagement.',
      synonyms: ['brand-led event', 'activation', 'hosted experience'],
      semantic_tags: ['brand-strategy', 'activation', 'audience-engagement'],
      same_as: ['https://schema.org/Event'],
      confidence_score: 0.93,
    },
    {
      name: 'Executive',
      slug: 'executive',
      description: 'Audience segment for senior leadership, high-stakes decision makers, and executive groups.',
      synonyms: ['leadership', 'c-suite', 'senior decision makers'],
      semantic_tags: ['executive-leadership', 'decision-making', 'high-trust'],
      same_as: ['https://schema.org/BusinessAudience'],
      confidence_score: 0.95,
    },
    {
      name: 'High Net Worth Individual',
      slug: 'high-net-worth-individual',
      description: 'Audience segment for high-net-worth private luxury clients expecting discretion, personalization, and premium service depth.',
      synonyms: ['hnwi', 'high-net-worth individual', 'private luxury client'],
      semantic_tags: ['hnwi', 'high net worth', 'premium expectation', 'private luxury client'],
      same_as: ['https://dbpedia.org/page/High-net-worth_individual'],
      confidence_score: 0.96,
    },
  ],
  experienceType: [
    {
      name: 'Signature',
      slug: 'signature',
      description: 'Primary CREARE flagship experience type representing core brand-defining formats.',
      schema_hint: 'Flagship canonical experience',
      external_reference_url: '',
      same_as: ['https://schema.org/TouristTrip'],
      confidence_score: 0.99,
    },
    {
      name: 'Private',
      slug: 'private',
      description: 'Experience type indicating intimate, custom, or access-controlled formats.',
      schema_hint: 'Privately arranged or invitation-led experience',
      external_reference_url: '',
      same_as: ['https://schema.org/VIPPackage'],
      confidence_score: 0.95,
    },
    {
      name: 'Seasonal',
      slug: 'seasonal',
      description: 'Experience type indicating timing-sensitive or seasonally activated formats.',
      schema_hint: 'Season-based or time-sensitive experience',
      external_reference_url: '',
      same_as: ['https://schema.org/Event'],
      confidence_score: 0.94,
    },
    {
      name: 'Bespoke',
      slug: 'bespoke',
      description: 'Experience type representing tailor-made formats built around the client rather than a fixed itinerary.',
      schema_hint: 'Tailor-made / custom designed experience',
      external_reference_url: '',
      same_as: ['https://dbpedia.org/page/Bespoke'],
      confidence_score: 0.94,
    },
    {
      name: 'Heritage',
      slug: 'heritage',
      description: 'Experience type anchored in cultural continuity, historic access, and heritage interpretation.',
      schema_hint: 'Cultural heritage-led experience',
      external_reference_url: '',
      same_as: ['https://dbpedia.org/page/Cultural_heritage'],
      confidence_score: 0.95,
    },
    {
      name: 'Wellness Retreat',
      slug: 'wellness-retreat',
      description: 'Experience type centered on restoration, retreat, and intentional wellbeing-led pacing.',
      schema_hint: 'Wellness tourism or retreat format',
      external_reference_url: '',
      same_as: ['https://dbpedia.org/page/Wellness_tourism'],
      confidence_score: 0.92,
    },
    {
      name: 'Concierge Service',
      slug: 'concierge-service',
      description: 'Experience type representing access, coordination, and high-touch service orchestration.',
      schema_hint: 'Concierge-mediated service layer',
      external_reference_url: '',
      same_as: ['https://dbpedia.org/page/Concierge'],
      confidence_score: 0.91,
    },
    {
      name: 'Sustainability',
      slug: 'sustainability',
      description: 'Experience type emphasizing ecological responsibility, local continuity, and sustainable tourism values.',
      schema_hint: 'Sustainable tourism-aligned format',
      external_reference_url: '',
      same_as: ['https://dbpedia.org/page/Sustainable_tourism'],
      confidence_score: 0.9,
    },
    {
      name: 'Authenticity',
      slug: 'authenticity',
      description: 'Experience type oriented around real cultural texture, lived context, and non-simulated access.',
      schema_hint: 'Authenticity-led cultural format',
      external_reference_url: '',
      same_as: ['https://dbpedia.org/page/Authenticity_(philosophy)'],
      confidence_score: 0.9,
    },
  ],
  intensity: [
    {
      name: 'Low',
      slug: 'low',
      description: 'Low intensity experience emphasizing calm, slowness, reflection, or gentle pacing.',
    },
    {
      name: 'Medium',
      slug: 'medium',
      description: 'Medium intensity experience balancing movement, engagement, and reflection.',
    },
    {
      name: 'High',
      slug: 'high',
      description: 'High intensity experience emphasizing speed, challenge, competition, or strong momentum.',
    },
    {
      name: 'Secluded',
      slug: 'secluded',
      description: 'An intensity-adjacent privacy state emphasizing withdrawal from public exposure, discretion, and protected access.',
      same_as: ['https://dbpedia.org/page/Privacy'],
    },
  ],
};

const moods = ontologySeed.mood;
const audienceSegments = ontologySeed.audienceSegment;
const experienceTypes = ontologySeed.experienceType;
const intensities = ontologySeed.intensity;

const datasets = {
  moods,
  audienceSegments,
  experienceTypes,
  intensities,
};

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
};

const isEmptyValue = (value) => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return normalizeString(value).length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
};

const buildUpdateData = (existing, seedEntry) => {
  const data = {};

  for (const [key, value] of Object.entries(seedEntry)) {
    if (key === 'slug') {
      continue;
    }

    if (isEmptyValue(existing?.[key]) && !isEmptyValue(value)) {
      data[key] = value;
    }
  }

  return data;
};

const syncCollection = async ({ service, uid, entries, slugField = 'slug', isDryRun }) => {
  const existingEntries = await service.findMany({
    status: 'draft',
    sort: ['name:asc'],
  });

  const bySlug = new Map(existingEntries.map((entry) => [entry[slugField], entry]));
  const results = [];

  for (const seedEntry of entries) {
    const existing = bySlug.get(seedEntry.slug) || null;

    if (!existing) {
      results.push({
        uid,
        action: 'create',
        slug: seedEntry.slug,
        name: seedEntry.name,
        data: seedEntry,
      });

      if (!isDryRun) {
        await service.create({
          data: {
            ...seedEntry,
            publishedAt: new Date(),
          },
        });
      }

      continue;
    }

    const updateData = buildUpdateData(existing, seedEntry);
    const shouldUpdate = Object.keys(updateData).length > 0;

    results.push({
      uid,
      action: shouldUpdate ? 'update-missing-fields' : 'skip',
      slug: seedEntry.slug,
      name: seedEntry.name,
      data: updateData,
    });

    if (!isDryRun && shouldUpdate) {
      await service.update({
        documentId: existing.documentId,
        data: updateData,
      });
    }
  }

  return results;
};

const seedOntologyLayer = async ({ strapi, isDryRun }) => {
  console.log('MOODS LENGTH:', datasets.moods.length);
  console.log('AUDIENCE LENGTH:', datasets.audienceSegments.length);
  console.log('EXPERIENCE TYPES LENGTH:', datasets.experienceTypes.length);
  console.log('INTENSITIES LENGTH:', datasets.intensities.length);

  const moodResults = await syncCollection({
    uid: 'api::mood.mood',
    service: strapi.documents('api::mood.mood'),
    entries: datasets.moods,
    isDryRun,
  });

  const audienceResults = await syncCollection({
    uid: 'api::audience-segment.audience-segment',
    service: strapi.documents('api::audience-segment.audience-segment'),
    entries: datasets.audienceSegments,
    isDryRun,
  });

  const experienceTypeResults = await syncCollection({
    uid: 'api::experience-type.experience-type',
    service: strapi.documents('api::experience-type.experience-type'),
    entries: datasets.experienceTypes,
    isDryRun,
  });

  const intensityResults = await syncCollection({
    uid: 'api::intensity.intensity',
    service: strapi.documents('api::intensity.intensity'),
    entries: datasets.intensities,
    isDryRun,
  });

  const allResults = [...moodResults, ...audienceResults, ...experienceTypeResults, ...intensityResults];

  return {
    mode: isDryRun ? 'dry-run' : 'apply',
    summary: {
      create: allResults.filter((item) => item.action === 'create').length,
      updateMissingFields: allResults.filter((item) => item.action === 'update-missing-fields').length,
      skip: allResults.filter((item) => item.action === 'skip').length,
    },
    results: allResults,
    confirmation: 'No Experience records are read or modified by this script.',
  };
};

module.exports.seedOntologyLayer = seedOntologyLayer;

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

    const result = await seedOntologyLayer({ strapi, isDryRun });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await strapi.destroy();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
