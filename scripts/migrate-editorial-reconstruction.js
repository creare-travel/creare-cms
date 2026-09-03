"use strict";

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const {
  findProtectedNameMatches,
} = require("./migrate-experience-single-source.js");

const ROOT_DIR = path.resolve(__dirname, "..");
const PAYLOAD_PATH = path.join(
  ROOT_DIR,
  "src",
  "migrations",
  "editorial-reconstruction-v1.json",
);
const SCHEMA_MODELS = {
  culturalWorlds: {
    tableName: "cultural_world_pages",
    schemaPath: path.join(
      ROOT_DIR,
      "src",
      "api",
      "cultural-world-page",
      "content-types",
      "cultural-world-page",
      "schema.json",
    ),
  },
  category: {
    tableName: "experience_category_pages",
    schemaPath: path.join(
      ROOT_DIR,
      "src",
      "api",
      "experience-category-page",
      "content-types",
      "experience-category-page",
      "schema.json",
    ),
  },
};
const EXPECTED = {
  projectId: "a4539684-c08f-4ea4-9f0c-aaa1f0c0b682",
  environmentId: "a03e18cb-f063-41ed-ac0b-e46f419d63d5",
  cmsServiceId: "fe9a558d-bba4-4cf7-8d48-3ca3c99e635a",
  locales: ["en", "tr-TR", "zh-CN"],
  categoryKeys: ["signature", "lab", "black"],
  confirmation: "CREARE_EDITORIAL_RECONSTRUCTION_V1",
  experienceRows: 84,
  experienceFamilies: 14,
  insightRows: 96,
  mediaRows: 58,
};
const COMMON_CATEGORY_FIELDS = [
  "eyebrow",
  "hero_title",
  "hero_subtitle",
  "introduction",
  "list_eyebrow",
  "list_title",
  "cta_heading",
  "cta_supporting_text",
  "cta_access_line",
  "cta_label",
  "seo_title",
  "seo_description",
  "og_description",
];
const SPECIFIC_CATEGORY_FIELDS = {
  signature: [
    "signature_positioning_title",
    "signature_positioning_body_1",
    "signature_positioning_body_2",
    "signature_positioning_body_3",
    "signature_composition_title",
    "signature_composition_body",
    "signature_distinction_body",
    "signature_inquiry_title",
    "signature_inquiry_body",
  ],
  lab: [
    "lab_definition_body",
    "lab_context_title",
    "lab_context_body",
    "lab_principles_eyebrow",
    "lab_principles_title",
    "lab_principle_1_title",
    "lab_principle_1_body",
    "lab_principle_2_title",
    "lab_principle_2_body",
    "lab_principle_3_title",
    "lab_principle_3_body",
    "lab_audience_title",
    "lab_audience_body_1",
    "lab_audience_body_2",
    "lab_process_eyebrow",
    "lab_process_title",
    "lab_process_step_1_title",
    "lab_process_step_1_body",
    "lab_process_step_2_title",
    "lab_process_step_2_body",
    "lab_process_step_3_title",
    "lab_process_step_3_body",
    "lab_process_step_4_title",
    "lab_process_step_4_body",
    "lab_closing_body",
  ],
  black: [
    "black_context_title",
    "black_context_body",
    "black_process_eyebrow",
    "black_process_title",
    "black_process_step_1_title",
    "black_process_step_1_body",
    "black_process_step_2_title",
    "black_process_step_2_body",
    "black_process_step_3_title",
    "black_process_step_3_body",
    "black_process_step_4_title",
    "black_process_step_4_body",
    "black_conditions_title",
    "black_conditions_body",
  ],
};
const BLACK_PROHIBITED_PATTERNS = [
  /\bbespoke\b/iu,
  /invitation[- ]only/iu,
  /by invitation/iu,
  /referral[- ]only/iu,
  /never listed/iu,
  /after[- ]hours/iu,
  /closed collections?/iu,
  /guaranteed private venues?/iu,
  /access is granted/iu,
  /confidential delivery/iu,
  /nothing left to chance/iu,
  /yalnızca davetle/iu,
  /sadece davetle/iu,
  /referansla erişim/iu,
  /asla listelenmez/iu,
  /kapalı koleksiyon/iu,
  /garantili özel mekân/iu,
  /gizli yürüt/iu,
  /仅限邀请/u,
  /保证.*通达/u,
  /闭馆.*参观/u,
];
const FROZEN_TABLES = [
  "experiences",
  "experiences_audience_entity_lnk",
  "experiences_destination_lnk",
  "experiences_experience_type_entity_lnk",
  "experiences_insights_lnk",
  "experiences_intensity_entity_lnk",
  "experiences_mood_entity_lnk",
  "experiences_related_experiences_lnk",
  "experiences_related_insights_lnk",
  "insights",
  "insights_destination_lnk",
];

