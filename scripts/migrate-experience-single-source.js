"use strict";

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT_DIR = path.resolve(__dirname, "..");
const PAYLOAD_PATH = path.join(
  ROOT_DIR,
  "src",
  "migrations",
  "experience-single-source-v1.json",
);
const EXPECTED = {
  projectId: "a4539684-c08f-4ea4-9f0c-aaa1f0c0b682",
  environmentId: "a03e18cb-f063-41ed-ac0b-e46f419d63d5",
  cmsServiceId: "fe9a558d-bba4-4cf7-8d48-3ca3c99e635a",
  sourceDeploymentSha: "672d643400723dea711a7587cbbdfadf3520555c",
  locales: ["en", "tr-TR", "zh-CN"],
  experienceFamilies: 14,
  experienceLocalizations: 42,
  mediaAssets: 4,
};

const TARGET_EXPERIENCE_COLUMNS = [
  "group_size_note",
  "programme_note",
  "cta_heading",
  "cta_supporting_text",
  "cta_access_line",
  "og_description",
  "hero_alt_text",
];

const FIELD_LIMITS = {
  title: 160,
  short_description: 700,
  group_size_note: 280,
  programme_note: 500,
  cta_heading: 180,
  cta_supporting_text: 500,
  cta_access_line: 180,
  cta_label: 120,
  og_description: 300,
  hero_alt_text: 300,
  one_line_hook: 500,
};

const PROHIBITED_BLACK_CLAIMS = [
  "by invitation",
  "invitation-only",
  "not publicly listed",
  "never listed",
  "selected work remains unseen",
  "after-hours access",
  "closed collections",
  "guaranteed private venues",
  "referral-based qualification",
  "referral-based access",
  "confidential delivery",
  "confidential execution",
  "access is not open",
  "access is guaranteed",
];

const EXPECTED_TITLE_REPLACEMENTS = {
  "İpek Yolu: İstanbul™": "Silk Road Istanbul™",
  "İmparatorluk Lezzetleri™ — Mutfak Atölyesi":
    "Imperial Flavors™ — Culinary Atelier",
  "Kokteyl Atölyesi™ — Karıştır, Hareket Et, Bağ Kur":
    "Cocktail Atelier™ — Mix, Move, Connect",
  "Beylerbeyi 1869™ — İmparatorluğun Kırılma Anı":
    "Beylerbeyi 1869™ — Empire, Interrupted",
  "Performansın İzinde™": "Driven by Performance™",
};

const PROTECTED_OLD_NAME_PATTERNS = [
  {
    obsolete: "İpek Yolu: İstanbul™",
    pattern: /İpek Yolu:\s*İstanbul(?:\s*™)?/u,
  },
  {
    obsolete: "İmparatorluk Lezzetleri™ — Mutfak Atölyesi",
    pattern: /İmparatorluk Lezzetleri(?:\s*™)?\s*-\s*Mutfak Atölyesi/u,
  },
  {
    obsolete: "Kokteyl Atölyesi™ — Karıştır, Hareket Et, Bağ Kur",
    pattern:
      /Kokteyl Atölyesi(?:\s*™)?\s*-\s*Karıştır,\s*Hareket Et,\s*Bağ Kur/u,
  },
  {
    obsolete: "Beylerbeyi 1869™ — İmparatorluğun Kırılma Anı",
    pattern: /Beylerbeyi 1869(?:\s*™)?\s*-\s*İmparatorluğun Kırılma Anı/u,
  },
  {
    obsolete: "Performansın İzinde™",
    pattern: /Performansın İzinde(?:\s*™)?/u,
  },
];

const CMS_DESTINATION_FIELDS = [
  "title",
  "short_description",
  "description",
  "program",
  "highlights",
  "experience_flow",
  "audience",
  "designed_for",
  "ideal_guest",
  "duration",
  "group_size",
  "location",
  "venue_details",
  "group_size_note",
  "programme_note",
  "cta_heading",
  "cta_supporting_text",
  "cta_access_line",
  "cta_label",
  "cta_text",
  "one_line_hook",
  "seo_title",
  "seo_description",
  "og_description",
  "hero_alt_text",
  "cover_image",
  "gallery",
  "category",
  "series",
  "experience_type",
  "geo_experience_type",
  "mood",
  "intensity",
  "audience_segment",
  "intent_level",
  "priority",
  "visibility_status",
  "destination",
  "related_experiences",
  "related_insights",
];

const FRONTEND_SUPPLEMENT_DESTINATIONS = {
  expectedTitle: "title",
  expectedCategory: "category",
  shortDescription: "short_description",
  groupSizeNote: "group_size_note",
  programmeNote: "programme_note",
  ctaHeading: "cta_heading",
  ctaSupportingText: "cta_supporting_text",
  ctaAccessLine: "cta_access_line",
  openGraphDescription: "og_description",
  heroAltText: "hero_alt_text",
};

