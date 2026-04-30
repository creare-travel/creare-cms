'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const ROOT_DIR = path.resolve(__dirname, '..');
const WORKBOOK_CANDIDATES = [
  path.join(ROOT_DIR, 'CREARE EXPERIENCES - CMS FILE.xlsx'),
  path.join(ROOT_DIR, 'scripts', 'imports', 'CREARE EXPERIENCES - CMS FILE.xlsx'),
];

const FIELD_ALIASES = {
  title: ['title'],
  short_description: ['short description'],
  one_line_hook: [
    'one-line hook',
    'one line hook',
    'one-line hook (description intro)',
    'one line hook description intro',
  ],
  description: [
    'the experience',
    'experience',
    'the experience (main description)',
    'the experience main description',
  ],
  program: ['program'],
  designed_for: ['ideal for (audience)', 'ideal for', 'audience', 'designed for'],
  venue_details: ['venue details'],
  category: ['category'],
  experience_type: ['experience type'],
  destination: ['destination'],
  duration: ['duration'],
  group_size: ['group size'],
  cta_text: ['cta text'],
  cta_label: ['cta label'],
  seo_title: ['seo title'],
  seo_description: ['seo description'],
  location: ['location'],
  experience_flow: [
    'structure / experience flow',
    'experience flow',
    'structure',
    'structure (experience flow)',
  ],
  status: ['status'],
  priority: ['priority'],
  highlights: ['highlights'],
  wow_moment: ['wow moment'],
  differentiator: ['differentiator'],
};

const IMPORTANT_FIELDS = ['title', 'short_description', 'description', 'destination'];

const usage = () => {
  console.log('Usage: node scripts/import-experiences-from-excel.js --dry-run');
  console.log('   or: node scripts/import-experiences-from-excel.js --apply');
};

const normalizeString = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
};

const normalizeLabel = (value) => {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const slugify = (value) => {
  return normalizeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
};

const findWorkbookPath = () => {
  for (const candidate of WORKBOOK_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const toBlocks = (value) => {
  const text = normalizeString(value);

  if (!text) {
    return undefined;
  }

  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return undefined;
  }

  return paragraphs.map((paragraph) => ({
    type: 'paragraph',
    children: [
      {
        type: 'text',
        text: paragraph,
      },
    ],
  }));
};

const resolveFieldKey = (label) => {
  const normalized = normalizeLabel(label);
  let bestMatch = null;

  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeLabel(alias);

      if (!normalizedAlias) {
        continue;
      }

      if (normalizedAlias === normalized) {
        const score = 1000 + normalizedAlias.length;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { key, score };
        }

        continue;
      }

      if (normalized.startsWith(`${normalizedAlias} `) || normalized.endsWith(` ${normalizedAlias}`)) {
        const score = 500 + normalizedAlias.length;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { key, score };
        }
      }
    }
  }

  return bestMatch ? bestMatch.key : null;
};

const parseWorkbook = (workbookPath) => {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('Workbook contains no sheets.');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: '',
    raw: false,
  });

  const parsedRows = [];
  let maxColumns = 0;

  for (const row of rows) {
    const fieldKey = resolveFieldKey(row[0]);

    if (!fieldKey) {
      continue;
    }

    const values = row.slice(1);
    parsedRows.push({ fieldKey, values });
    maxColumns = Math.max(maxColumns, values.length);
  }

  if (parsedRows.length === 0 || maxColumns === 0) {
    throw new Error('No recognizable experience rows were found in the workbook.');
  }

  const experiences = [];

  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    const entry = {};

    for (const row of parsedRows) {
      entry[row.fieldKey] = normalizeString(row.values[columnIndex]);
    }

    const hasAnyValue = Object.values(entry).some((value) => normalizeString(value).length > 0);

    if (hasAnyValue) {
      experiences.push(entry);
    }
  }

  return {
    sheetName: firstSheetName,
    experiences,
  };
};