function usage() {
  console.log("Dry run:");
  console.log(
    "  npm run migrate:editorial-reconstruction -- --dry-run --backup-dir=/absolute/backup/path",
  );
  console.log("Apply (requires separate owner approval):");
  console.log(
    "  npm run migrate:editorial-reconstruction -- --apply --backup-dir=/absolute/backup/path --expected-deployment-sha=<sha> --expected-deployment-id=<id> --confirm-production=CREARE_EDITORIAL_RECONSTRUCTION_V1",
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
    else if (arg.startsWith("--expected-deployment-sha="))
      options.expectedDeploymentSha = arg.slice(
        "--expected-deployment-sha=".length,
      );
    else if (arg.startsWith("--expected-deployment-id="))
      options.expectedDeploymentId = arg.slice(
        "--expected-deployment-id=".length,
      );
    else if (arg.startsWith("--confirm-production="))
      options.confirmProduction = arg.slice("--confirm-production=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!new Set(["dry-run", "apply"]).has(options.mode) || !options.backupDir) {
    usage();
    throw new Error("Choose exactly one mode and provide --backup-dir.");
  }
  return options;
}

const sha256Buffer = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const sha256File = (filePath) => sha256Buffer(fs.readFileSync(filePath));
const stableHash = (value) => sha256Buffer(JSON.stringify(value));
const countPostgresCharacters = (value) => Array.from(value).length;

function verifyBackup(backupDir) {
  const manifestPath = path.join(backupDir, "SHA256SUMS");
  if (!fs.existsSync(manifestPath))
    throw new Error(`Backup manifest not found: ${manifestPath}`);
  const files = fs
    .readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/iu);
      if (!match) throw new Error(`Invalid backup manifest entry: ${line}`);
      const filePath = path.isAbsolute(match[2])
        ? match[2]
        : path.join(backupDir, match[2]);
      if (!fs.existsSync(filePath))
        throw new Error(`Backup file missing: ${filePath}`);
      const actual = sha256File(filePath);
      if (actual !== match[1].toLowerCase())
        throw new Error(`Backup checksum mismatch: ${filePath}`);
      return { file: path.relative(backupDir, filePath), sha256: actual };
    });
  return {
    manifestPath,
    manifestSha256: sha256File(manifestPath),
    filesVerified: files.length,
  };
}

function loadPayload() {
  return JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
}

function loadSchemas() {
  return Object.fromEntries(
    Object.entries(SCHEMA_MODELS).map(([key, model]) => [
      key,
      {
        ...model,
        schema: JSON.parse(fs.readFileSync(model.schemaPath, "utf8")),
      },
    ]),
  );
}

function findBlackProhibitedClaims(value) {
  const text = JSON.stringify(value);
  return BLACK_PROHIBITED_PATTERNS.filter((pattern) => pattern.test(text)).map(
    (pattern) => pattern.source,
  );
}

