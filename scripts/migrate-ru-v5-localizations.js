"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const PAYLOAD_PATH = path.join(ROOT, "src/migrations/ru-v5-localizations.json");
const TARGET_LOCALE = "ru-RU";
const APPLY_CONFIRMATION = "CREARE_RU_V5_LOCALIZATIONS";
const SYSTEM_FIELDS = new Set([
  "id",
  "documentId",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "locale",
]);
const EXPECTED_RU_TITLES = new Map([
  [
    "beylerbeyi-1869-empire-interrupted",
    "Бейлербейи 1869™ — Переломный момент империи",
  ],
  [
    "bodrum-beach-games-rhythm-competition-celebration",
    "Пляжные игры Бодрума™ — Ритм, состязание и праздник",
  ],
  [
    "cocktail-atelier-mix-move-connect",
    "Коктейльное ателье™ — Смешивай, двигайся, общайся",
  ],
  ["culinary-arena-bodrum", "Кулинарная арена™"],
  ["driven-by-performance", "За рулём мастерства™"],
  ["floating-salon-d-opera", "Оперный салон на воде™"],
  ["golden-horn-regatta", "Гребная регата Золотого Рога™"],
  [
    "imperial-flavors-culinary-atelier",
    "Имперские вкусы™ — Кулинарное ателье",
  ],
  ["istanbul-through-the-lens", "Стамбул сквозь объектив™"],
  ["princes-islands-regatta", "Парусная регата Принцевых островов™"],
  ["silk-road-istanbul", "Шёлковый путь: Стамбул™"],
  ["table-to-farm-bodrum", "От фермы к столу: Бодрум™"],
  ["the-salon-of-hands", "Звучание глины™"],
  ["the-studio-session", "Творческая сессия в мастерской™"],
]);
const EN_TITLE_PATTERNS = [
  "Beylerbeyi 1869",
  "Bodrum Beach Games",
  "Cocktail Atelier",
  "Culinary Arena",
  "Driven by Performance",
  "Floating Salon d'Opera",
  "Golden Horn Regatta",
  "Imperial Flavors",
  "Istanbul Through the Lens",
  "Princes' Islands Regatta",
  "Princes Islands Regatta",
  "Silk Road Istanbul",
  "Table to Farm Bodrum",
  "The Salon of Hands",
  "The Studio Session",
];
const SILK_PROHIBITED = [
  /private entry/iu,
  /частн\w*\s+вход/iu,
  /дополнительн\w*\s+частн\w*\s+доступ/iu,
  /избранн\w*\s+(зон|помещен)/iu,
  /институциональн\w*\s+координац/iu,
];
const NON_EDITORIAL_TEXT_FIELDS = new Set([
  "category",
  "series",
  "experience_type",
  "geo_experience_type",
  "mood",
  "intent_level",
  "intensity",
]);
const TABLES_BY_UID = {
  "api::experience.experience": "experiences",
  "api::destination.destination": "destinations",
  "api::experience-category-page.experience-category-page":
    "experience_category_pages",
  "api::experience-landing.experience-landing": "experience_landings",
  "api::cultural-world-page.cultural-world-page": "cultural_world_pages",
};
const ONTOLOGY_RELATIONS = {
  mood_entity: {
    table: "experiences_mood_entity_lnk",
    targetColumn: "mood_id",
  },
  intensity_entity: {
    table: "experiences_intensity_entity_lnk",
    targetColumn: "intensity_id",
  },
  audience_entity: {
    table: "experiences_audience_entity_lnk",
    targetColumn: "audience_segment_id",
  },
  experience_type_entity: {
    table: "experiences_experience_type_entity_lnk",
    targetColumn: "experience_type_id",
  },
};

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = (file) => sha256(fs.readFileSync(file));

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { $bytes: value.toString("base64") };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

const stableHash = (value) => sha256(JSON.stringify(canonical(value)));
const statusOf = (row) => (row.published_at ? "published" : "draft");

