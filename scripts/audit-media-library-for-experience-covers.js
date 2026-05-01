'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');

const MEDIA_UID = 'plugin::upload.file';

const CATEGORY_KEYWORDS = {
  performance: ['opera', 'music', 'performance', 'salon', 'stage', 'concert', 'sound'],
  gastronomy: ['culinary', 'food', 'chef', 'kitchen', 'table', 'farm', 'cocktail', 'drink', 'plating'],
  stillness: ['studio', 'ceramic', 'clay', 'quiet', 'still', 'calm', 'hands', 'minimal'],
  cultural: ['beylerbeyi', 'palace', 'ottoman', 'imperial', 'silk', 'historical', 'istanbul', 'heritage'],
  nautical: ['regatta', 'boat', 'yacht', 'sailing', 'sea', 'water', 'rowing', 'beach', 'bosphorus'],
};

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const classifyCategory = (asset) => {
  const haystack = normalizeText(
    [asset.name, asset.alternativeText, asset.caption, asset.url].filter(Boolean).join(' ')
  );

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }

  return 'general';
};

const getSuitability = (asset, category) => {
  if (!asset.mime?.startsWith('image/')) {
    return 'non-image';
  }

  if ((asset.width || 0) >= 1200 && (asset.height || 0) >= 800) {
    return category === 'general' ? 'usable' : 'strong-candidate';
  }

  if ((asset.width || 0) >= 800 && (asset.height || 0) >= 600) {
    return 'usable';
  }

  return 'weak-candidate';
};

const main = async () => {
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const assets = await strapi.db.query(MEDIA_UID).findMany({
      orderBy: { createdAt: 'desc' },
      select: [
        'id',
        'name',
        'url',
        'alternativeText',
        'caption',
        'width',
        'height',
        'mime',
        'provider',
        'createdAt',
      ],
    });

    const decorated = assets.map((asset) => {
      const category = classifyCategory(asset);
      const suitability = getSuitability(asset, category);

      return {
        id: asset.id,
        name: asset.name || null,
        url: asset.url || null,
        alternativeText: asset.alternativeText || null,
        caption: asset.caption || null,
        width: asset.width || null,
        height: asset.height || null,
        mime: asset.mime || null,
        provider: asset.provider || null,
        createdAt: asset.createdAt || null,
        suitability,
        possibleCategory: category,
      };
    });

    const usableImageAssets = decorated.filter(
      (asset) => asset.mime?.startsWith('image/') && asset.suitability !== 'weak-candidate'
    );
    const nonImageAssets = decorated.filter((asset) => !asset.mime?.startsWith('image/'));
    const assetsMissingAltText = decorated.filter(
      (asset) => asset.mime?.startsWith('image/') && !asset.alternativeText
    );

    const suggestedCandidatesByCategory = Object.fromEntries(
      ['performance', 'gastronomy', 'stillness', 'cultural', 'nautical', 'general'].map((category) => [
        category,
        decorated
          .filter(
            (asset) =>
              asset.possibleCategory === category &&
              asset.mime?.startsWith('image/') &&
              (asset.suitability === 'strong-candidate' || asset.suitability === 'usable')
          )
          .slice(0, 10),
      ])
    );

    console.log(
      JSON.stringify(
        {
          title: 'CREARE MEDIA LIBRARY COVER AUDIT',
          summary: {
            totalMediaAssets: decorated.length,
            usableImageAssets: usableImageAssets.length,
            nonImageAssets: nonImageAssets.length,
            assetsMissingAltText: assetsMissingAltText.length,
          },
          assets: decorated,
          suggestedCandidatesByCategory,
          assetsMissingAltText,
        },
        null,
        2
      )
    );

    console.log('\nSTATUS: MEDIA COVER AUDIT COMPLETE');
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