function validatePayload(payload, schemas = loadSchemas()) {
  const blockers = [];
  const expectedLocales = JSON.stringify(EXPECTED.locales);
  if (JSON.stringify(payload.locales) !== expectedLocales)
    blockers.push("Payload locales must be exactly EN, TR and ZH.");
  if (
    payload.source?.proposedMastersSha256 !==
    "0a508c55e327ddceb0022f8cc0cc5608891208ef1eeb0b722fc7b355fea1a63e"
  )
    blockers.push("Owner proposed master identity differs.");
  const culturalFields = Object.entries(
    schemas.culturalWorlds.schema.attributes,
  )
    .filter(([, attribute]) => ["string", "text"].includes(attribute.type))
    .map(([field]) => field);
  for (const locale of EXPECTED.locales) {
    const values = payload.culturalWorlds?.locales?.[locale];
    if (!values) {
      blockers.push(`Missing Cultural Worlds locale: ${locale}`);
      continue;
    }
    for (const field of culturalFields) {
      if (typeof values[field] !== "string" || values[field].trim() === "")
        blockers.push(`Cultural Worlds ${locale}.${field} is missing.`);
    }
    const extra = Object.keys(values).filter(
      (field) => !culturalFields.includes(field),
    );
    if (extra.length > 0)
      blockers.push(
        `Unexpected Cultural Worlds fields for ${locale}: ${extra.join(", ")}`,
      );
  }
  if (
    Object.values(payload.culturalWorlds?.locales || {}).some((values) =>
      Object.hasOwn(values, "destination_section_support"),
    )
  )
    blockers.push(
      "Forbidden shortened destination_section_support field is present.",
    );

  for (const key of EXPECTED.categoryKeys) {
    const category = payload.categories?.[key];
    if (!category || category.key !== key) {
      blockers.push(`Missing category payload: ${key}`);
      continue;
    }
    const required = [
      ...COMMON_CATEGORY_FIELDS,
      ...SPECIFIC_CATEGORY_FIELDS[key],
    ];
    for (const locale of EXPECTED.locales) {
      const values = category.locales?.[locale];
      if (!values) {
        blockers.push(`Missing category locale: ${key}.${locale}`);
        continue;
      }
      for (const field of required) {
        if (typeof values[field] !== "string" || values[field].trim() === "")
          blockers.push(`${key}.${locale}.${field} is missing.`);
      }
      const extra = Object.keys(values).filter(
        (field) => !required.includes(field),
      );
      if (extra.length > 0)
        blockers.push(
          `Unexpected fields for ${key}.${locale}: ${extra.join(", ")}`,
        );
    }
  }
  if (
    payload.categories?.signature?.locales?.["tr-TR"]
      ?.signature_inquiry_title !== "İlk temastan teyide"
  )
    blockers.push("Approved TR SIGNATURE inquiry title is not locked.");
  if (
    payload.categories?.signature?.locales?.["tr-TR"]?.cta_heading !==
    "SIGNATURE™ Deneyiminizi Görüşelim"
  )
    blockers.push("Approved TR SIGNATURE CTA heading is not locked.");
  const lab = payload.categories?.lab?.locales || {};
  const expectedPrinciples = {
    en: ["Clarity", "Structure", "Precision"],
    "tr-TR": ["Netlik", "Yapı", "Hassasiyet"],
    "zh-CN": ["清晰", "结构", "精准"],
  };
  for (const locale of EXPECTED.locales) {
    const actual = [1, 2, 3].map(
      (index) => lab[locale]?.[`lab_principle_${index}_title`],
    );
    if (JSON.stringify(actual) !== JSON.stringify(expectedPrinciples[locale]))
      blockers.push(`LAB principles differ for ${locale}.`);
  }
  if (payload.officialExperienceNames?.length !== 14)
    blockers.push("Exactly 14 official Experience names are required.");
  if (
    JSON.stringify(payload.destinationOrder) !==
    JSON.stringify([
      { slug: "istanbul", order_index: 1 },
      { slug: "cappadocia", order_index: 2 },
      { slug: "bodrum", order_index: 3 },
    ])
  )
    blockers.push("Destination ordering is not owner-locked.");
  const hiddenPayloadMatches = payload.preservedHiddenExperienceFields.filter(
    (field) =>
      JSON.stringify({
        culturalWorlds: payload.culturalWorlds,
        categories: payload.categories,
      }).includes(`\"${field}\"`),
  );
  if (hiddenPayloadMatches.length > 0)
    blockers.push(
      `Hidden Experience fields leaked into writable payload: ${hiddenPayloadMatches.join(", ")}`,
    );
  const blackProhibitedClaims = findBlackProhibitedClaims(
    payload.categories?.black?.locales || {},
  );
  if (blackProhibitedClaims.length > 0)
    blockers.push(
      `BLACK prohibited claims: ${blackProhibitedClaims.join(", ")}`,
    );
  const protectedOldNameMatches = [];
  findProtectedNameMatches(
    {
      culturalWorlds: payload.culturalWorlds?.locales,
      categories: payload.categories,
    },
    { documentFamily: "editorial-reconstruction", locale: "all" },
    protectedOldNameMatches,
  );
  if (protectedOldNameMatches.length > 0)
    blockers.push(
      `${protectedOldNameMatches.length} protected obsolete Experience name(s) remain in payload.`,
    );
  return { blockers, blackProhibitedClaims, protectedOldNameMatches };
}

function buildLengthConstraints(schemas, databaseColumns) {
  const constraints = {};
  for (const [modelKey, model] of Object.entries(schemas)) {
    constraints[modelKey] = {};
    const tableColumns = databaseColumns[model.tableName] || {};
    for (const [field, attribute] of Object.entries(
      model.schema.attributes || {},
    )) {
      if (!["string", "text"].includes(attribute.type)) continue;
      const column = tableColumns[field];
      const candidates = [
        Number.isInteger(attribute.maxLength) ? attribute.maxLength : null,
        Number.isInteger(column?.characterMaximumLength)
          ? column.characterMaximumLength
          : null,
        attribute.type === "string" ? 255 : null,
      ].filter(Number.isInteger);
      if (candidates.length === 0) continue;
      constraints[modelKey][field] = {
        model: modelKey,
        tableName: model.tableName,
        field,
        attributeType: attribute.type,
        localized: attribute.pluginOptions?.i18n?.localized === true,
        applicationMaxLength: Number.isInteger(attribute.maxLength)
          ? attribute.maxLength
          : null,
        databaseType: column?.dataType || null,
        databaseMaxLength: Number.isInteger(column?.characterMaximumLength)
          ? column.characterMaximumLength
          : null,
        permittedLength: Math.min(...candidates),
      };
    }
  }
  return constraints;
}

function buildLengthTargets(payload) {
  const targets = [];
  const add = (model, documentFamily, locale, values, fieldPrefix) => {
    for (const status of ["draft", "published"])
      targets.push({
        model,
        documentFamily,
        locale,
        status,
        values,
        fieldPrefix,
      });
  };
  for (const locale of EXPECTED.locales)
    add(
      "culturalWorlds",
      "cultural-world-page",
      locale,
      payload.culturalWorlds.locales[locale],
      `culturalWorlds.locales.${locale}`,
    );
  for (const key of EXPECTED.categoryKeys)
    for (const locale of EXPECTED.locales)
      add(
        "category",
        `experience-category:${key}`,
        locale,
        payload.categories[key].locales[locale],
        `categories.${key}.locales.${locale}`,
      );
  return targets;
}