const normalizeCategory = (value, warnings, titleForLog) => {
  const normalized = normalizeLabel(value);

  if (!normalized) {
    warnings.invalidCategory.push({
      title: titleForLog,
      value,
      normalizedTo: 'signature',
      reason: 'empty',
    });
    return 'signature';
  }

  if (normalized === 'signature' || normalized.includes('signature')) {
    return 'signature';
  }

  if (normalized === 'lab' || normalized.includes('corporate series')) {
    warnings.invalidCategory.push({
      title: titleForLog,
      value,
      normalizedTo: 'lab',
      reason: 'normalized',
    });
    return 'lab';
  }

  if (normalized === 'black' || normalized.includes('black')) {
    return 'black';
  }

  if (normalized.includes('historical series')) {
    warnings.invalidCategory.push({
      title: titleForLog,
      value,
      normalizedTo: 'signature',
      reason: 'normalized',
    });
    return 'signature';
  }

  warnings.invalidCategory.push({
    title: titleForLog,
    value,
    normalizedTo: 'signature',
    reason: 'unrecognized',
  });
  return 'signature';
};

const normalizeStatus = (value, warnings, titleForLog) => {
  const normalized = normalizeLabel(value);

  if (!normalized) {
    warnings.invalidStatus.push({
      title: titleForLog,
      value,
      normalizedTo: 'draft',
      reason: 'empty',
    });
    return 'draft';
  }

  if (normalized === 'active' || normalized === 'ready') {
    if (normalized !== 'active') {
      warnings.invalidStatus.push({
        title: titleForLog,
        value,
        normalizedTo: 'active',
        reason: 'normalized',
      });
    }
    return 'active';
  }

  if (normalized === 'draft' || normalized === 'development') {
    if (normalized !== 'draft') {
      warnings.invalidStatus.push({
        title: titleForLog,
        value,
        normalizedTo: 'draft',
        reason: 'normalized',
      });
    }
    return 'draft';
  }

  if (normalized === 'hidden') {
    return 'hidden';
  }

  warnings.invalidStatus.push({
    title: titleForLog,
    value,
    normalizedTo: 'draft',
    reason: 'unrecognized',
  });
  return 'draft';
};

const normalizeExperienceType = (value, warnings, titleForLog) => {
  const text = normalizeString(value);
  const normalized = normalizeLabel(value);

  if (!normalized) {
    return undefined;
  }

  const matchers = [
    { type: 'team challenge', keywords: ['corporate', 'regatta', 'team', 'competition', 'challenge', 'game'] },
    { type: 'historical', keywords: ['history', 'historical', 'palace', 'empire', 'ottoman'] },
    { type: 'performance', keywords: ['performance', 'opera', 'show', 'music'] },
    { type: 'cultural', keywords: ['culture', 'cultural', 'silk road'] },
    { type: 'workshop', keywords: ['workshop', 'hands', 'craft'] },
    { type: 'culinary', keywords: ['culinary', 'food', 'dining', 'atelier'] },
    { type: 'art', keywords: ['photo', 'lens', 'art', 'atelier', 'studio'] },
    { type: 'narrative', keywords: ['narrative', 'story'] },
  ];

  for (const matcher of matchers) {
    if (matcher.keywords.some((keyword) => normalized.includes(keyword))) {
      if (normalized !== matcher.type) {
        warnings.invalidExperienceType.push({
          title: titleForLog,
          value: text,
          normalizedTo: matcher.type,
          reason: 'normalized',
        });
      }

      return matcher.type;
    }
  }

  warnings.invalidExperienceType.push({
    title: titleForLog,
    value: text,
    normalizedTo: null,
    reason: 'unrecognized',
  });
  return undefined;
};

