type LifecycleEvent = {
  params: {
    data?: Record<string, unknown>;
    where?: Record<string, unknown>;
  };
};

const EXPERIENCE_UID = 'api::experience.experience';

const normalizeString = (value: unknown) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
};

const slugify = (value: unknown) => {
  return normalizeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
};

const resolveExistingSlug = async (where?: Record<string, unknown>) => {
  if (!where) {
    return null;
  }

  const queryWhere: Record<string, unknown> = {};

  if (where.id) {
    queryWhere.id = where.id;
  } else if (where.documentId) {
    queryWhere.documentId = where.documentId;
  } else {
    return null;
  }

  const existing = await strapi.db.query(EXPERIENCE_UID).findOne({
    where: queryWhere,
    select: ['slug'],
  });

  return normalizeString(existing?.slug) || null;
};

const ensureCreateSlug = (data?: Record<string, unknown>) => {
  if (!data) {
    return;
  }

  if (!normalizeString(data.slug) && normalizeString(data.title)) {
    data.slug = slugify(data.title);
  }
};

export default {
  async beforeCreate(event: LifecycleEvent) {
    ensureCreateSlug(event.params.data);
  },

  async beforeUpdate(event: LifecycleEvent) {
    const data = event.params.data;

    if (!data) {
      return;
    }

    // Slugs are immutable after first creation to protect SEO, links, and JSON-LD canonical URLs.
    const existingSlug = await resolveExistingSlug(event.params.where);

    if (existingSlug) {
      data.slug = existingSlug;
      return;
    }

    ensureCreateSlug(data);
  },
};