function validatePlannedFieldLengths(payload, constraints) {
  const violations = [];
  let checkedValues = 0;
  for (const target of buildLengthTargets(payload)) {
    for (const constraint of Object.values(constraints[target.model] || {})) {
      const value = target.values[constraint.field];
      if (typeof value !== "string") continue;
      checkedValues += 1;
      const actualLength = countPostgresCharacters(value);
      if (actualLength > constraint.permittedLength)
        violations.push({
          documentFamily: target.documentFamily,
          locale: target.locale,
          targetStatus: target.status,
          fieldPath: `${target.fieldPrefix}.${constraint.field}`,
          actualLength,
          permittedLength: constraint.permittedLength,
          applicationMaxLength: constraint.applicationMaxLength,
          databaseType: constraint.databaseType,
          databaseMaxLength: constraint.databaseMaxLength,
        });
    }
  }
  return {
    blockers: violations.map(
      (item) =>
        `${item.documentFamily}:${item.locale}:${item.targetStatus} ${item.fieldPath} exceeds ${item.permittedLength} characters (${item.actualLength}).`,
    ),
    lengthConstraintBlockers: violations.length,
    checkedValues,
    violations,
    constraints,
  };
}

function getConnectionString() {
  return process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
}

async function tableExists(client, tableName) {
  return Boolean(
    (
      await client.query("SELECT to_regclass($1) AS table_name", [
        `public.${tableName}`,
      ])
    ).rows[0].table_name,
  );
}