const parsePriority = (value) => {
  const text = normalizeString(value);

  if (!text) {
    return undefined;
  }

  const parsed = Number.parseInt(text, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildPayload = (raw, warnings) => {
  const title = normalizeString(raw.title);
  const slug = slugify(title);
  const category = normalizeCategory(raw.category, warnings, title || '(missing title)');
  const visibilityStatus = normalizeStatus(raw.status, warnings, title || '(missing title)');
  const experienceType = normalizeExperienceType(
    raw.experience_type,
    warnings,
    title || '(missing title)'
  );
  const destinationInput = normalizeString(raw.destination);

  if (!title) {
    return null;
  }

  const payload = {
    title,
    slug,
    short_description: normalizeString(raw.short_description) || undefined,
    one_line_hook: normalizeString(raw.one_line_hook) || undefined,
    description: toBlocks(raw.description),
    program: toBlocks(raw.program),
    designed_for: toBlocks(raw.designed_for),
    venue_details: toBlocks(raw.venue_details),
    category,
    experience_type: experienceType,
    duration: normalizeString(raw.duration) || undefined,
    group_size: normalizeString(raw.group_size) || undefined,
    cta_text: normalizeString(raw.cta_text) || undefined,
    cta_label: normalizeString(raw.cta_label) || undefined,
    seo_title: normalizeString(raw.seo_title) || undefined,
    seo_description: normalizeString(raw.seo_description) || undefined,
    location: normalizeString(raw.location) || undefined,
    experience_flow: toBlocks(raw.experience_flow),
    visibility_status: visibilityStatus,
    priority: parsePriority(raw.priority),
    highlights: toBlocks(raw.highlights),
    wow_moment: normalizeString(raw.wow_moment) || undefined,
    differentiator: normalizeString(raw.differentiator) || undefined,
    _sourceDestination: destinationInput,
  };

  const emptyFields = IMPORTANT_FIELDS.filter((field) => {
    if (field === 'destination') {
      return !destinationInput;
    }

    const value = payload[field];

    return value === undefined || value === null || value === '';
  });

  if (emptyFields.length > 0) {
    warnings.emptyImportantFields.push({
      title,
      emptyFields,
    });
  }

  return payload;
};

const loadDestinationIndex = async (strapi) => {
  const destinations = await strapi.db.query('api::destination.destination').findMany({
    select: ['id', 'documentId', 'name', 'slug'],
  });

  const bySlug = new Map();
  const byName = new Map();

  for (const destination of destinations) {
    if (destination.slug) {
      bySlug.set(slugify(destination.slug), destination);
    }

    if (destination.name) {
      byName.set(normalizeLabel(destination.name), destination);
    }
  }

  return {
    bySlug,
    byName,
  };
};

const normalizeDestinationLookup = (value) => {
  const normalized = normalizeLabel(value);

  if (!normalized) {
    return '';
  }

  if (normalized.includes('istanbul')) {
    return 'istanbul';
  }

  if (normalized.includes('bodrum')) {
    return 'bodrum';
  }

  if (normalized.includes('cappadocia')) {
    return 'cappadocia';
  }

  return slugify(value);
};

const findDestination = (destinationIndex, input) => {
  const text = normalizeString(input);

  if (!text) {
    return null;
  }

  const normalizedLookup = normalizeDestinationLookup(text);

  return (
    destinationIndex.bySlug.get(normalizedLookup) ||
    destinationIndex.byName.get(normalizeLabel(text)) ||
    null
  );
};

const upsertExperience = async (strapi, existingRecord, payload, destination) => {
  const service = strapi.documents('api::experience.experience');
  const relationPayload = destination ? destination.documentId : undefined;
  const data = {
    title: payload.title,
    slug: payload.slug,
    short_description: payload.short_description,
    one_line_hook: payload.one_line_hook,
    description: payload.description,
    program: payload.program,
    designed_for: payload.designed_for,
    venue_details: payload.venue_details,
    category: payload.category,
    experience_type: payload.experience_type,
    duration: payload.duration,
    group_size: payload.group_size,
    cta_text: payload.cta_text,
    cta_label: payload.cta_label,
    seo_title: payload.seo_title,
    seo_description: payload.seo_description,
    location: payload.location,
    experience_flow: payload.experience_flow,
    visibility_status: payload.visibility_status,
    priority: payload.priority,
    highlights: payload.highlights,
    wow_moment: payload.wow_moment,
    differentiator: payload.differentiator,
    destination: relationPayload,
  };

  let result;

  if (existingRecord?.documentId) {
    result = await service.update({
      documentId: existingRecord.documentId,
      data,
    });
  } else {
    result = await service.create({
      data,
    });
  }

  if (payload.visibility_status === 'active') {
    await service.publish({ documentId: result.documentId });
  } else {
    await service.unpublish({ documentId: result.documentId }).catch(() => undefined);
  }

  return result;
};

const main = async () => {
  const isDryRun = process.argv.includes('--dry-run');
  const isApply = process.argv.includes('--apply');

  if ((isDryRun && isApply) || (!isDryRun && !isApply)) {
    usage();
    process.exit(1);
  }

  const workbookPath = findWorkbookPath();

  if (!workbookPath) {
    throw new Error(
      `Workbook not found. Expected one of: ${WORKBOOK_CANDIDATES.map((candidate) => path.relative(ROOT_DIR, candidate)).join(', ')}`
    );
  }

  const { sheetName, experiences: rawExperiences } = parseWorkbook(workbookPath);
  const warnings = {
    missingTitleRows: [],
    missingDestinations: [],
    emptyImportantFields: [],
    invalidCategory: [],
    invalidStatus: [],
    invalidExperienceType: [],
  };

  const prepared = [];

  for (const rawExperience of rawExperiences) {
    const payload = buildPayload(rawExperience, warnings);

    if (!payload) {
      warnings.missingTitleRows.push(rawExperience);
      continue;
    }

    prepared.push(payload);
  }

  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);

  try {
    await strapi.load();

    const destinationIndex = await loadDestinationIndex(strapi);
    const existingExperiences = await strapi.db.query('api::experience.experience').findMany({
      select: ['id', 'documentId', 'slug', 'title'],
    });
    const existingBySlug = new Map(
      existingExperiences.map((experience) => [slugify(experience.slug || ''), experience])
    );

    const operations = prepared.map((payload) => {
      const destination = findDestination(destinationIndex, payload._sourceDestination);
      const existing = existingBySlug.get(payload.slug) || null;

      if (!destination && payload._sourceDestination) {
        warnings.missingDestinations.push({
          title: payload.title,
          destination: payload._sourceDestination,
        });
      }

      return {
        mode: existing ? 'update' : 'create',
        payload,
        existing,
        destination,
      };
    });

    const summary = {
      workbook: path.relative(ROOT_DIR, workbookPath),
      sheetName,
      totalExperiencesFound: rawExperiences.length,
      validExperiences: prepared.length,
      toCreate: operations.filter((operation) => operation.mode === 'create').length,
      toUpdate: operations.filter((operation) => operation.mode === 'update').length,
      missingTitleRows: warnings.missingTitleRows.length,
      missingDestinationMatches: warnings.missingDestinations.length,
      emptyImportantFields: warnings.emptyImportantFields.length,
      invalidCategoryValues: warnings.invalidCategory.length,
      invalidStatusValues: warnings.invalidStatus.length,
      invalidExperienceTypeValues: warnings.invalidExperienceType.length,
      mode: isDryRun ? 'dry-run' : 'apply',
    };

    console.log(JSON.stringify(summary, null, 2));

    if (warnings.missingDestinations.length > 0) {
      console.warn('Missing destination matches:', warnings.missingDestinations);
    }

    if (warnings.emptyImportantFields.length > 0) {
      console.warn('Empty important fields:', warnings.emptyImportantFields);
    }

    if (warnings.invalidCategory.length > 0) {
      console.warn('Category normalization warnings:', warnings.invalidCategory);
    }

    if (warnings.invalidStatus.length > 0) {
      console.warn('Status normalization warnings:', warnings.invalidStatus);
    }

    if (warnings.invalidExperienceType.length > 0) {
      console.warn('Experience type normalization warnings:', warnings.invalidExperienceType);
    }

    if (warnings.missingTitleRows.length > 0) {
      console.warn('Missing title rows:', warnings.missingTitleRows.length);
    }

    if (isDryRun) {
      return;
    }

    for (const operation of operations) {
      await upsertExperience(strapi, operation.existing, operation.payload, operation.destination);
      console.log(`${operation.mode.toUpperCase()}: ${operation.payload.title}`);
    }
  } finally {
    await strapi.destroy();
  }
};

main().catch((error) => {
  console.error('Import failed:', error.message);
  process.exit(1);
});
