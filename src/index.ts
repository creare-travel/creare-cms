import type { Core } from '@strapi/strapi';

const blockText = (text: string): any => [
  {
    type: 'paragraph',
    children: [
      {
        type: 'text',
        text,
      },
    ],
  },
];

const destinationSeed = [
  {
    name: 'Istanbul',
    slug: 'istanbul',
    region: 'Turkey',
    short_description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    intro_text:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus id lorem a nibh suscipit malesuada. Sed ut perspiciatis unde omnis iste natus error sit voluptatem.',
    highlight: 'Lorem ipsum dolor sit amet.',
    description: blockText(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent finibus, leo et aliquet hendrerit, lacus arcu pretium mauris, in suscipit est erat vel nibh.'
    ),
    sections: [
      {
        section_number: 1,
        title: 'Arrival',
        body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae nisl et magna placerat faucibus.',
      },
      {
        section_number: 2,
        title: 'Cultural Layer',
        body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla facilisi. Nunc ut vulputate turpis.',
      },
    ],
    visibility_status: 'active',
    meta_title: 'Istanbul | CREARE',
    meta_description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Istanbul placeholder metadata for CREARE.',
    order_index: 1,
  },
  {
    name: 'Bodrum',
    slug: 'bodrum',
    region: 'Turkey',
    short_description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    intro_text:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse potenti. Curabitur gravida elit non sapien vulputate, vitae convallis dui malesuada.',
    highlight: 'Lorem ipsum dolor sit amet.',
    description: blockText(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam in dignissim justo. Aliquam fermentum lacus ut tortor tempus, ut pulvinar turpis interdum.'
    ),
    sections: [
      {
        section_number: 1,
        title: 'Coastal Setting',
        body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin tempor massa eget pulvinar placerat.',
      },
    ],
    visibility_status: 'active',
    meta_title: 'Bodrum | CREARE',
    meta_description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Bodrum placeholder metadata for CREARE.',
    order_index: 2,
  },
  {
    name: 'Cappadocia',
    slug: 'cappadocia',
    region: 'Turkey',
    short_description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    intro_text:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. In posuere, lorem non gravida auctor, magna nibh maximus purus, vel venenatis sapien eros sed arcu.',
    highlight: 'Lorem ipsum dolor sit amet.',
    description: blockText(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut eleifend erat id nisi elementum, id molestie arcu tincidunt.'
    ),
    sections: [
      {
        section_number: 1,
        title: 'Landscape',
        body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed sodales purus nec diam faucibus volutpat.',
      },
    ],
    visibility_status: 'active',
    meta_title: 'Cappadocia | CREARE',
    meta_description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cappadocia placeholder metadata for CREARE.',
    order_index: 3,
  },
];

const experienceSeed = [
  {
    title: "Floating Salon d'Opera",
    slug: 'floating-salon-d-opera',
    destination: 'Istanbul',
    category: 'signature',
  },
  {
    title: 'Istanbul Through the Lens',
    slug: 'istanbul-through-the-lens',
    destination: 'Istanbul',
    category: 'signature',
  },
  {
    title: 'Silk Road Istanbul',
    slug: 'silk-road-istanbul',
    destination: 'Istanbul',
    category: 'signature',
  },
  {
    title: 'Open Studio Istanbul',
    slug: 'open-studio-istanbul',
    destination: 'Istanbul',
    category: 'lab',
  },
  {
    title: 'Table to Farm Bodrum',
    slug: 'table-to-farm-bodrum',
    destination: 'Bodrum',
    category: 'signature',
  },
];

const insightSeed = {
  title: 'The Private Life of Istanbul',
  slug: 'private-life-of-istanbul',
  destination: 'Istanbul',
};

const runContentSeed = async (strapi: Core.Strapi) => {
  const destinationService = strapi.documents('api::destination.destination');
  const experienceService = strapi.documents('api::experience.experience');
  const insightService = strapi.documents('api::insight.insight');

  const destinationsByName = new Map<string, any>();

  for (const destination of destinationSeed) {
    const created = await destinationService.create({
      status: 'published',
      data: destination as any,
    });

    destinationsByName.set(destination.name, created);
  }

  const experiencesBySlug = new Map<string, any>();

  for (const experience of experienceSeed) {
    const destination = destinationsByName.get(experience.destination);

    if (!destination) {
      throw new Error(`Missing seeded destination: ${experience.destination}`);
    }

    const created = await experienceService.create({
      status: 'published',
      data: {
        title: experience.title,
        slug: experience.slug,
        short_description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        description: blockText(
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum congue eros eu nibh feugiat, quis tristique velit pharetra.'
        ),
        program: blockText(
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse quis enim ac metus volutpat molestie.'
        ),
        audience: blockText(
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer id urna eu mauris porta luctus.'
        ),
        venue_details: blockText(
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec suscipit finibus arcu, vitae posuere elit dictum sed.'
        ),
        duration: '3 hours',
        group_size: 'Up to 12 guests',
        category: experience.category as 'signature' | 'lab' | 'black',
        cta_text: 'Request This Experience',
        seo_title: `${experience.title} | CREARE`,
        seo_description:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Placeholder SEO description for a CREARE experience.',
        destination: destination.documentId,
      } as any,
    });

    experiencesBySlug.set(experience.slug, created);
  }

  const istanbulDestination = destinationsByName.get(insightSeed.destination);

  if (!istanbulDestination) {
    throw new Error(`Missing seeded destination for insight: ${insightSeed.destination}`);
  }

  await insightService.create({
    status: 'published',
    data: {
      title: insightSeed.title,
      slug: insightSeed.slug,
      excerpt: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      content: blockText(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras luctus nisl et eros sodales, nec aliquet lectus luctus.'
      ),
      seo_title: `${insightSeed.title} | CREARE`,
      seo_description:
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Placeholder SEO description for a CREARE insight.',
      destination: istanbulDestination.documentId,
      experiences: {
        connect: [
          experiencesBySlug.get('floating-salon-d-opera')?.documentId,
          experiencesBySlug.get('istanbul-through-the-lens')?.documentId,
          experiencesBySlug.get('silk-road-istanbul')?.documentId,
        ]
          .filter(Boolean)
          .map((documentId) => ({ documentId })),
      },
    } as any,
  });
};

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    const [destinationCount, experienceCount, insightCount] = await Promise.all([
      strapi.db.query('api::destination.destination').count(),
      strapi.db.query('api::experience.experience').count(),
      strapi.db.query('api::insight.insight').count(),
    ]);

    if (destinationCount > 0 || experienceCount > 0 || insightCount > 0) {
      strapi.log.info(
        `SEED SKIPPED: existing content found (destinations=${destinationCount}, experiences=${experienceCount}, insights=${insightCount}).`
      );
      return;
    }

    strapi.log.info('SEED RUN: creating placeholder CREARE destination, experience, and insight content.');
    await runContentSeed(strapi);
  },
};
