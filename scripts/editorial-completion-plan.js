'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const EXPERIENCE_UID = 'api::experience.experience';

const APPROVED_SLUGS = [
  'driven-by-performancetm',
  'golden-horn-regattatm',
  'princes-islands-regattatm',
  'the-salon-of-handstm',
  'bodrum-beach-gamestm-rhythm-competition-celebration',
  'beylerbeyi-1869tm-empire-interrupted',
  'cocktail-ateliertm-mix-move-connect',
  'imperial-flavorstm-culinary-atelier',
  'masterchef-bodrumtm-culinary-competition',
];

const PROPOSALS = {
  'driven-by-performancetm': {
    cover_image_direction:
      'A controlled motorsport composition on a private track: one performance car in motion, one paused in the pit lane, with disciplined lines, late-afternoon light, and no generic racing crowd imagery.',
    positioning_why:
      'Emphasizes precision, controlled intensity, and private operational access rather than mass-market motorsport spectacle.',
  },
  'golden-horn-regattatm': {
    cover_image_direction:
      'A refined rowing scene on the Golden Horn with synchronized crews, clean water texture, and Istanbul’s historic silhouette in soft morning or dusk light.',
    positioning_why:
      'Frames the experience as strategic alignment on a historic waterway, combining athletic rhythm with cultural depth.',
  },
  'princes-islands-regattatm': {
    cover_image_direction:
      'Privately chartered sailing yachts in formation between the islands, photographed from a distance to show precision, open water, and the elegance of coordinated movement.',
    positioning_why:
      'Supports the experience’s sense of private access, fleet orchestration, and elevated maritime control.',
  },
  'the-salon-of-handstm': {
    cover_image_direction:
      'A quiet studio tableau: hands shaping clay in close-up, soft natural light, ceramic surfaces, and a restrained, contemplative palette.',
    positioning_why:
      'Signals intimacy, material sensitivity, and artist-led presence rather than workshop utility.',
  },
  'bodrum-beach-gamestm-rhythm-competition-celebration': {
    short_description:
      'A high-energy private beach experience in Bodrum where teams move between water competition, rhythmic social moments, and curated service.',
    cover_image_direction:
      'A privately controlled beach setting with athletic movement in the foreground and a refined lounge/bar atmosphere in the background, avoiding generic resort clichés.',
    positioning_why:
      'Keeps the balance between competition and hospitality, presenting the format as a designed social environment rather than a casual beach activity.',
  },
  'beylerbeyi-1869tm-empire-interrupted': {
    meta_title: 'Beylerbeyi 1869 | Historical Palace Experience in Istanbul | CREARE',
    meta_description:
      'A historical decision experience inside Beylerbeyi Palace where guests move through layered perspectives, reconstructing a moment of imperial fragility through space, narrative, and interpretation.',
    cover_image_direction:
      'An atmospheric palace interior with filtered Bosphorus light, architectural detail, and a sense of suspended historical tension rather than costumed spectacle.',
    positioning_why:
      'Supports the experience as a narrative and interpretive palace encounter shaped by power, perspective, and historical atmosphere.',
  },
  'cocktail-ateliertm-mix-move-connect': {
    meta_title: 'Cocktail Atelier | Private Mixology Experience in Bodrum | CREARE',
    meta_description:
      'A private mixology-led social atelier in Bodrum where guests create, present, and share signature cocktails within a choreographed garden setting shaped by rhythm, hosting, and interaction.',
    cover_image_direction:
      'A citrus garden bar scene in a private Michelin-starred setting, with crafted glassware, elegant movement, and no nightclub or mass-party cues.',
    positioning_why:
      'Positions the experience as social curation through taste, atmosphere, and live interaction rather than entertainment alone.',
  },
  'imperial-flavorstm-culinary-atelier': {
    meta_title: 'Imperial Flavors | Ottoman Culinary Atelier in Istanbul | CREARE',
    meta_description:
      'A small-group culinary atelier exploring Ottoman palace cuisine through guided preparation, plating, and visual composition in a refined Michelin-recognized setting.',
    cover_image_direction:
      'A composed culinary frame with Ottoman-inspired plating, refined mise-en-place, and intimate chef-led preparation in a polished restaurant environment.',
    positioning_why:
      'Reinforces the experience as historical gastronomy interpreted through craft, precision, and sensory refinement.',
  },
  'masterchef-bodrumtm-culinary-competition': {
    meta_title: 'Masterchef Bodrum | Private Culinary Competition by CREARE',
    meta_description:
      'A private open-air culinary competition in Bodrum where teams create and present dishes under Michelin-level evaluation, combining collaboration, pressure, and celebratory energy.',
    cover_image_direction:
      'An open-air chef competition scene with plated dishes, team interaction, and a strong sense of judged presentation rather than a classroom setup.',
    positioning_why:
      'Clarifies the experience as a competitive culinary format with high-touch structure and chef-led authority.',
  },
};

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === '';

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const experiences = await strapi.documents(EXPERIENCE_UID).findMany({
      locale: 'en',
      status: 'draft',
      sort: ['title:asc'],
      populate: ['cover_image'],
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

      const missingFields = [];
      const proposal = PROPOSALS[slug] || {};

      if (!experience.cover_image) missingFields.push('cover_image');
      if (isEmpty(experience.meta_title) && isEmpty(experience.seo_title)) missingFields.push('meta_title');
      if (isEmpty(experience.meta_description) && isEmpty(experience.seo_description))
        missingFields.push('meta_description');
      if (isEmpty(experience.short_description)) missingFields.push('short_description');
      if (!experience.publishedAt) missingFields.push('publishedAt');

      found.push({
        slug: experience.slug,
        title: experience.title,
        missingFields,
        proposed_meta_title: missingFields.includes('meta_title') ? proposal.meta_title || null : null,
        proposed_meta_description: missingFields.includes('meta_description')
          ? proposal.meta_description || null
          : null,
        proposed_short_description: missingFields.includes('short_description')
          ? proposal.short_description || null
          : null,
        cover_image_direction: proposal.cover_image_direction || null,
        why_this_supports_creare_positioning: proposal.positioning_why || null,
        publish_readiness_after_fix:
          missingFields.filter((field) => field !== 'publishedAt').length === 0 ? 'YES' : 'NO',
      });
    }

    console.log('CREARE EDITORIAL COMPLETION PLAN\n');

    for (const item of found) {
      console.log(`- slug: ${item.slug}`);
      console.log(`  missing fields: ${item.missingFields.length ? item.missingFields.join(', ') : 'none'}`);
      console.log(`  proposed meta_title: ${item.proposed_meta_title || 'n/a'}`);
      console.log(`  proposed meta_description: ${item.proposed_meta_description || 'n/a'}`);
      console.log(`  proposed short_description: ${item.proposed_short_description || 'n/a'}`);
      console.log(`  cover_image direction: ${item.cover_image_direction || 'n/a'}`);
      console.log(
        `  why this supports CREARE positioning: ${item.why_this_supports_creare_positioning || 'n/a'}`
      );
      console.log(`  publish readiness after fix: ${item.publish_readiness_after_fix}`);
    }

    if (missingRecords.length) {
      console.log('\n- approved records missing from current database:');
      for (const slug of missingRecords) {
        console.log(`  - ${slug}`);
      }
    }

    console.log('\nSTATUS: EDITORIAL COMPLETION PLAN READY');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