async function readDatabaseColumns(client, schemas) {
  const result = {};
  for (const model of Object.values(schemas)) {
    if (!(await tableExists(client, model.tableName))) {
      result[model.tableName] = null;
      continue;
    }
    const rows = (
      await client.query(
        `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [model.tableName],
      )
    ).rows;
    result[model.tableName] = Object.fromEntries(
      rows.map((row) => [
        row.column_name,
        {
          dataType: row.data_type,
          characterMaximumLength: row.character_maximum_length,
        },
      ]),
    );
  }
  return result;
}

async function readRows(client, tableName) {
  return (await client.query(`SELECT * FROM "${tableName}" ORDER BY id`)).rows;
}

function rowStatus(row) {
  return row.published_at ? "published" : "draft";
}

function valuesMatch(row, desired) {
  return (
    Boolean(row) &&
    Object.entries(desired).every(
      ([field, value]) =>
        JSON.stringify(row[field] ?? null) === JSON.stringify(value ?? null),
    )
  );
}

function loadBackupTables(backupDir) {
  const filePath = path.join(
    backupDir,
    "db",
    "relevant-production-tables.json",
  );
  if (!fs.existsSync(filePath))
    throw new Error(`Backup database snapshot missing: ${filePath}`);
  const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!snapshot.transaction?.readOnly)
    throw new Error("Backup database snapshot is not marked read-only.");
  return snapshot.tables || {};
}

function compareFrozenTables(current, backup) {
  const mismatches = [];
  for (const table of FROZEN_TABLES) {
    if (!Array.isArray(backup[table]))
      mismatches.push({ table, reason: "missing-backup-table" });
    else if (stableHash(current[table] || []) !== stableHash(backup[table]))
      mismatches.push({ table, reason: "data-drift" });
  }
  return mismatches;
}

async function inspectProduction(client, payload, backupDir, schemas) {
  const requiredTables = [
    ...new Set([
      ...FROZEN_TABLES,
      "cultural_world_pages",
      "experience_category_pages",
      "destinations",
      "files",
      "files_related_mph",
    ]),
  ];
  const current = {};
  for (const table of requiredTables)
    current[table] = (await tableExists(client, table))
      ? await readRows(client, table)
      : [];
  const backupTables = loadBackupTables(backupDir);
  const databaseColumns = await readDatabaseColumns(client, schemas);
  const missingSchema = [];
  for (const [modelKey, model] of Object.entries(schemas)) {
    const columns = databaseColumns[model.tableName];
    if (!columns) missingSchema.push(`${modelKey}:table`);
    else
      for (const field of Object.keys(model.schema.attributes))
        if (!columns[field]) missingSchema.push(`${modelKey}:${field}`);
  }
  const experiences = current.experiences;
  const insights = current.insights;
  const categories = current.experience_category_pages;
  const culturalWorlds = current.cultural_world_pages;
  const destinations = current.destinations;
  const files = current.files;
  const fileRelations = current.files_related_mph;
  const localeStatusCounts = (rows) =>
    Object.fromEntries(
      EXPECTED.locales.map((locale) => [
        locale,
        {
          draft: rows.filter(
            (row) => row.locale === locale && rowStatus(row) === "draft",
          ).length,
          published: rows.filter(
            (row) => row.locale === locale && rowStatus(row) === "published",
          ).length,
        },
      ]),
    );
  const officialNameMismatches = [];
  for (const identity of payload.officialExperienceNames) {
    const rows = experiences.filter(
      (row) => row.document_id === identity.documentId,
    );
    for (const locale of EXPECTED.locales)
      for (const status of ["draft", "published"]) {
        const row = rows.find(
          (item) => item.locale === locale && rowStatus(item) === status,
        );
        if (!row || row.slug !== identity.slug || row.title !== identity.title)
          officialNameMismatches.push({
            documentId: identity.documentId,
            slug: identity.slug,
            locale,
            status,
            actualSlug: row?.slug || null,
            actualTitle: row?.title || null,
            expectedTitle: identity.title,
          });
      }
  }
  const hiddenExperienceHash = stableHash(
    experiences.map((row) => ({
      id: row.id,
      document_id: row.document_id,
      locale: row.locale,
      status: rowStatus(row),
      ...Object.fromEntries(
        payload.preservedHiddenExperienceFields.map((field) => [
          field,
          row[field],
        ]),
      ),
    })),
  );
  const backupHiddenExperienceHash = stableHash(
    (backupTables.experiences || []).map((row) => ({
      id: row.id,
      document_id: row.document_id,
      locale: row.locale,
      status: rowStatus(row),
      ...Object.fromEntries(
        payload.preservedHiddenExperienceFields.map((field) => [
          field,
          row[field],
        ]),
      ),
    })),
  );
  const categoryMediaMismatches = [];
  for (const row of categories)
    for (const field of ["hero_image", "card_image"]) {
      const relation = fileRelations.find(
        (item) =>
          item.related_type ===
            "api::experience-category-page.experience-category-page" &&
          item.related_id === row.id &&
          item.field === field,
      );
      const file = relation
        ? files.find((item) => item.id === relation.file_id)
        : null;
      if (
        file?.provider_metadata?.public_id !==
        payload.categories[row.key]?.mediaPublicId
      )
        categoryMediaMismatches.push({
          key: row.key,
          locale: row.locale,
          status: rowStatus(row),
          field,
          mediaId: file?.id || null,
          publicId: file?.provider_metadata?.public_id || null,
        });
    }
  const culturalMediaMatches = files.filter(
    (file) =>
      file.url === payload.culturalWorlds.media.url ||
      file.provider_metadata?.public_id ===
        payload.culturalWorlds.media.publicId,
  );
  const categoryLocalizationsToUpdate = [];
  for (const key of EXPECTED.categoryKeys)
    for (const locale of EXPECTED.locales) {
      const desired = payload.categories[key].locales[locale];
      const rows = categories.filter(
        (row) => row.key === key && row.locale === locale,
      );
      const draft = rows.find((row) => rowStatus(row) === "draft");
      const published = rows.find((row) => rowStatus(row) === "published");
      if (!valuesMatch(draft, desired) || !valuesMatch(published, desired))
        categoryLocalizationsToUpdate.push({ key, locale });
    }
  const culturalWorldLocalizationsToUpdate = EXPECTED.locales.filter(
    (locale) => {
      const desired = payload.culturalWorlds.locales[locale];
      const rows = culturalWorlds.filter((row) => row.locale === locale);
      return (
        !valuesMatch(
          rows.find((row) => rowStatus(row) === "draft"),
          desired,
        ) ||
        !valuesMatch(
          rows.find((row) => rowStatus(row) === "published"),
          desired,
        )
      );
    },
  );
  const destinationLocalizationsToUpdate = [];
  const destinationIdentityMismatches = [];
  for (const desired of payload.destinationOrder) {
    const family = destinations.filter((row) => row.slug === desired.slug);
    const documentIds = [...new Set(family.map((row) => row.document_id))];
    if (documentIds.length !== 1)
      destinationIdentityMismatches.push({ slug: desired.slug, documentIds });
    for (const locale of EXPECTED.locales) {
      const rows = family.filter((row) => row.locale === locale);
      const draft = rows.find((row) => rowStatus(row) === "draft");
      const published = rows.find((row) => rowStatus(row) === "published");
      if (!draft || !published)
        destinationIdentityMismatches.push({
          slug: desired.slug,
          locale,
          reason: "missing-draft-or-published",
        });
      else if (
        draft.order_index !== desired.order_index ||
        published.order_index !== desired.order_index
      )
        destinationLocalizationsToUpdate.push({
          slug: desired.slug,
          locale,
          from: { draft: draft.order_index, published: published.order_index },
          to: desired.order_index,
        });
    }
  }
  const ruRecords = Object.entries(current).flatMap(([table, rows]) =>
    rows
      .filter((row) => /^ru(?:-|$)/iu.test(row.locale || ""))
      .map((row) => ({ table, id: row.id, locale: row.locale })),
  );
  const blackExperienceRows = experiences.filter(
    (row) => row.category === "black",
  );
  const blockers = [];
  if (missingSchema.length > 0)
    blockers.push(`Schema fields missing: ${missingSchema.join(", ")}`);
  if (
    experiences.length !== EXPECTED.experienceRows ||
    new Set(experiences.map((row) => row.document_id)).size !==
      EXPECTED.experienceFamilies
  )
    blockers.push("Experience production identity differs.");
  if (insights.length !== EXPECTED.insightRows)
    blockers.push(
      `Insight row count is ${insights.length}, expected ${EXPECTED.insightRows}.`,
    );
  if (
    categories.length !== 18 ||
    new Set(categories.map((row) => row.document_id)).size !== 3
  )
    blockers.push("Category family/localization inventory differs.");
  if (files.length !== EXPECTED.mediaRows)
    blockers.push(
      `Media row count is ${files.length}, expected ${EXPECTED.mediaRows}.`,
    );
  if (officialNameMismatches.length > 0)
    blockers.push(
      `${officialNameMismatches.length} official Experience identity mismatch(es).`,
    );
  if (hiddenExperienceHash !== backupHiddenExperienceHash)
    blockers.push("Hidden Experience fields drifted after backup.");
  const frozenTableMismatches = compareFrozenTables(current, backupTables);
  if (frozenTableMismatches.length > 0)
    blockers.push(
      `${frozenTableMismatches.length} frozen production table(s) drifted after backup.`,
    );
  if (categoryMediaMismatches.length > 0)
    blockers.push(
      `${categoryMediaMismatches.length} category media relation mismatch(es).`,
    );
  if (culturalMediaMatches.length > 1)
    blockers.push("Duplicate Cultural Worlds hero media records exist.");
  if (destinationIdentityMismatches.length > 0)
    blockers.push(
      `${destinationIdentityMismatches.length} Destination identity mismatch(es).`,
    );
  if (ruRecords.length > 0)
    blockers.push(`${ruRecords.length} RU record(s) detected.`);
  if (blackExperienceRows.length > 0)
    blockers.push(
      `${blackExperienceRows.length} BLACK Experience row(s) exist; empty collection policy differs.`,
    );
  return {
    blockers,
    databaseColumns,
    missingSchema,
    counts: {
      experienceRows: experiences.length,
      experienceFamilies: new Set(experiences.map((row) => row.document_id))
        .size,
      experienceLocaleStatus: localeStatusCounts(experiences),
      culturalWorldRows: culturalWorlds.length,
      culturalWorldFamilies: new Set(
        culturalWorlds.map((row) => row.document_id),
      ).size,
      categoryRows: categories.length,
      categoryFamilies: new Set(categories.map((row) => row.document_id)).size,
      destinationRows: destinations.length,
      mediaRows: files.length,
      insightRows: insights.length,
      blackExperienceRows: blackExperienceRows.length,
    },
    projected: {
      culturalWorldLocalizationsToUpdate:
        culturalWorldLocalizationsToUpdate.length,
      culturalWorldPublications: culturalWorldLocalizationsToUpdate.length,
      categoryLocalizationsToUpdate: categoryLocalizationsToUpdate.length,
      categoryPublications: categoryLocalizationsToUpdate.length,
      destinationOrderLocalizationsToUpdate:
        destinationLocalizationsToUpdate.length,
      destinationPublications: destinationLocalizationsToUpdate.length,
      mediaRegistrations: culturalMediaMatches.length === 0 ? 1 : 0,
      duplicateUploads: 0,
      experienceChanges: 0,
      insightChanges: 0,
      ruChanges: 0,
    },
    officialNameMismatches,
    hiddenExperienceHash,
    backupHiddenExperienceHash,
    frozenTableMismatches,
    categoryMediaMismatches,
    culturalMediaMatches: culturalMediaMatches.map((file) => ({
      id: file.id,
      documentId: file.document_id,
      publicId: file.provider_metadata?.public_id || null,
      url: file.url,
    })),
    destinationIdentityMismatches,
    destinationLocalizationsToUpdate,
    ruRecords,
  };
}

async function runReadOnlyPreflight(payload, payloadValidation, backupDir) {
  const connectionString = getConnectionString();
  if (!connectionString)
    throw new Error("DATABASE_PUBLIC_URL or DATABASE_URL is required.");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  try {
    const schemas = loadSchemas();
    const production = await inspectProduction(
      client,
      payload,
      backupDir,
      schemas,
    );
    const constraints = buildLengthConstraints(
      schemas,
      production.databaseColumns,
    );
    const lengthConstraints = validatePlannedFieldLengths(payload, constraints);
    const identity = (
      await client.query(
        "SELECT current_database() AS database, current_schema() AS schema, current_user AS db_user, current_setting('transaction_read_only') AS transaction_read_only, version() AS version",
      )
    ).rows[0];
    await client.query("ROLLBACK");
    const blockers = [
      ...payloadValidation.blockers,
      ...production.blockers,
      ...lengthConstraints.blockers,
    ];
    return { identity, production, lengthConstraints, blockers };
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
  if (options.confirmProduction !== EXPECTED.confirmation)
    throw new Error("Apply confirmation is missing or invalid.");
  if (!/^[a-f0-9]{40}$/u.test(options.expectedDeploymentSha || ""))
    throw new Error("--expected-deployment-sha must be a full Git SHA.");
  if (!/^[a-f0-9-]{20,}$/u.test(options.expectedDeploymentId || ""))
    throw new Error("--expected-deployment-id is required.");
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  }).trim();
  if (checkoutSha !== options.expectedDeploymentSha)
    throw new Error(
      `Checkout SHA ${checkoutSha} differs from approved deployed SHA.`,
    );
  if (process.env.RAILWAY_PROJECT_ID !== EXPECTED.projectId)
    throw new Error("Wrong Railway project.");
  if (process.env.RAILWAY_ENVIRONMENT_ID !== EXPECTED.environmentId)
    throw new Error("Wrong Railway environment.");
  if (process.env.RAILWAY_SERVICE_ID !== EXPECTED.cmsServiceId)
    throw new Error("Wrong Railway CMS service.");
  if (process.env.RAILWAY_DEPLOYMENT_ID !== options.expectedDeploymentId)
    throw new Error("Railway deployment ID differs from approval.");
  if (process.env.RAILWAY_GIT_COMMIT_SHA !== options.expectedDeploymentSha)
    throw new Error("Railway deployed commit differs from approval.");
}

function assertNoBlockers(preflight) {
  if (preflight.blockers.length > 0)
    throw new Error(`Preflight blockers: ${preflight.blockers.join(" | ")}`);
}

async function ensureCulturalHero(strapi, media) {
  const files = await strapi.db.query("plugin::upload.file").findMany({});
  const matches = files.filter(
    (file) =>
      file.url === media.url ||
      file.provider_metadata?.public_id === media.publicId,
  );
  if (matches.length > 1)
    throw new Error("Duplicate Cultural Worlds hero media records exist.");
  if (matches.length === 1) return { id: matches[0].id, created: false };
  const file = await strapi.db.query("plugin::upload.file").create({
    data: {
      name: media.name,
      alternativeText: null,
      caption: null,
      width: media.width,
      height: media.height,
      formats: null,
      hash: media.publicId,
      ext: `.${media.format}`,
      mime: media.mime,
      size: Number((media.bytes / 1000).toFixed(2)),
      url: media.url,
      provider: "cloudinary",
      provider_metadata: { public_id: media.publicId, resource_type: "image" },
      folderPath: "/",
    },
  });
  return { id: file.id, created: true };
}

function documentValuesMatch(record, desired) {
  return (
    Boolean(record) &&
    Object.entries(desired).every(([field, value]) => {
      if (field === "hero_image")
        return (record.hero_image?.id ?? record.hero_image) === value;
      return (
        JSON.stringify(record[field] ?? null) === JSON.stringify(value ?? null)
      );
    })
  );
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
    documentValuesMatch(draft, desired) &&
    documentValuesMatch(published, desired)
  )
    return { documentId, changed: false };
  const updated = documentId
    ? await service.update({ documentId, locale, data: desired })
    : await service.create({ locale, data: desired });
  await service.publish({ documentId: updated.documentId, locale });
  return { documentId: updated.documentId, changed: true };
}

async function applyCulturalWorlds(strapi, payload, mediaId, summary) {
  const service = strapi.documents(
    "api::cultural-world-page.cultural-world-page",
  );
  const existing = await service.findFirst({ locale: "en", status: "draft" });
  let documentId = existing?.documentId || null;
  for (const locale of EXPECTED.locales) {
    const result = await upsertLocalizedDocument(
      service,
      documentId,
      locale,
      { ...payload.culturalWorlds.locales[locale], hero_image: mediaId },
      ["hero_image"],
    );
    documentId = result.documentId;
    if (result.changed) summary.culturalWorldLocalizationsChanged += 1;
  }
}

async function applyCategories(strapi, payload, summary) {
  const service = strapi.documents(
    "api::experience-category-page.experience-category-page",
  );
  for (const key of EXPECTED.categoryKeys) {
    const existing = await service.findFirst({
      locale: "en",
      status: "draft",
      filters: { key },
    });
    if (!existing) throw new Error(`Category family missing: ${key}`);
    for (const locale of EXPECTED.locales) {
      const result = await upsertLocalizedDocument(
        service,
        existing.documentId,
        locale,
        payload.categories[key].locales[locale],
      );
      if (result.changed) summary.categoryLocalizationsChanged += 1;
    }
  }
}

async function applyDestinationOrder(strapi, payload, summary) {
  const service = strapi.documents("api::destination.destination");
  for (const desired of payload.destinationOrder) {
    const existing = await service.findFirst({
      locale: "en",
      status: "draft",
      filters: { slug: desired.slug },
    });
    if (!existing)
      throw new Error(`Destination family missing: ${desired.slug}`);
    for (const locale of EXPECTED.locales) {
      const result = await upsertLocalizedDocument(
        service,
        existing.documentId,
        locale,
        { order_index: desired.order_index },
      );
      if (result.changed) summary.destinationOrderLocalizationsChanged += 1;
    }
  }
}

async function assertAppliedState(strapi, payload, backupDir, mediaId) {
  const cultural = strapi.documents(
    "api::cultural-world-page.cultural-world-page",
  );
  for (const locale of EXPECTED.locales)
    for (const status of ["draft", "published"]) {
      const record = await cultural.findFirst({
        locale,
        status,
        populate: ["hero_image"],
      });
      if (
        !documentValuesMatch(record, {
          ...payload.culturalWorlds.locales[locale],
          hero_image: mediaId,
        })
      )
        throw new Error(
          `Cultural Worlds assertion failed: ${locale}:${status}`,
        );
    }
  const category = strapi.documents(
    "api::experience-category-page.experience-category-page",
  );
  for (const key of EXPECTED.categoryKeys)
    for (const locale of EXPECTED.locales)
      for (const status of ["draft", "published"]) {
        const record = await category.findFirst({
          locale,
          status,
          filters: { key },
        });
        if (
          !documentValuesMatch(record, payload.categories[key].locales[locale])
        )
          throw new Error(
            `Category assertion failed: ${key}:${locale}:${status}`,
          );
      }
  const destination = strapi.documents("api::destination.destination");
  for (const desired of payload.destinationOrder)
    for (const locale of EXPECTED.locales)
      for (const status of ["draft", "published"]) {
        const record = await destination.findFirst({
          locale,
          status,
          filters: { slug: desired.slug },
        });
        if (!record || record.order_index !== desired.order_index)
          throw new Error(
            `Destination order assertion failed: ${desired.slug}:${locale}:${status}`,
          );
      }
  const backupTables = loadBackupTables(backupDir);
  for (const table of FROZEN_TABLES) {
    const current = await strapi.db.connection(table).select("*").orderBy("id");
    if (stableHash(current) !== stableHash(backupTables[table] || []))
      throw new Error(`Frozen table changed inside transaction: ${table}`);
  }
  const files = await strapi.db.query("plugin::upload.file").findMany({});
  const mediaMatches = files.filter(
    (file) =>
      file.url === payload.culturalWorlds.media.url ||
      file.provider_metadata?.public_id ===
        payload.culturalWorlds.media.publicId,
  );
  if (mediaMatches.length !== 1 || mediaMatches[0].id !== mediaId)
    throw new Error("Cultural Worlds media assertion failed.");
}

async function runApply(options, payload, preflight, backupDir) {
  assertNoBlockers(preflight);
  assertApplyGuards(options);
  const { compileStrapi, createStrapi } = require("@strapi/strapi");
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);
  const summary = {
    migration: "editorial-reconstruction-v1",
    mode: "APPLY",
    culturalWorldLocalizationsChanged: 0,
    categoryLocalizationsChanged: 0,
    destinationOrderLocalizationsChanged: 0,
    mediaRecordsCreated: 0,
    experienceChanges: 0,
    insightChanges: 0,
    ruChanges: 0,
    transactionCommitted: false,
    cleanupWarnings: [],
  };
  try {
    await strapi.load();
    await strapi.db.transaction(async () => {
      const media = await ensureCulturalHero(
        strapi,
        payload.culturalWorlds.media,
      );
      summary.mediaRecordsCreated = media.created ? 1 : 0;
      await applyCulturalWorlds(strapi, payload, media.id, summary);
      await applyCategories(strapi, payload, summary);
      await applyDestinationOrder(strapi, payload, summary);
      await assertAppliedState(strapi, payload, backupDir, media.id);
    });
    summary.transactionCommitted = true;
  } finally {
    try {
      await strapi.destroy();
    } catch (error) {
      summary.cleanupWarnings.push(error.message);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const backupDir = path.resolve(options.backupDir);
  const backup = verifyBackup(backupDir);
  const payload = loadPayload();
  const payloadValidation = validatePayload(payload);
  const preflight = await runReadOnlyPreflight(
    payload,
    payloadValidation,
    backupDir,
  );
  if (options.mode === "dry-run") {
    const report = {
      migration: "editorial-reconstruction-v1",
      mode: "DRY RUN",
      writeAttempted: false,
      transaction: preflight.identity,
      railwayContext: {
        projectId: process.env.RAILWAY_PROJECT_ID || null,
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID || null,
        serviceId: process.env.RAILWAY_SERVICE_ID || null,
        deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
        deployedSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      },
      backup,
      payload: payloadValidation,
      production: preflight.production,
      lengthConstraints: preflight.lengthConstraints,
      lengthConstraintBlockers:
        preflight.lengthConstraints.lengthConstraintBlockers,
      blockers: preflight.blockers,
      readyForApplyAuthorization: preflight.blockers.length === 0,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.blockers.length > 0) process.exitCode = 2;
    return;
  }
  await runApply(options, payload, preflight, backupDir);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `Editorial reconstruction ${process.argv.includes("--apply") ? "apply" : "dry-run"} failed: ${error.message}`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  BLACK_PROHIBITED_PATTERNS,
  COMMON_CATEGORY_FIELDS,
  EXPECTED,
  SPECIFIC_CATEGORY_FIELDS,
  buildLengthConstraints,
  buildLengthTargets,
  countPostgresCharacters,
  documentValuesMatch,
  findBlackProhibitedClaims,
  parseArgs,
  verifyBackup,
  validatePayload,
  validatePlannedFieldLengths,
};
