'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const usage = () => {
  console.log('Usage: node scripts/update-experience-wow-differentiator.js --dry-run');
  console.log('   or: node scripts/update-experience-wow-differentiator.js --apply');
  console.log('   or: node scripts/update-experience-wow-differentiator.js --apply --force');
};

const UPDATES = [
  {
    slug: 'beylerbeyi-1869-empire-interrupted',
    wow_moment:
      'Guests move through Beylerbeyi Palace guided by a character-led narrative, encountering real spaces and objects as if stepping into the memories of the figures they embody.',
    differentiator:
      'The experience distributes perspective: each group inhabits a different historical voice, turning the palace into a multi-layered narrative rather than a single guided story.',
  },
  {
    slug: 'bodrum-beach-games-rhythm-competition-celebration',
    wow_moment:
      'Within a privately secured section of a public shoreline, guests move between high-energy water competitions and signature cocktail rituals, where sport, rhythm, and crafted service unfold simultaneously.',
    differentiator:
      'The experience creates a controlled, invitation-free private enclave inside a public beach, combining competitive water sports with mixology, curated service, and a fully orchestrated luxury beach environment.',
  },
  {
    slug: 'cocktail-atelier-mix-move-connect',
    wow_moment:
      'Inside a privately bought-out Michelin-starred restaurant, guests create and present signature cocktails within a citrus garden, guided and evaluated by the chef in a live, social atmosphere.',
    differentiator:
      'The experience blends mixology, competition, and social interaction within a fully private Michelin setting, where culinary authority and group dynamics are structured into a single curated environment.',
  },
  {
    slug: 'driven-by-performance',
    wow_moment:
      'On a fully private track, guests move from precision driving sessions into timed challenges—drift, slalom, emergency braking, and F1 simulation—culminating in a live pit-stop race against the clock.',
    differentiator:
      'The experience integrates motorsport performance with full-service logistics and optional F&B celebration, allowing the day to evolve from structured training into a staged awards ceremony and private BBQ gathering within a controlled circuit environment.',
  },
  {
    slug: 'floating-salon-d-opera',
    wow_moment:
      'On a private yacht along the Bosphorus, opera unfolds in close proximity as performers move among guests, blending arias, movement, and dining into a continuous, immersive flow.',
    differentiator:
      'The experience combines live baroque opera, fine dining, and a guided operational structure—where hosts and coordinators subtly direct the flow—creating a fully orchestrated, mobile cultural setting rather than a conventional performance.',
  },
  {
    slug: 'golden-horn-regatta',
    wow_moment:
      'Teams row through the calm waters of the Golden Horn, surrounded by layers of Istanbul’s maritime history, culminating in synchronized race finishes within a historic urban backdrop.',
    differentiator:
      'The experience combines competitive rowing with cultural context, structured team dynamics, and full operational orchestration—transforming a historic waterway into a controlled, high-touch event environment.',
  },
  {
    slug: 'imperial-flavors-culinary-atelier',
    wow_moment:
      'Within a Michelin-starred Ottoman kitchen setting, a small group prepares and plates their own dishes before experiencing them as both cuisine and visual composition.',
    differentiator:
      'Designed for a limited group, the experience combines historical Ottoman gastronomy, guided culinary creation, and optional food styling and photography—positioning cooking as a multi-sensory craft rather than a dining format.',
  },
  {
    slug: 'istanbul-through-the-lens',
    wow_moment:
      'Moving through hidden streets with a documentary photographer, guests encounter the city through framed moments—pausing, observing, and capturing spaces rarely noticed or accessed.',
    differentiator:
      'The experience is guided entirely by the photographer’s eye, combining discovery, conversation, and real-time image-making to position the city as a living visual study rather than a navigated route.',
  },
  {
    slug: 'masterchef-bodrum-culinary-competition',
    wow_moment:
      'In an open-air Michelin setting, teams simultaneously create their own dishes under identical conditions, culminating in a live judging where each plate reveals a different interpretation.',
    differentiator:
      'The experience structures culinary competition through Michelin-level evaluation, combining accessible participation, team dynamics, and chef-led scoring within a fully private, buy-out environment.',
  },
  {
    slug: 'the-studio-session',
    wow_moment:
      'Guests move freely between artistic stations—ceramics, painting, marbling, and calligraphy—creating their own pieces within a live studio environment guided by resident artists.',
    differentiator:
      'The experience removes structured instruction, allowing participants to engage with multiple art forms at their own pace, blending creation and exploration within an open, multi-disciplinary studio setting.',
  },
  {
    slug: 'princes-islands-regatta',
    wow_moment:
      'On privately chartered sailing yachts, guests take control at sea—learning, navigating, and moving in formation between islands—before a sunset return marked by a shared, high-precision finish.',
    differentiator:
      'The experience combines hands-on yacht sailing, island access, and optional regatta structure within a fully orchestrated fleet environment, supported by premium logistics, coordinated crews, and curated end-of-day celebration.',
  },
  {
    slug: 'silk-road-istanbul',
    wow_moment:
      'Guests trace the Silk Road through Istanbul’s palaces, hans, and hidden chambers, encountering rare porcelain collections and architectural layers that reflect centuries of trade.',
    differentiator:
      'The experience frames the city as a continuation of the Silk Road, connecting curated historical sites and refined dining into a guided narrative of commerce, movement, and cultural exchange.',
  },
  {
    slug: 'table-to-farm-bodrum',
    wow_moment:
      'Within an off-grid olive grove, guests prepare and share regional dishes under a Michelin chef’s guidance, surrounded by silence, open air, and the natural rhythm of the land.',
    differentiator:
      'The experience combines geographically rooted cuisine, hands-on preparation, and slow-luxury setting, transforming a working landscape into a private culinary environment defined by place and season.',
  },
  {
    slug: 'the-salon-of-hands',
    wow_moment:
      'In a quiet studio setting, guests shape clay by hand before witnessing it transform into sound, as the artist introduces ceramic instruments and activates them in real time.',
    differentiator:
      'The experience bridges form and vibration, combining guided hand-building with rare ceramic sound practices, within a small-scale, artist-led environment focused on material sensitivity and presence.',
  },
];

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === '';