function parseArgs(argv) {
  const options = {
    mode: null,
    backupDir: null,
    resultPath: null,
    confirmation: null,
  };
  for (const arg of argv) {
    if (arg === "--dry-run")
      options.mode = options.mode ? "invalid" : "dry-run";
    else if (arg === "--apply")
      options.mode = options.mode ? "invalid" : "apply";
    else if (arg.startsWith("--backup-dir=")) options.backupDir = arg.slice(13);
    else if (arg.startsWith("--result-path="))
      options.resultPath = arg.slice(14);
    else if (arg.startsWith("--confirm-production="))
      options.confirmation = arg.slice(21);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.mode || options.mode === "invalid" || !options.backupDir) {
    throw new Error("Exactly one mode and --backup-dir are required.");
  }
  return options;
}

function walkStrings(value, at = "", output = []) {
  if (typeof value === "string") output.push({ path: at, value });
  else if (Array.isArray(value))
    value.forEach((item, index) => walkStrings(item, `${at}.${index}`, output));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      walkStrings(item, at ? `${at}.${key}` : key, output),
    );
  }
  return output;
}

function extractNumbers(value) {
  return walkStrings(value).flatMap(
    ({ value: text }) => text.match(/\d+(?:[.,]\d+)?/gu) || [],
  );
}

function validateRecordPayload(record, tables, blockers, warnings) {
  const rows = tables[record.table].filter(
    (row) => row.document_id === record.documentId,
  );
  const enRows = rows.filter((row) => row.locale === "en");
  const ruRows = rows.filter((row) => row.locale === TARGET_LOCALE);
  if (enRows.length !== 2 || new Set(enRows.map(statusOf)).size !== 2) {
    blockers.push(`${record.documentId}: EN draft/published pair differs`);
    return;
  }
  if (ruRows.length !== 0)
    blockers.push(`${record.documentId}: unexpected RU localization exists`);
  if (
    stableHash(
      rows.filter((row) => ["en", "tr-TR", "zh-CN"].includes(row.locale)),
    ) !== record.protectedFamilyHash
  ) {
    blockers.push(`${record.documentId}: protected EN/TR/ZH family drift`);
  }
  for (const source of record.sourceRows) {
    const actual = enRows.find(
      (row) => row.id === source.id && statusOf(row) === source.status,
    );
    if (!actual || stableHash(actual) !== source.hash)
      blockers.push(`${record.documentId}:${source.status}: EN source drift`);
  }
  if (record.identity) {
    for (const row of enRows)
      if (row[record.identity.field] !== record.identity.value) {
        blockers.push(`${record.documentId}: identity drift`);
      }
  }
  if (record.contentType === "api::experience.experience") {
    const expectedTitle = EXPECTED_RU_TITLES.get(record.identity.value);
    if (record.fields.title !== expectedTitle)
      blockers.push(
        `${record.identity.value}: RU title differs from owner map`,
      );
    const strings = walkStrings(record.fields);
    for (const title of EN_TITLE_PATTERNS) {
      if (strings.some(({ value }) => value.includes(title)))
        blockers.push(
          `${record.identity.value}: English title leakage: ${title}`,
        );
    }
    for (const field of record.omittedExperienceFields) {
      if (Object.hasOwn(record.fields, field))
        blockers.push(
          `${record.identity.value}: omitted field present: ${field}`,
        );
    }
    if (record.identity.value === "silk-road-istanbul") {
      const all = strings.map(({ value }) => value).join("\n");
      for (const pattern of SILK_PROHIBITED)
        if (pattern.test(all))
          blockers.push(`silk-road-istanbul: prohibited claim ${pattern}`);
      for (const required of [
        "обычному маршруту",
        "входные билеты включены",
        "на языке гостей",
        "встречи с выбранными мастерами",
      ]) {
        if (!all.toLocaleLowerCase("ru-RU").includes(required))
          blockers.push(
            `silk-road-istanbul: required factual contract missing: ${required}`,
          );
      }
    }
    const enDraft = enRows.find((row) => !row.published_at);
    for (const [field, translated] of Object.entries(record.fields)) {
      if (enDraft[field] == null || translated == null) continue;
      const enNumbers = extractNumbers(enDraft[field]);
      const ruNumbers = extractNumbers(translated);
      if (stableHash(enNumbers) !== stableHash(ruNumbers)) {
        warnings.push(
          `${record.identity.value}.${field}: numeric-token parity differs (${enNumbers.join(",")} -> ${ruNumbers.join(",")})`,
        );
      }
    }
  }
  for (const { path: fieldPath, value } of walkStrings(record.fields)) {
    const rootField = fieldPath.split(".")[0];
    if (
      !NON_EDITORIAL_TEXT_FIELDS.has(rootField) &&
      value.length >= 20 &&
      !/[А-Яа-яЁё]/u.test(value)
    ) {
      blockers.push(
        `${record.documentId}.${fieldPath}: localized editorial text has no Cyrillic content`,
      );
    }
  }
}