const PAYLOAD_SUPPLEMENT_FIELDS = Object.values(
  FRONTEND_SUPPLEMENT_DESTINATIONS,
).filter((field) => field !== "category");

const EXPECTED_CATEGORY_BY_SLUG = {
  "silk-road-istanbul": "signature",
  "istanbul-through-the-lens": "signature",
  "floating-salon-d-opera": "signature",
  "culinary-arena-bodrum": "signature",
  "the-salon-of-hands": "signature",
  "golden-horn-regatta": "signature",
  "princes-islands-regatta": "lab",
  "the-studio-session": "lab",
  "bodrum-beach-games-rhythm-competition-celebration": "lab",
  "table-to-farm-bodrum": "signature",
  "cocktail-atelier-mix-move-connect": "signature",
  "imperial-flavors-culinary-atelier": "signature",
  "driven-by-performance": "signature",
  "beylerbeyi-1869-empire-interrupted": "signature",
};

const KNOWN_PROTECTED_FIELD_CORRECTIONS = [
  {
    slug: "silk-road-istanbul",
    fieldPath: "cta_heading",
    expected: "Silk Road Istanbul™ Deneyimini Rezerve Edin",
  },
  {
    slug: "imperial-flavors-culinary-atelier",
    fieldPath: "cta_heading",
    expected: "Imperial Flavors™ — Culinary Atelier için Özel Talep",
  },
  {
    slug: "cocktail-atelier-mix-move-connect",
    fieldPath: "cta_heading",
    expected: "Cocktail Atelier™ — Mix, Move, Connect Deneyimini Planlayın",
  },
  {
    slug: "beylerbeyi-1869-empire-interrupted",
    fieldPath: "cta_heading",
    expected: "Beylerbeyi 1869™ — Empire, Interrupted Deneyimini Rezerve Edin",
  },
  {
    slug: "driven-by-performance",
    fieldPath: "cta_heading",
    expected: "Driven by Performance™ için Özel Talep",
  },
  {
    slug: "silk-road-istanbul",
    fieldPath: "differentiator",
    expected:
      "Silk Road Istanbul™, klasik şehir turlarından farklı olarak Çin mirasını, Osmanlı tarihini, seramikleri, ticaret hafızasını ve tarihî mekânları tek bir kültürel süreklilik anlatısı içinde birleştirir.",
  },
  {
    slug: "driven-by-performance",
    fieldPath: "description.1.children.0.text",
    expected:
      "Driven by Performance™, kurumsal takımları tamamen kendilerine ayrılmış profesyonel bir yarış pistinde; kontrol, reaksiyon, hassasiyet ve zamanlama etrafında tasarlanmış uygulamalı bir motor sporları programında buluşturur.",
  },
  {
    slug: "driven-by-performance",
    fieldPath: "seo_title",
    expected: "Driven by Performance™ | İstanbul Özel Pist Deneyimi | CREARE",
  },
  {
    slug: "beylerbeyi-1869-empire-interrupted",
    fieldPath: "description.1.children.0.text",
    expected:
      "Beylerbeyi 1869™ — Empire, Interrupted, sarayın devlet misafirliği, temsil ve diplomasiyle biçimlenen 1869 dünyasını; Sultan Abdülaziz, İmparatoriçe Eugénie, Pertevniyal Valide Sultan ve Kont Nikolay İgnatyev’in perspektifleri üzerinden yorumlar.",
  },
];

const DERIVED_RELATION_FIELDS = new Set([
  "cover_image",
  "destination",
  "gallery",
  "inquiries",
  "insights",
  "localizations",
  "related_experiences",
  "related_insights",
]);

function usage() {
  console.log("Dry run:");
  console.log(
    "  npm run migrate:experience-single-source -- --dry-run --backup-dir=/absolute/backup/path",
  );
  console.log("Apply (only after schema deployment and owner approval):");
  console.log(
    "  npm run migrate:experience-single-source -- --apply --backup-dir=/absolute/backup/path --expected-deployment-sha=<sha> --confirm-production=CREARE_EXPERIENCE_SINGLE_SOURCE_V1",
  );
}

function parseArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg === "--dry-run")
      options.mode = options.mode ? "invalid" : "dry-run";
    else if (arg === "--apply")
      options.mode = options.mode ? "invalid" : "apply";
    else if (arg.startsWith("--backup-dir="))
      options.backupDir = arg.slice("--backup-dir=".length);
    else if (arg.startsWith("--expected-deployment-sha=")) {
      options.expectedDeploymentSha = arg.slice(
        "--expected-deployment-sha=".length,
      );
    } else if (arg.startsWith("--confirm-production=")) {
      options.confirmProduction = arg.slice("--confirm-production=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["dry-run", "apply"].includes(options.mode) || !options.backupDir) {
    usage();
    throw new Error("Choose exactly one mode and provide --backup-dir.");
  }

  return options;
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function verifyBackup(backupDir) {
  const manifestPath = path.join(backupDir, "SHA256SUMS");
  if (!fs.existsSync(manifestPath))
    throw new Error(`Backup manifest not found: ${manifestPath}`);

  const entries = fs
    .readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!match) throw new Error(`Invalid SHA256SUMS entry: ${line}`);
      const filePath = path.isAbsolute(match[2])
        ? match[2]
        : path.join(backupDir, match[2]);
      if (!fs.existsSync(filePath))
        throw new Error(`Backup file missing: ${filePath}`);
      const actual = sha256(filePath);
      if (actual !== match[1].toLowerCase())
        throw new Error(`Backup checksum mismatch: ${filePath}`);
      return { file: path.relative(backupDir, filePath), sha256: actual };
    });

  const snapshotCounts = {};
  for (const locale of EXPECTED.locales) {
    for (const status of ["draft", "published"]) {
      const file = path.join(
        backupDir,
        "cms",
        `experiences-${locale}-${status}.json`,
      );
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      snapshotCounts[`${locale}:${status}`] = Array.isArray(parsed.data)
        ? parsed.data.length
        : null;
    }
  }

  return { manifestPath, filesVerified: entries.length, snapshotCounts };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeProtectedComparison(value) {
  return value
    .normalize("NFC")
    .replace(/[’‘‛`´]/gu, "'")
    .replace(/\s*'\s*/gu, "'")
    .replace(/[‐‑‒–—−]/gu, "-")
    .replace(/\s*-\s*/gu, " - ")
    .replace(/\s+/gu, " ")
    .trim();
}

function findProtectedNameMatches(
  value,
  { documentFamily, locale, fieldPath = "" },
  matches = [],
) {
  if (typeof value === "string") {
    const normalized = normalizeProtectedComparison(value);
    for (const specification of PROTECTED_OLD_NAME_PATTERNS) {
      const match = normalized.match(specification.pattern);
      if (match) {
        matches.push({
          documentFamily,
          locale,
          fieldPath,
          matchedObsoleteValue: specification.obsolete,
          matchedText: match[0],
        });
      }
    }
    return matches;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findProtectedNameMatches(
        item,
        {
          documentFamily,
          locale,
          fieldPath: fieldPath ? `${fieldPath}.${index}` : String(index),
        },
        matches,
      );
    });
    return matches;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      findProtectedNameMatches(
        nestedValue,
        {
          documentFamily,
          locale,
          fieldPath: fieldPath ? `${fieldPath}.${key}` : key,
        },
        matches,
      );
    }
  }

  return matches;
}

function getValueAtPath(value, fieldPath) {
  return fieldPath.split(".").reduce((current, segment) => {
    if (current === null || current === undefined) return undefined;
    return current[segment];
  }, value);
}

function buildProjectedExperienceRecord(source, payloadRecord) {
  const sourceCopy = cloneJson(source);
  delete sourceCopy.localizations;

  return {
    ...sourceCopy,
    ...cloneJson(payloadRecord.fields),
    slug: source.slug,
    documentId: source.documentId,
    locale: source.locale,
  };
}

function loadBackupExperienceDrafts(backupDir, locale) {
  const snapshotPath = path.join(
    backupDir,
    "cms",
    `experiences-${locale}-draft.json`,
  );
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  if (!Array.isArray(snapshot.data)) {
    throw new Error(`Invalid Experience backup snapshot: ${snapshotPath}`);
  }
  return snapshot.data;
}

function buildProjectedCmsState(payload, backupDir) {
  const experiences = [];

  for (const locale of EXPECTED.locales) {
    const sourceByDocumentId = new Map(
      loadBackupExperienceDrafts(backupDir, locale).map((record) => [
        record.documentId,
        record,
      ]),
    );

    for (const payloadRecord of payload.records.filter(
      (record) => record.locale === locale,
    )) {
      const source = sourceByDocumentId.get(payloadRecord.documentId);
      if (!source) {
        throw new Error(
          `Backup is missing ${payloadRecord.documentId}:${locale}.`,
        );
      }
      experiences.push({
        kind: "experience",
        documentFamily: payloadRecord.documentId,
        locale,
        slug: source.slug,
        expectedSlug: payloadRecord.slug,
        before: cloneJson(source),
        after: buildProjectedExperienceRecord(source, payloadRecord),
      });
    }
  }

  const landing = EXPECTED.locales.map((locale) => ({
    kind: "experience-landing",
    documentFamily: "experience-landing",
    locale,
    slug: null,
    expectedSlug: null,
    before: null,
    after: cloneJson(payload.landing[locale]),
  }));

  const categories = Object.entries(payload.categories).flatMap(
    ([key, category]) =>
      EXPECTED.locales.map((locale) => ({
        kind: "experience-category-page",
        documentFamily: key,
        locale,
        slug: null,
        expectedSlug: null,
        before: null,
        after: {
          key,
          display_order: category.display_order,
          ...cloneJson(category.locales[locale]),
        },
      })),
  );

  return { experiences, landing, categories };
}

function directCmsContent(record) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([field]) =>
        !DERIVED_RELATION_FIELDS.has(field) &&
        ![
          "createdAt",
          "documentId",
          "id",
          "locale",
          "publishedAt",
          "updatedAt",
        ].includes(field),
    ),
  );
}

function validateProjectedCmsState(projectedState, payload) {
  const blockers = [];
  const protectedOldNameMatches = [];
  const cmsDestinationMissing = [];
  const slugMismatches = [];

  for (const entry of [
    ...projectedState.experiences,
    ...projectedState.landing,
    ...projectedState.categories,
  ]) {
    if (entry.locale !== "tr-TR") continue;
    findProtectedNameMatches(
      directCmsContent(entry.after),
      {
        documentFamily: entry.documentFamily,
        locale: entry.locale,
      },
      protectedOldNameMatches,
    );
  }

  for (const entry of projectedState.experiences) {
    if (entry.slug !== entry.expectedSlug) {
      slugMismatches.push({
        documentFamily: entry.documentFamily,
        locale: entry.locale,
        existing: entry.slug,
        expected: entry.expectedSlug,
      });
    }

    for (const field of CMS_DESTINATION_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(entry.after, field)) {
        cmsDestinationMissing.push({
          documentFamily: entry.documentFamily,
          locale: entry.locale,
          slug: entry.slug,
          field,
        });
      }
    }
  }

  for (const record of payload.records) {
    for (const field of PAYLOAD_SUPPLEMENT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(record.fields, field)) {
        cmsDestinationMissing.push({
          documentFamily: record.documentId,
          locale: record.locale,
          slug: record.slug,
          field,
          source: "frontend-supplement",
        });
      }
    }
  }

  const categoryMismatches = projectedState.experiences
    .filter(
      (entry) => entry.after.category !== EXPECTED_CATEGORY_BY_SLUG[entry.slug],
    )
    .map((entry) => ({
      documentFamily: entry.documentFamily,
      locale: entry.locale,
      slug: entry.slug,
      expected: EXPECTED_CATEGORY_BY_SLUG[entry.slug],
      actual: entry.after.category,
    }));

  const knownFieldCorrections = KNOWN_PROTECTED_FIELD_CORRECTIONS.map(
    (correction) => {
      const entry = projectedState.experiences.find(
        (candidate) =>
          candidate.locale === "tr-TR" && candidate.slug === correction.slug,
      );
      return {
        ...correction,
        before: entry
          ? getValueAtPath(entry.before, correction.fieldPath)
          : undefined,
        after: entry
          ? getValueAtPath(entry.after, correction.fieldPath)
          : undefined,
        matchesExpected:
          Boolean(entry) &&
          getValueAtPath(entry.after, correction.fieldPath) ===
            correction.expected,
      };
    },
  );
  const knownCorrectionFailures = knownFieldCorrections.filter(
    (correction) => !correction.matchesExpected,
  );

  if (protectedOldNameMatches.length > 0) {
    blockers.push(
      `${protectedOldNameMatches.length} protected old-name occurrence(s) remain in projected TR CMS content.`,
    );
  }
  if (cmsDestinationMissing.length > 0) {
    blockers.push(
      `${cmsDestinationMissing.length} CMS destination field(s) are missing from projected Experience content.`,
    );
  }
  if (slugMismatches.length > 0) {
    blockers.push(
      `${slugMismatches.length} projected Experience slug mismatch(es) detected.`,
    );
  }
  if (categoryMismatches.length > 0) {
    blockers.push(
      `${categoryMismatches.length} projected Experience category mismatch(es) detected.`,
    );
  }
  if (knownCorrectionFailures.length > 0) {
    blockers.push(
      `${knownCorrectionFailures.length} known protected-title field correction(s) do not match the reviewed payload.`,
    );
  }

  return {
    blockers,
    protectedOldNameMatches,
    protectedOldNameMatchCount: protectedOldNameMatches.length,
    cmsDestinationCoverage: {
      requiredFields: CMS_DESTINATION_FIELDS,
      frontendSupplementDestinations: FRONTEND_SUPPLEMENT_DESTINATIONS,
      missing: cmsDestinationMissing,
      blockers: cmsDestinationMissing.length,
    },
    slugMismatches,
    categoryMismatches,
    knownFieldCorrections,
    knownCorrectionFailures,
  };
}

function assertPreflightReady(...validations) {
  const blockers = validations.flatMap((validation) => validation.blockers);
  if (blockers.length > 0) {
    throw new Error(`Migration preflight blockers: ${blockers.join(" | ")}`);
  }
}

function loadPayload() {
  const payload = JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
  if (payload.version !== 1)
    throw new Error(`Unsupported payload version: ${payload.version}`);
  return payload;
}

function validatePayload(payload) {
  const blockers = [];
  const warnings = [];
  const records = payload.records || [];
  const locales = [...new Set(records.map((record) => record.locale))].sort();
  const documentIds = [
    ...new Set(records.map((record) => record.documentId)),
  ].sort();
  const identities = new Set();

  if (records.length !== EXPECTED.experienceLocalizations) {
    blockers.push(
      `Expected ${EXPECTED.experienceLocalizations} Experience records, found ${records.length}.`,
    );
  }
  if (documentIds.length !== EXPECTED.experienceFamilies) {
    blockers.push(
      `Expected ${EXPECTED.experienceFamilies} Experience families, found ${documentIds.length}.`,
    );
  }
  if (
    JSON.stringify(locales) !== JSON.stringify([...EXPECTED.locales].sort())
  ) {
    blockers.push(`Unexpected locale inventory: ${locales.join(", ")}`);
  }
  if (records.some((record) => record.locale === "ru"))
    blockers.push("RU payload is forbidden.");

  for (const record of records) {
    const identity = `${record.documentId}:${record.locale}`;
    if (identities.has(identity))
      blockers.push(`Duplicate payload identity: ${identity}`);
    identities.add(identity);

    if (!record.slug || !record.fields?.title)
      blockers.push(`Missing slug/title for ${identity}`);
    for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
      const value = record.fields?.[field];
      if (typeof value === "string" && value.length > limit) {
        blockers.push(
          `${identity} ${field} exceeds ${limit} characters (${value.length}).`,
        );
      }
    }
  }

  for (const documentId of documentIds) {
    const family = records.filter((record) => record.documentId === documentId);
    const titleSet = new Set(family.map((record) => record.fields.title));
    const slugSet = new Set(family.map((record) => record.slug));
    if (family.length !== EXPECTED.locales.length)
      blockers.push(`${documentId} does not have 3 locales.`);
    if (titleSet.size !== 1)
      blockers.push(`${documentId} title is not shared across locales.`);
    if (slugSet.size !== 1)
      blockers.push(`${documentId} slug is not shared across locales.`);
  }

  if ((payload.media || []).length !== EXPECTED.mediaAssets) {
    blockers.push(
      `Expected ${EXPECTED.mediaAssets} media assets, found ${(payload.media || []).length}.`,
    );
  }

  const landingLocales = Object.keys(payload.landing || {}).sort();
  if (
    JSON.stringify(landingLocales) !==
    JSON.stringify([...EXPECTED.locales].sort())
  ) {
    blockers.push(
      `Landing locale inventory is invalid: ${landingLocales.join(", ")}`,
    );
  }

  const categoryKeys = Object.keys(payload.categories || {}).sort();
  if (
    JSON.stringify(categoryKeys) !==
    JSON.stringify(["black", "lab", "signature"])
  ) {
    blockers.push(`Category inventory is invalid: ${categoryKeys.join(", ")}`);
  }

  const blackText = JSON.stringify(
    payload.categories?.black || {},
  ).toLowerCase();
  const prohibitedMatches = PROHIBITED_BLACK_CLAIMS.filter((claim) =>
    blackText.includes(claim),
  );
  if (prohibitedMatches.length > 0)
    blockers.push(`BLACK prohibited claims: ${prohibitedMatches.join(", ")}`);

  for (const [obsolete, replacement] of Object.entries(
    EXPECTED_TITLE_REPLACEMENTS,
  )) {
    if (payload.titleReplacements?.[obsolete] !== replacement) {
      blockers.push(
        `Title replacement assertion is missing or incorrect: ${obsolete} -> ${replacement}.`,
      );
    }
  }

  return {
    blockers,
    warnings,
    counts: {
      records: records.length,
      documentFamilies: documentIds.length,
      locales,
      landingLocalizations: landingLocales.length,
      categoryFamilies: categoryKeys.length,
      categoryLocalizations: categoryKeys.length * EXPECTED.locales.length,
      mediaAssets: (payload.media || []).length,
    },
    prohibitedMatches,
  };
}

function getConnectionString() {
  return process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [tableName],
  );
  return result.rows.map((row) => row.column_name);
}

async function tableExists(client, tableName) {
  const result = await client.query("SELECT to_regclass($1) AS table_name", [
    `public.${tableName}`,
  ]);
  return Boolean(result.rows[0]?.table_name);
}

function normalizeComparable(value) {
  if (value === undefined) return null;
  return value;
}

async function inspectProduction(client, payload) {
  const experienceColumns = await getTableColumns(client, "experiences");
  const selectedColumns = [
    "id",
    "document_id",
    "locale",
    "slug",
    "published_at",
    "title",
    "short_description",
    "one_line_hook",
    "cta_label",
    "seo_title",
    "seo_description",
    ...TARGET_EXPERIENCE_COLUMNS,
  ].filter((column) => experienceColumns.includes(column));

  const experienceResult = await client.query(
    `SELECT ${selectedColumns.map((column) => `"${column}"`).join(", ")}
     FROM experiences ORDER BY document_id, locale, published_at NULLS FIRST`,
  );
  const currentRows = experienceResult.rows;
  const currentByIdentity = new Map();
  for (const row of currentRows) {
    const status = row.published_at ? "published" : "draft";
    currentByIdentity.set(`${row.document_id}:${row.locale}:${status}`, row);
  }

  const missingIdentities = [];
  const slugMismatches = [];
  const titleChanges = [];
  let experienceUpdates = 0;
  let publications = 0;

  for (const record of payload.records) {
    const draft = currentByIdentity.get(
      `${record.documentId}:${record.locale}:draft`,
    );
    const published = currentByIdentity.get(
      `${record.documentId}:${record.locale}:published`,
    );
    if (!draft || !published) {
      missingIdentities.push({
        documentId: record.documentId,
        locale: record.locale,
        draft: Boolean(draft),
        published: Boolean(published),
      });
      continue;
    }
    if (draft.slug !== record.slug || published.slug !== record.slug) {
      slugMismatches.push({
        documentId: record.documentId,
        locale: record.locale,
        expected: record.slug,
        draft: draft.slug,
        published: published.slug,
      });
    }

    const existingTitle = draft.title;
    if (existingTitle !== record.fields.title) {
      titleChanges.push({
        documentId: record.documentId,
        locale: record.locale,
        from: existingTitle,
        to: record.fields.title,
      });
    }

    const hasMissingColumns = TARGET_EXPERIENCE_COLUMNS.some(
      (column) => !experienceColumns.includes(column),
    );
    const changedExistingField = Object.entries(record.fields).some(
      ([field, expected]) => {
        const column = field.replace(
          /[A-Z]/g,
          (letter) => `_${letter.toLowerCase()}`,
        );
        return (
          experienceColumns.includes(column) &&
          normalizeComparable(draft[column]) !== normalizeComparable(expected)
        );
      },
    );
    if (hasMissingColumns || changedExistingField) {
      experienceUpdates += 1;
      publications += 1;
    }
  }

  const filesResult = await client.query(
    "SELECT id, url, provider, provider_metadata FROM files ORDER BY id",
  );
  const mediaState = payload.media.map((asset) => {
    const matches = filesResult.rows.filter((file) => {
      const metadata = file.provider_metadata || {};
      return (
        file.url === asset.url ||
        metadata.public_id === asset.public_id ||
        metadata.asset_id === asset.asset_id
      );
    });
    return {
      key: asset.key,
      publicId: asset.public_id,
      matchingStrapiRows: matches.map((file) => file.id),
    };
  });

  const localeStatusCounts = {};
  for (const locale of EXPECTED.locales) {
    localeStatusCounts[locale] = {
      draft: currentRows.filter(
        (row) => row.locale === locale && !row.published_at,
      ).length,
      published: currentRows.filter(
        (row) => row.locale === locale && row.published_at,
      ).length,
    };
  }

  return {
    database: {
      experienceRows: currentRows.length,
      experienceFamilies: new Set(currentRows.map((row) => row.document_id))
        .size,
      mediaRows: filesResult.rows.length,
      localeStatusCounts,
      targetExperienceColumnsPresent: TARGET_EXPERIENCE_COLUMNS.filter(
        (column) => experienceColumns.includes(column),
      ),
      targetExperienceColumnsMissing: TARGET_EXPERIENCE_COLUMNS.filter(
        (column) => !experienceColumns.includes(column),
      ),
      experienceLandingTablePresent: await tableExists(
        client,
        "experience_landings",
      ),
      experienceCategoryTablePresent: await tableExists(
        client,
        "experience_category_pages",
      ),
    },
    integrity: { missingIdentities, slugMismatches },
    projected: {
      experienceDraftUpdates: experienceUpdates,
      experiencePublications: publications,
      titleChanges,
      landingLocalizationsToCreateOrUpdate: EXPECTED.locales.length,
      categoryLocalizationsToCreateOrUpdate: 3 * EXPECTED.locales.length,
      mediaRegistrations: mediaState.filter(
        (asset) => asset.matchingStrapiRows.length === 0,
      ).length,
      mediaState,
    },
  };
}

async function runDryRun(
  options,
  payload,
  payloadValidation,
  projectedValidation,
  backup,
) {
  const connectionString = getConnectionString();
  if (!connectionString)
    throw new Error("DATABASE_PUBLIC_URL or DATABASE_URL is required.");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const identity = await client.query(
      `SELECT current_database() AS database, current_schema() AS schema,
              current_user AS db_user, current_setting('transaction_read_only') AS transaction_read_only,
              version() AS version`,
    );
    const production = await inspectProduction(client, payload);
    await client.query("ROLLBACK");

    const blockers = [
      ...payloadValidation.blockers,
      ...projectedValidation.blockers,
    ];
    if (production.database.experienceRows !== 84)
      blockers.push(
        `Production Experience row count is ${production.database.experienceRows}, expected 84.`,
      );
    if (production.database.experienceFamilies !== 14)
      blockers.push(
        `Production Experience family count is ${production.database.experienceFamilies}, expected 14.`,
      );
    if (production.integrity.missingIdentities.length > 0)
      blockers.push(
        "One or more required draft/published identities are missing.",
      );
    if (production.integrity.slugMismatches.length > 0)
      blockers.push("One or more frozen slugs differ from the payload.");

    const report = {
      migration: "experience-single-source-v1",
      mode: "DRY RUN",
      writeAttempted: false,
      transaction: identity.rows[0],
      railwayContext: {
        projectId: process.env.RAILWAY_PROJECT_ID || null,
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID || null,
        environmentName: process.env.RAILWAY_ENVIRONMENT_NAME || null,
        serviceId: process.env.RAILWAY_SERVICE_ID || null,
        serviceName: process.env.RAILWAY_SERVICE_NAME || null,
      },
      backup,
      payload: payloadValidation,
      projectedCms: projectedValidation,
      production,
      expectedApplyGuard: {
        projectId: EXPECTED.projectId,
        environmentId: EXPECTED.environmentId,
        cmsServiceId: EXPECTED.cmsServiceId,
        schemaMustAlreadyBeDeployed: true,
        explicitConfirmation: "CREARE_EXPERIENCE_SINGLE_SOURCE_V1",
      },
      blockers,
      readyForApplyAuthorization: blockers.length === 0,
    };

    console.log(JSON.stringify(report, null, 2));
    if (blockers.length > 0) process.exitCode = 2;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

function assertApplyGuards(options) {
  if (options.confirmProduction !== "CREARE_EXPERIENCE_SINGLE_SOURCE_V1") {
    throw new Error("Apply confirmation is missing or invalid.");
  }
  if (!/^[a-f0-9]{40}$/.test(options.expectedDeploymentSha || "")) {
    throw new Error(
      "--expected-deployment-sha must be a full 40-character Git SHA.",
    );
  }
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  }).trim();
  if (checkoutSha !== options.expectedDeploymentSha) {
    throw new Error(
      `Checkout SHA ${checkoutSha} does not match --expected-deployment-sha.`,
    );
  }
  if (process.env.RAILWAY_PROJECT_ID !== EXPECTED.projectId)
    throw new Error("Wrong Railway project.");
  if (process.env.RAILWAY_ENVIRONMENT_ID !== EXPECTED.environmentId)
    throw new Error("Wrong Railway environment.");
  if (process.env.RAILWAY_SERVICE_ID !== EXPECTED.cmsServiceId)
    throw new Error(
      "Apply must run with the creare-cms Railway service context.",
    );
}

async function assertApplySchema() {
  const connectionString = getConnectionString();
  if (!connectionString)
    throw new Error("DATABASE_PUBLIC_URL or DATABASE_URL is required.");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const columns = await getTableColumns(client, "experiences");
    const missingColumns = TARGET_EXPERIENCE_COLUMNS.filter(
      (column) => !columns.includes(column),
    );
    const landingPresent = await tableExists(client, "experience_landings");
    const categoriesPresent = await tableExists(
      client,
      "experience_category_pages",
    );
    await client.query("ROLLBACK");
    if (missingColumns.length > 0 || !landingPresent || !categoriesPresent) {
      throw new Error(
        `Refusing apply before schema deployment. Missing columns: ${missingColumns.join(", ") || "none"}; landing table: ${landingPresent}; category table: ${categoriesPresent}.`,
      );
    }
  } finally {
    await client.end();
  }
}

function valuesMatch(record, desired) {
  return Object.entries(desired).every(([key, value]) => {
    if (key === "hero_image" || key === "card_image") {
      const current = record?.[key];
      const currentId = Array.isArray(current)
        ? current[0]?.id
        : (current?.id ?? current);
      return currentId === value;
    }
    return normalizeComparable(record?.[key]) === normalizeComparable(value);
  });
}

async function ensureMediaRecords(strapi, mediaAssets) {
  const existing = await strapi.db.query("plugin::upload.file").findMany({});
  const result = {};

  for (const asset of mediaAssets) {
    const matches = existing.filter((file) => {
      const metadata = file.provider_metadata || {};
      return (
        file.url === asset.url ||
        metadata.public_id === asset.public_id ||
        metadata.asset_id === asset.asset_id
      );
    });
    if (matches.length > 1)
      throw new Error(`Duplicate Strapi media rows for ${asset.public_id}.`);

    let file = matches[0];
    if (!file) {
      file = await strapi.db.query("plugin::upload.file").create({
        data: {
          name: `${asset.public_id}.${asset.format}`,
          alternativeText: null,
          caption: null,
          width: asset.width,
          height: asset.height,
          formats: null,
          hash: asset.public_id,
          ext: `.${asset.format}`,
          mime: `image/${asset.format === "jpg" ? "jpeg" : asset.format}`,
          size: Number((asset.bytes / 1000).toFixed(2)),
          url: asset.url,
          provider: "cloudinary",
          provider_metadata: {
            asset_id: asset.asset_id,
            public_id: asset.public_id,
            resource_type: "image",
          },
          folderPath: "/",
        },
      });
    }
    result[asset.key] = file.id;
  }
  return result;
}

async function upsertLocalizedDocument(
  service,
  documentId,
  locale,
  desired,
  populate,
) {
  const draft = documentId
    ? await service.findOne({ documentId, locale, status: "draft", populate })
    : null;
  const published = documentId
    ? await service.findOne({
        documentId,
        locale,
        status: "published",
        populate,
      })
    : null;

  if (
    draft &&
    published &&
    valuesMatch(draft, desired) &&
    valuesMatch(published, desired)
  ) {
    return { documentId, changed: false };
  }

  let updated;
  if (documentId)
    updated = await service.update({ documentId, locale, data: desired });
  else updated = await service.create({ locale, data: desired });

  await service.publish({ documentId: updated.documentId, locale });
  return { documentId: updated.documentId, changed: true };
}

async function applyExperienceRecords(strapi, payload, summary) {
  const service = strapi.documents("api::experience.experience");
  for (const locale of EXPECTED.locales) {
    for (const record of payload.records.filter(
      (item) => item.locale === locale,
    )) {
      const result = await upsertLocalizedDocument(
        service,
        record.documentId,
        locale,
        record.fields,
      );
      if (result.changed) summary.experienceLocalizationsChanged += 1;
    }
  }
}

async function applyLanding(strapi, payload, mediaIds, summary) {
  const service = strapi.documents(
    "api::experience-landing.experience-landing",
  );
  const existing = await service.findFirst({ locale: "en", status: "draft" });
  let documentId = existing?.documentId || null;
  for (const locale of EXPECTED.locales) {
    const desired = {
      ...payload.landing[locale],
      hero_image: mediaIds.landing,
    };
    const result = await upsertLocalizedDocument(
      service,
      documentId,
      locale,
      desired,
      ["hero_image"],
    );
    documentId = result.documentId;
    if (result.changed) summary.landingLocalizationsChanged += 1;
  }
}

async function applyCategories(strapi, payload, mediaIds, summary) {
  const service = strapi.documents(
    "api::experience-category-page.experience-category-page",
  );
  for (const [key, category] of Object.entries(payload.categories)) {
    const existing = await service.findFirst({
      locale: "en",
      status: "draft",
      filters: { key },
    });
    let documentId = existing?.documentId || null;
    for (const locale of EXPECTED.locales) {
      const desired = {
        key,
        display_order: category.display_order,
        ...category.locales[locale],
        hero_image: mediaIds[category.media],
        card_image: mediaIds[category.media],
      };
      const result = await upsertLocalizedDocument(
        service,
        documentId,
        locale,
        desired,
        ["hero_image", "card_image"],
      );
      documentId = result.documentId;
      if (result.changed) summary.categoryLocalizationsChanged += 1;
    }
  }
}

async function runApply(
  options,
  payload,
  payloadValidation,
  projectedValidation,
) {
  assertPreflightReady(payloadValidation, projectedValidation);
  assertApplyGuards(options);
  await assertApplySchema();

  const { compileStrapi, createStrapi } = require("@strapi/strapi");
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);
  const summary = {
    migration: "experience-single-source-v1",
    mode: "APPLY",
    experienceLocalizationsChanged: 0,
    landingLocalizationsChanged: 0,
    categoryLocalizationsChanged: 0,
    mediaAssetsEnsured: 0,
  };

  try {
    await strapi.load();
    await strapi.db.transaction(async () => {
      const mediaIds = await ensureMediaRecords(strapi, payload.media);
      summary.mediaAssetsEnsured = Object.keys(mediaIds).length;
      await applyExperienceRecords(strapi, payload, summary);
      await applyLanding(strapi, payload, mediaIds, summary);
      await applyCategories(strapi, payload, mediaIds, summary);
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await strapi.destroy();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const backupDir = path.resolve(options.backupDir);
  const backup = verifyBackup(backupDir);
  const payload = loadPayload();
  const payloadValidation = validatePayload(payload);
  const projectedState = buildProjectedCmsState(payload, backupDir);
  const projectedValidation = validateProjectedCmsState(
    projectedState,
    payload,
  );

  if (options.mode === "dry-run") {
    await runDryRun(
      options,
      payload,
      payloadValidation,
      projectedValidation,
      backup,
    );
    return;
  }

  await runApply(options, payload, payloadValidation, projectedValidation);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `Migration ${process.argv.includes("--apply") ? "apply" : "dry-run"} failed: ${error.message}`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  CMS_DESTINATION_FIELDS,
  EXPECTED_TITLE_REPLACEMENTS,
  FRONTEND_SUPPLEMENT_DESTINATIONS,
  KNOWN_PROTECTED_FIELD_CORRECTIONS,
  assertPreflightReady,
  buildProjectedCmsState,
  buildProjectedExperienceRecord,
  findProtectedNameMatches,
  normalizeProtectedComparison,
  validatePayload,
  validateProjectedCmsState,
};