const normalizePlain = (value) =>
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

const buildFallbackIndex = (experiences) => {
  const byNormalizedSlug = new Map();

  for (const experience of experiences) {
    const normalized = normalizeSlugComparable(experience.slug);

    if (!byNormalizedSlug.has(normalized)) {
      byNormalizedSlug.set(normalized, []);
    }

    byNormalizedSlug.get(normalized).push(experience);
  }

  return byNormalizedSlug;
};

const resolveExperience = (slug, experiencesBySlug, fallbackIndex) => {
  const directMatch = experiencesBySlug.get(slug) || null;

  if (directMatch) {
    return {
      experience: directMatch,
      matchType: 'clean-slug',
      confidence: 'high',
      matchedSlug: directMatch.slug,
    };
  }

  const candidates = fallbackIndex.get(normalizeSlugComparable(slug)) || [];

  if (candidates.length === 1) {
    return {
      experience: candidates[0],
      matchType: 'legacy-slug-fallback',
      confidence: 'high',
      matchedSlug: candidates[0].slug,
    };
  }

  return {
    experience: null,
    matchType: null,
    confidence: candidates.length > 1 ? 'low' : 'none',
    matchedSlug: null,
    candidateSlugs: candidates.map((candidate) => ({
      slug: candidate.slug,
      title: candidate.title,
      normalizedTitle: normalizePlain(candidate.title),
    })),
  };
};