function validateLengths(record, schema, blockers, counters) {
  for (const [field, value] of Object.entries(record.fields)) {
    const attribute = schema.attributes[field];
    if (!attribute) {
      blockers.push(`${record.documentId}: unknown field ${field}`);
      continue;
    }
    if (typeof value === "string") {
      counters.values += 1;
      if (attribute.maxLength && value.length > attribute.maxLength) {
        blockers.push(
          `${record.documentId}.${field}: ${value.length}/${attribute.maxLength}`,
        );
      }
    }
    for (const leaf of walkStrings(value, field)) {
      counters.leaves += 1;
      if (leaf.value.length > 100000)
        blockers.push(`${record.documentId}.${leaf.path}: unreasonable length`);
    }
  }
  for (const [field, attribute] of Object.entries(schema.attributes)) {
    const suppliedSeparately =
      ["slug", "key"].includes(field) ||
      ["media", "relation"].includes(attribute.type);
    if (
      attribute.required &&
      !suppliedSeparately &&
      !Object.hasOwn(record.fields, field) &&
      !Object.hasOwn(record.sharedFields, field)
    ) {
      blockers.push(
        `${record.documentId}: required field absent from RU payload: ${field}`,
      );
    }
  }
}

async function readAllTables(client) {
  const names = (
    await client.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((row) => row.tablename);
  const tables = {};
  for (const table of names) {
    const safe = table.replace(/"/g, '""');
    tables[table] = (
      await client.query(`SELECT * FROM "${safe}" ORDER BY id`)
    ).rows;
  }
  return tables;
}

function validateState(payload, tables) {
  const blockers = [];
  const warnings = [];
  const counters = { values: 0, leaves: 0 };
  const localeCodes = tables.i18n_locale.map((row) => row.code).sort();
  if (stableHash(localeCodes) !== stableHash(["en", "ru-RU", "tr-TR", "zh-CN"]))
    blockers.push(`locale set differs: ${localeCodes}`);
  if (
    tables.i18n_locale.filter((row) => row.code === TARGET_LOCALE).length !== 1
  )
    blockers.push("ru-RU locale count differs");
  const defaultLocale = tables.strapi_core_store_settings.find(
    (row) => row.key === "plugin_i18n_default_locale",
  );
  if (!defaultLocale || defaultLocale.value !== '"en"')
    blockers.push("default locale differs from en");
  for (const [table, expectedHash] of Object.entries(
    payload.baseline.protectedTableHashes,
  )) {
    if (!tables[table] || stableHash(tables[table]) !== expectedHash)
      blockers.push(`protected baseline drift: ${table}`);
  }
  for (const record of payload.records) {
    validateRecordPayload(record, tables, blockers, warnings);
    const schema = JSON.parse(
      fs.readFileSync(path.join(ROOT, record.schema), "utf8"),
    );
    validateLengths(record, schema, blockers, counters);
  }
  if (tables.insights.some((row) => row.locale === TARGET_LOCALE))
    blockers.push("RU Insight exists unexpectedly");
  const categoryText = payload.records
    .filter(
      (record) =>
        record.contentType ===
        "api::experience-category-page.experience-category-page",
    )
    .flatMap((record) => walkStrings(record.fields).map(({ value }) => value))
    .join("\n");
  for (const token of ["SIGNATURE™", "LAB™", "BLACK™"])
    if (!categoryText.includes(token))
      blockers.push(`protected category token missing: ${token}`);
  return { blockers, warnings, counters };
}

function projection(payload) {
  const byType = Object.fromEntries(
    Object.keys(TABLES_BY_UID).map((uid) => [
      uid,
      payload.records.filter((record) => record.contentType === uid).length,
    ]),
  );
  let fieldValues = 0;
  let mediaRelations = 0;
  let destinationRelations = 0;
  let relatedExperienceRelations = 0;
  let ontologyRelations = 0;
  for (const record of payload.records) {
    fieldValues +=
      Object.keys(record.fields).length +
      Object.keys(record.sharedFields).length +
      (record.identity ? 1 : 0);
    mediaRelations += record.media.length * 2;
    if (record.relations.draft) {
      destinationRelations +=
        record.relations.draft.destination.length +
        record.relations.published.destination.length;
      relatedExperienceRelations +=
        record.relations.draft.relatedExperiences.length +
        record.relations.published.relatedExperiences.length;
      ontologyRelations += [record.relations.draft, record.relations.published]
        .flatMap((relations) => Object.values(relations.ontology))
        .reduce((sum, items) => sum + items.length, 0);
    }
  }
  return {
    byType,
    families: payload.records.length,
    draftCreates: payload.records.length,
    draftUpdates: 0,
    publications: payload.records.length,
    physicalContentRowsAdded: payload.records.length * 2,
    fieldValuesPerLocalization: fieldValues,
    mediaRelationRowsProjected: mediaRelations,
    destinationRelationRowsProjected: destinationRelations,
    relatedExperienceRelationRowsProjected: relatedExperienceRelations,
    ontologyRelationRowsProjected: ontologyRelations,
    insightRelationsProjected: 0,
  };
}

function expectedPostApplyCounts(payload) {
  const counts = { ...payload.baseline.counts };
  for (const [uid, table] of Object.entries(TABLES_BY_UID)) {
    counts[table] +=
      payload.records.filter((record) => record.contentType === uid).length * 2;
  }
  counts.files_related_mph += payload.records.reduce(
    (sum, record) => sum + record.media.length * 2,
    0,
  );
  const experiences = payload.records.filter(
    (record) => record.contentType === "api::experience.experience",
  );
  counts.experiences_destination_lnk += experiences.reduce(
    (sum, record) =>
      sum +
      record.relations.draft.destination.length +
      record.relations.published.destination.length,
    0,
  );
  counts.experiences_related_experiences_lnk += experiences.reduce(
    (sum, record) =>
      sum +
      record.relations.draft.relatedExperiences.length +
      record.relations.published.relatedExperiences.length,
    0,
  );
  for (const [field, config] of Object.entries(ONTOLOGY_RELATIONS)) {
    counts[config.table] += experiences.reduce(
      (sum, record) =>
        sum +
        record.relations.draft.ontology[field].length +
        record.relations.published.ontology[field].length,
      0,
    );
  }
  return counts;
}

function buildDocumentData(record) {
  const data = { ...record.sharedFields, ...record.fields };
  if (record.identity) data[record.identity.field] = record.identity.value;
  const byField = new Map();
  for (const media of record.media) {
    if (!byField.has(media.field)) byField.set(media.field, []);
    byField.get(media.field).push(media.fileId);
  }
  for (const [field, ids] of byField)
    data[field] = field === "gallery" ? ids : ids[0];
  for (const field of record.omittedExperienceFields) delete data[field];
  return data;
}

async function applyDocuments(strapi, payload, summary) {
  const ordered = [
    "api::destination.destination",
    "api::experience-category-page.experience-category-page",
    "api::experience-landing.experience-landing",
    "api::cultural-world-page.cultural-world-page",
    "api::experience.experience",
  ];
  for (const uid of ordered) {
    const service = strapi.documents(uid);
    for (const record of payload.records.filter(
      (item) => item.contentType === uid,
    )) {
      const existing = await service.findOne({
        documentId: record.documentId,
        locale: TARGET_LOCALE,
        status: "draft",
      });
      if (existing)
        throw new Error(
          `Unexpected RU draft during apply: ${record.documentId}`,
        );
      const data = buildDocumentData(record);
      if (uid === "api::experience.experience") {
        const relation = record.relations.draft;
        data.destination = relation.destination[0]?.documentId || null;
        data.related_experiences = { set: [] };
        data.related_insights = { set: [] };
        data.insights = { set: [] };
      }
      await service.update({
        documentId: record.documentId,
        locale: TARGET_LOCALE,
        data,
      });
      summary.draftsCreated += 1;
    }
  }
  const experienceService = strapi.documents("api::experience.experience");
  for (const record of payload.records.filter(
    (item) => item.contentType === "api::experience.experience",
  )) {
    await experienceService.update({
      documentId: record.documentId,
      locale: TARGET_LOCALE,
      data: {
        related_experiences: {
          set: record.relations.draft.relatedExperiences.map(
            ({ documentId }) => ({ documentId }),
          ),
        },
      },
    });
  }
  for (const uid of ordered) {
    const service = strapi.documents(uid);
    for (const record of payload.records.filter(
      (item) => item.contentType === uid,
    )) {
      await service.publish({
        documentId: record.documentId,
        locale: TARGET_LOCALE,
      });
      summary.publications += 1;
    }
  }
}

async function getRuRowsByStatus(trx, table, documentId) {
  const rows = await trx(table)
    .where({ document_id: documentId, locale: TARGET_LOCALE })
    .select("*");
  return new Map(rows.map((row) => [statusOf(row), row]));
}

async function replaceExperienceRelations(trx, payload) {
  const experiences = payload.records.filter(
    (record) => record.contentType === "api::experience.experience",
  );
  for (const record of experiences) {
    const rowsByStatus = await getRuRowsByStatus(
      trx,
      "experiences",
      record.documentId,
    );
    for (const status of ["draft", "published"]) {
      const row = rowsByStatus.get(status);
      if (!row)
        throw new Error(
          `Missing RU ${status} Experience row: ${record.documentId}`,
        );
      const relation = record.relations[status];

      await trx("experiences_destination_lnk")
        .where({ experience_id: row.id })
        .delete();
      for (const item of relation.destination) {
        const target = (
          await getRuRowsByStatus(trx, "destinations", item.documentId)
        ).get(status);
        if (!target)
          throw new Error(
            `Missing RU ${status} Destination target: ${item.documentId}`,
          );
        await trx("experiences_destination_lnk").insert({
          experience_id: row.id,
          destination_id: target.id,
          experience_ord: item.order,
        });
      }

      await trx("experiences_related_experiences_lnk")
        .where({ experience_id: row.id })
        .delete();
      for (const item of relation.relatedExperiences) {
        const target = (
          await getRuRowsByStatus(trx, "experiences", item.documentId)
        ).get(status);
        if (!target)
          throw new Error(
            `Missing RU ${status} related Experience target: ${item.documentId}`,
          );
        await trx("experiences_related_experiences_lnk").insert({
          experience_id: row.id,
          inv_experience_id: target.id,
          experience_ord: item.order,
        });
      }

      await trx("experiences_insights_lnk")
        .where({ experience_id: row.id })
        .delete();
      await trx("experiences_related_insights_lnk")
        .where({ experience_id: row.id })
        .delete();
      for (const [field, config] of Object.entries(ONTOLOGY_RELATIONS)) {
        await trx(config.table).where({ experience_id: row.id }).delete();
        for (const item of relation.ontology[field]) {
          await trx(config.table).insert({
            experience_id: row.id,
            [config.targetColumn]: item.sourceTargetId,
          });
        }
      }
    }
  }
}

async function assertAppliedProjection(trx, payload) {
  const expectedCounts = expectedPostApplyCounts(payload);
  for (const [table, count] of Object.entries(expectedCounts)) {
    const result = await trx(table).count({ count: "*" }).first();
    if (Number(result.count) !== count)
      throw new Error(
        `${table}: expected ${count} rows after apply, found ${result.count}`,
      );
  }

  for (const record of payload.records) {
    const rowsByStatus = await getRuRowsByStatus(
      trx,
      record.table,
      record.documentId,
    );
    if (
      rowsByStatus.size !== 2 ||
      !rowsByStatus.has("draft") ||
      !rowsByStatus.has("published")
    ) {
      throw new Error(
        `RU draft/published pair incomplete: ${record.documentId}`,
      );
    }
    for (const [status, row] of rowsByStatus) {
      if (row.locale !== TARGET_LOCALE)
        throw new Error(`${record.documentId}:${status}: locale mismatch`);
      if ((status === "draft") !== !row.published_at)
        throw new Error(
          `${record.documentId}:${status}: publication state mismatch`,
        );
      if (
        record.identity &&
        row[record.identity.field] !== record.identity.value
      ) {
        throw new Error(`${record.documentId}:${status}: identity changed`);
      }
      for (const [field, expected] of Object.entries({
        ...record.sharedFields,
        ...record.fields,
      })) {
        if (stableHash(row[field]) !== stableHash(expected))
          throw new Error(
            `${record.documentId}:${status}: field mismatch: ${field}`,
          );
      }
      for (const field of record.omittedExperienceFields) {
        if (row[field] != null)
          throw new Error(
            `${record.documentId}:${status}: omitted field populated: ${field}`,
          );
      }
      const mediaFields = [...new Set(record.media.map((item) => item.field))];
      const media = mediaFields.length
        ? await trx("files_related_mph")
            .where({ related_id: row.id, related_type: record.contentType })
            .whereIn("field", mediaFields)
            .select("file_id", "field", "order")
            .orderBy("field")
            .orderBy("order")
        : [];
      const expectedMedia = record.media
        .map(({ fileId, field, order }) => ({ file_id: fileId, field, order }))
        .sort((a, b) => a.field.localeCompare(b.field) || a.order - b.order);
      if (stableHash(media) !== stableHash(expectedMedia))
        throw new Error(
          `${record.documentId}:${status}: media relation mismatch`,
        );
    }
  }

  for (const record of payload.records.filter(
    (item) => item.contentType === "api::experience.experience",
  )) {
    const rowsByStatus = await getRuRowsByStatus(
      trx,
      "experiences",
      record.documentId,
    );
    for (const status of ["draft", "published"]) {
      const row = rowsByStatus.get(status);
      const relation = record.relations[status];
      const destinations = await trx("experiences_destination_lnk")
        .where({ experience_id: row.id })
        .select("destination_id", "experience_ord")
        .orderBy("experience_ord");
      const expectedDestinations = [];
      for (const item of relation.destination) {
        const target = (
          await getRuRowsByStatus(trx, "destinations", item.documentId)
        ).get(status);
        expectedDestinations.push({
          destination_id: target.id,
          experience_ord: item.order,
        });
      }
      if (stableHash(destinations) !== stableHash(expectedDestinations))
        throw new Error(`${record.documentId}:${status}: destination mismatch`);

      const related = await trx("experiences_related_experiences_lnk")
        .where({ experience_id: row.id })
        .select("inv_experience_id", "experience_ord")
        .orderBy("experience_ord");
      const expectedRelated = [];
      for (const item of relation.relatedExperiences) {
        const target = (
          await getRuRowsByStatus(trx, "experiences", item.documentId)
        ).get(status);
        expectedRelated.push({
          inv_experience_id: target.id,
          experience_ord: item.order,
        });
      }
      if (stableHash(related) !== stableHash(expectedRelated))
        throw new Error(
          `${record.documentId}:${status}: related Experience mismatch`,
        );

      for (const [field, config] of Object.entries(ONTOLOGY_RELATIONS)) {
        const actual = await trx(config.table)
          .where({ experience_id: row.id })
          .pluck(config.targetColumn);
        const expected = relation.ontology[field].map(
          (item) => item.sourceTargetId,
        );
        if (
          stableHash(actual.sort((a, b) => a - b)) !==
          stableHash(expected.sort((a, b) => a - b))
        ) {
          throw new Error(`${record.documentId}:${status}: ${field} mismatch`);
        }
      }
      const insights = await trx("experiences_insights_lnk")
        .where({ experience_id: row.id })
        .count({ count: "*" })
        .first();
      const relatedInsights = await trx("experiences_related_insights_lnk")
        .where({ experience_id: row.id })
        .count({ count: "*" })
        .first();
      if (Number(insights.count) || Number(relatedInsights.count))
        throw new Error(
          `${record.documentId}:${status}: RU Insight relation exists`,
        );
    }
  }
}

async function runDryRun(options, payload) {
  const connectionString =
    process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("Production PostgreSQL URL is required.");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  let report;
  try {
    const readOnly = (
      await client.query(
        "SELECT current_setting('transaction_read_only') AS value",
      )
    ).rows[0].value;
    const before = await readAllTables(client);
    const validation = validateState(payload, before);
    const after = await readAllTables(client);
    const changed = Object.keys(before).filter(
      (table) => stableHash(before[table]) !== stableHash(after[table]),
    );
    await client.query("ROLLBACK");
    report = {
      migration: "ru-v5-localizations",
      mode: "DRY_RUN",
      transactionReadOnly: readOnly,
      rolledBack: true,
      writeAttempted: false,
      payloadSha256: fileHash(PAYLOAD_PATH),
      backupManifestSha256: fileHash(
        path.join(options.backupDir, "SHA256SUMS"),
      ),
      projection: projection(payload),
      lengthValuesChecked: validation.counters.values,
      nestedTextLeavesChecked: validation.counters.leaves,
      warnings: validation.warnings,
      blockerCount: validation.blockers.length,
      blockers: validation.blockers,
      transactionTableChanges: changed,
    };
    if (readOnly !== "on" || changed.length || validation.blockers.length)
      process.exitCode = 2;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
  return report;
}

async function runApply(options, payload) {
  if (options.confirmation !== APPLY_CONFIRMATION)
    throw new Error("Exact production confirmation is required.");
  if (process.env.NODE_ENV !== "production")
    throw new Error("NODE_ENV must be production.");
  const { compileStrapi, createStrapi } = require("@strapi/strapi");
  const dirs = await compileStrapi();
  const strapi = createStrapi(dirs);
  const summary = {
    migration: "ru-v5-localizations",
    mode: "APPLY",
    draftsCreated: 0,
    publications: 0,
    transactionCommitted: false,
  };
  try {
    await strapi.load();
    await strapi.db.transaction(async ({ trx }) => {
      const before = {};
      for (const [table, expectedHash] of Object.entries(
        payload.baseline.protectedTableHashes,
      )) {
        before[table] = await trx(table).select("*").orderBy("id");
        if (stableHash(before[table]) !== expectedHash)
          throw new Error(`Protected baseline drift: ${table}`);
      }
      await applyDocuments(strapi, payload, summary);
      await replaceExperienceRelations(trx, payload);
      await assertAppliedProjection(trx, payload);
      for (const [table, rows] of Object.entries(before)) {
        const protectedIds = rows.map((row) => row.id);
        const after = protectedIds.length
          ? await trx(table)
              .whereIn("id", protectedIds)
              .select("*")
              .orderBy("id")
          : [];
        if (stableHash(after) !== stableHash(rows))
          throw new Error(`Existing protected rows changed: ${table}`);
      }
      const ruInsights = await trx("insights")
        .where({ locale: TARGET_LOCALE })
        .count({ count: "*" })
        .first();
      if (Number(ruInsights.count) !== 0)
        throw new Error("RU Insights changed unexpectedly.");
    });
    summary.transactionCommitted = true;
  } finally {
    try {
      await strapi.destroy();
    } catch (error) {
      summary.cleanupWarning = error.message;
    }
  }
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
  if (
    path.resolve(options.backupDir) !== path.resolve(payload.metadata.backupDir)
  )
    throw new Error("Backup path differs from payload.");
  if (
    fileHash(path.join(options.backupDir, "SHA256SUMS")) !==
    payload.metadata.backupManifestSha256
  )
    throw new Error("Backup manifest hash differs.");
  if (
    fileHash(payload.metadata.sourcePackage) !==
    payload.metadata.sourcePackageSha256
  )
    throw new Error("RU V5 package hash differs.");
  const report =
    options.mode === "dry-run"
      ? await runDryRun(options, payload)
      : await runApply(options, payload);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.resultPath) {
    fs.writeFileSync(options.resultPath, text, { mode: 0o600 });
    fs.chmodSync(options.resultPath, 0o600);
  }
  process.stdout.write(text);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertAppliedProjection,
  buildDocumentData,
  expectedPostApplyCounts,
  extractNumbers,
  parseArgs,
  projection,
  replaceExperienceRelations,
  stableHash,
  validateState,
  walkStrings,
};