const main = async () => {
  const isDryRun = process.argv.includes('--dry-run');
  const isApply = process.argv.includes('--apply');
  const isForce = process.argv.includes('--force');

  if ((isDryRun && isApply) || (!isDryRun && !isApply) || process.argv.length > (isForce ? 4 : 3)) {
    usage();
    process.exit(1);
  }

  if (isForce && !isApply) {
    usage();
    process.exit(1);
  }

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experienceService = strapi.documents('api::experience.experience');
    const experiences = await experienceService.findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
    });

    const experienceBySlug = new Map(experiences.map((experience) => [experience.slug, experience]));
    const fallbackIndex = buildFallbackIndex(experiences);
    const matched = [];
    const missingSlugs = [];
    const unresolved = [];
    const skipped = [];
    const readyToUpdate = [];
    const verifiedUpdates = [];
    const failedUpdates = [];

    for (const entry of UPDATES) {
      const resolution = resolveExperience(entry.slug, experienceBySlug, fallbackIndex);
      const experience = resolution.experience;

      if (!experience) {
        const unresolvedRecord = {
          cleanSlug: entry.slug,
          confidence: resolution.confidence,
          candidateSlugs: resolution.candidateSlugs || [],
        };
        missingSlugs.push(entry.slug);
        unresolved.push(unresolvedRecord);
        continue;
      }

      const currentValues = {
        wow_moment: experience.wow_moment ?? null,
        differentiator: experience.differentiator ?? null,
      };

      const updates = {};
      const skippedFields = {};

      for (const field of ['wow_moment', 'differentiator']) {
        const currentValue = experience[field] ?? null;
        const nextValue = entry[field];

        if (isForce || isEmpty(currentValue)) {
          updates[field] = nextValue;
        } else {
          skippedFields[field] = currentValue;
        }
      }

      const hasUpdates = Object.keys(updates).length > 0;
      const recordSummary = {
        cleanSlug: entry.slug,
        slug: experience.slug,
        title: experience.title,
        matchType: resolution.matchType,
        confidence: resolution.confidence,
        matchedLegacySlug: resolution.matchType === 'legacy-slug-fallback' ? experience.slug : null,
        currentValues,
        updates,
        skippedFields,
      };

      matched.push(recordSummary);

      if (!hasUpdates) {
        skipped.push({
          slug: experience.slug,
          title: experience.title,
          reason: 'target fields already populated',
          skippedFields,
        });
        continue;
      }

      if (!isDryRun) {
        const targetStatus = experience.publishedAt ? 'published' : 'draft';

        await experienceService.update({
          documentId: experience.documentId,
          locale: experience.locale || 'en',
          status: targetStatus,
          data: updates,
        });

        const verifiedRecord = await experienceService.findOne({
          documentId: experience.documentId,
          locale: experience.locale || 'en',
          status: targetStatus,
        });

        const wowExists = !isEmpty(verifiedRecord?.wow_moment);
        const differentiatorExists = !isEmpty(verifiedRecord?.differentiator);

        if (wowExists && differentiatorExists) {
          verifiedUpdates.push({
            slug: experience.slug,
            title: experience.title,
            wow_moment_exists: true,
            differentiator_exists: true,
          });
        } else {
          failedUpdates.push({
            slug: experience.slug,
            title: experience.title,
            wow_moment_exists: wowExists,
            differentiator_exists: differentiatorExists,
          });
        }
      }

      readyToUpdate.push(recordSummary);
    }

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          force: isForce,
          summary: {
            totalRecordsInUpdateList: UPDATES.length,
            matchedExperiences: matched.length,
            missingSlugs: missingSlugs.length,
            skippedBecauseFieldsAlreadyExist: skipped.length,
            recordsReadyToUpdate: readyToUpdate.length,
            attemptedUpdates: isDryRun ? 0 : readyToUpdate.length,
            successfullyVerifiedUpdates: isDryRun ? 0 : verifiedUpdates.length,
            failedUpdates: isDryRun ? 0 : failedUpdates.length,
          },
          matched,
          unresolved,
          missingSlugs,
          skipped,
          readyToUpdate,
          verifiedUpdates,
          failedUpdates,
          confirmation:
            'This script only updates wow_moment and differentiator on matched Experience records and does not change slugs, titles, descriptions, ontology fields, relations, publish status, localization, or any other fields.',
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
