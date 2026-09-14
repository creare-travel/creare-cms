"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const PAYLOAD_PATH = path.join(ROOT, "src/migrations/ru-v5-localizations.json");
const TARGET_LOCALE = "ru-RU";
const APPLY_CONFIRMATION = "CREARE_RU_V5_LOCALIZATIONS";
const LOCALIZATION_STATES = ["draft", "published"];
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

const INTEGER_DATABASE_TYPES = new Set(["smallint", "integer", "bigint"]);
const NUMERIC_DATABASE_TYPES = new Set([
  "numeric",
  "decimal",
  "real",
  "double precision",
]);
const JSON_DATABASE_TYPES = new Set(["json", "jsonb"]);
const TIMESTAMP_WITHOUT_TIME_ZONE = "timestamp without time zone";
const PROTECTED_BASELINE_VALIDATOR_ID = "canonical-protected-baseline-v2";

function loadCertifiedBaseline(backupDir) {
  return {
    tables: JSON.parse(
      fs.readFileSync(
        path.join(backupDir, "db/all-production-tables.json"),
        "utf8",
      ),
    ).tables,
    schema: JSON.parse(
      fs.readFileSync(path.join(backupDir, "db/schema-metadata.json"), "utf8"),
    ),
  };
}

function databaseColumnMap(schema) {
  return new Map(
    schema.columns.map((column) => [
      `${column.table_name}.${column.column_name}`,
      column,
    ]),
  );
}

function databasePrimaryKeyMap(schema) {
  const primaryKeys = new Map();
  for (const constraint of schema.constraints || []) {
    const match = /^PRIMARY KEY \((.+)\)$/u.exec(constraint.definition || "");
    if (!match) continue;
    const columns = match[1]
      .split(",")
      .map((column) => column.trim().replace(/^"|"$/gu, ""));
    primaryKeys.set(constraint.table_name, columns);
  }
  return primaryKeys;
}

function parseJsonContainer(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (
    !(
      (text.startsWith("{") && text.endsWith("}")) ||
      (text.startsWith("[") && text.endsWith("]"))
    )
  ) {
    return value;
  }
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function timestampMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function inferTimestampRepresentationOffset(
  expectedTables,
  currentTables,
  columns,
) {
  const deltas = new Map();
  let sampleCount = 0;
  for (const [table, expectedRows] of Object.entries(expectedTables)) {
    const currentRows = currentTables[table];
    if (!currentRows) continue;
    const currentById = new Map(
      currentRows.map((row) => [String(row.id), row]),
    );
    for (const expected of expectedRows) {
      const current = currentById.get(String(expected.id));
      if (!current) continue;
      for (const [columnName, expectedValue] of Object.entries(expected)) {
        const metadata = columns.get(`${table}.${columnName}`);
        if (metadata?.data_type !== TIMESTAMP_WITHOUT_TIME_ZONE) continue;
        const currentValue = current[columnName];
        const representationDiffers =
          expectedValue instanceof Date !== currentValue instanceof Date;
        if (!representationDiffers) continue;
        const expectedMs = timestampMilliseconds(expectedValue);
        const currentMs = timestampMilliseconds(currentValue);
        if (expectedMs == null || currentMs == null) continue;
        const delta = currentMs - expectedMs;
        deltas.set(delta, (deltas.get(delta) || 0) + 1);
        sampleCount += 1;
      }
    }
  }
  const ranked = [...deltas.entries()].sort(
    (left, right) =>
      right[1] - left[1] || Math.abs(left[0]) - Math.abs(right[0]),
  );
  const [candidate = 0, dominantCount = 0] = ranked[0] || [];
  const credible =
    candidate === 0 ||
    (sampleCount >= 10 &&
      dominantCount / sampleCount >= 0.9 &&
      Math.abs(candidate) <= 14 * 60 * 60 * 1000 &&
      candidate % (15 * 60 * 1000) === 0);
  return {
    offsetMs: credible ? candidate : 0,
    sampleCount,
    dominantCount,
    distinctDeltaCount: deltas.size,
    credible,
  };
}

function normalizeInteger(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string" && /^[-+]?\d+$/u.test(value)) {
    try {
      return BigInt(value).toString();
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeNumeric(value) {
  if (typeof value !== "string" && typeof value !== "number") return value;
  const text = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(text);
  if (!match) return value;
  const sign = match[1] === "-" ? "-" : "";
  const whole = match[2];
  const fraction = match[3] || "";
  const exponent = Number(match[4] || 0);
  const digits = `${whole}${fraction}`;
  const decimalAt = whole.length + exponent;
  let normalized;
  if (decimalAt <= 0) normalized = `0.${"0".repeat(-decimalAt)}${digits}`;
  else if (decimalAt >= digits.length)
    normalized = `${digits}${"0".repeat(decimalAt - digits.length)}`;
  else normalized = `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  const [integerPart, fractionPart = ""] = normalized.split(".");
  const canonicalInteger = integerPart.replace(/^0+(?=\d)/u, "") || "0";
  const canonicalFraction = fractionPart.replace(/0+$/u, "");
  const magnitude = canonicalFraction
    ? `${canonicalInteger}.${canonicalFraction}`
    : canonicalInteger;
  return magnitude === "0" ? "0" : `${sign}${magnitude}`;
}

function canonicalSemanticValue(value, metadata, side, timestampOffsetMs) {
  if (value == null) return value;
  if (metadata?.data_type?.startsWith("timestamp")) {
    const milliseconds = timestampMilliseconds(value);
    if (milliseconds == null) return canonical(value);
    const adjusted =
      side === "expected" && metadata.data_type === TIMESTAMP_WITHOUT_TIME_ZONE
        ? milliseconds + timestampOffsetMs
        : milliseconds;
    return { $timestamp: new Date(adjusted).toISOString() };
  }
  if (JSON_DATABASE_TYPES.has(metadata?.data_type)) {
    return { $json: canonical(parseJsonContainer(value)) };
  }
  if (INTEGER_DATABASE_TYPES.has(metadata?.data_type)) {
    return { $integer: normalizeInteger(value) };
  }
  if (NUMERIC_DATABASE_TYPES.has(metadata?.data_type)) {
    return { $numeric: normalizeNumeric(value) };
  }
  return canonical(value);
}

function databaseFieldValuesSemanticallyEqual(
  table,
  field,
  expected,
  actual,
  schema,
) {
  const metadata = databaseColumnMap(schema).get(`${table}.${field}`);
  if (!metadata) {
    throw new Error(`Database schema metadata missing: ${table}.${field}`);
  }
  const expectedSemantic = canonicalSemanticValue(
    expected,
    metadata,
    "current",
    0,
  );
  const actualSemantic = canonicalSemanticValue(actual, metadata, "current", 0);
  return stableHash(expectedSemantic) === stableHash(actualSemantic);
}

function databaseRowsSemanticallyEqual(table, expected, actual, schema) {
  const comparison = buildSemanticComparison(
    { [table]: expected },
    { [table]: actual },
    schema,
  );
  return comparison.compare(table, expected, actual).equal;
}

function semanticTableRows(
  rows,
  table,
  columns,
  primaryKeys,
  side,
  timestampOffsetMs,
) {
  const canonicalRows = rows.map((row) =>
    Object.fromEntries(
      Object.keys(row)
        .sort()
        .map((columnName) => [
          columnName,
          canonicalSemanticValue(
            row[columnName],
            columns.get(`${table}.${columnName}`),
            side,
            timestampOffsetMs,
          ),
        ]),
    ),
  );
  const configuredIdentityColumns = primaryKeys.get(table) || [];
  const identityColumns =
    configuredIdentityColumns.length &&
    canonicalRows.every((row) =>
      configuredIdentityColumns.every(
        (column) => Object.hasOwn(row, column) && row[column] != null,
      ),
    )
      ? configuredIdentityColumns
      : canonicalRows.every((row) => row.id != null)
        ? ["id"]
        : [];
  return canonicalRows.sort((left, right) => {
    const leftIdentity = identityColumns.length
      ? identityColumns.map((column) => left[column])
      : left;
    const rightIdentity = identityColumns.length
      ? identityColumns.map((column) => right[column])
      : right;
    return JSON.stringify(leftIdentity).localeCompare(
      JSON.stringify(rightIdentity),
      "en",
      { numeric: true },
    );
  });
}

function buildSemanticComparison(expectedTables, currentTables, schema) {
  const columns = databaseColumnMap(schema);
  const primaryKeys = databasePrimaryKeyMap(schema);
  const timestampProfile = inferTimestampRepresentationOffset(
    expectedTables,
    currentTables,
    columns,
  );
  const compare = (table, expectedRows, currentRows) => {
    const expectedSemantic = semanticTableRows(
      expectedRows,
      table,
      columns,
      primaryKeys,
      "expected",
      timestampProfile.offsetMs,
    );
    const currentSemantic = semanticTableRows(
      currentRows,
      table,
      columns,
      primaryKeys,
      "current",
      timestampProfile.offsetMs,
    );
    return {
      equal: stableHash(expectedSemantic) === stableHash(currentSemantic),
      rawEqual: stableHash(expectedRows) === stableHash(currentRows),
      expectedHash: stableHash(expectedSemantic),
      currentHash: stableHash(currentSemantic),
    };
  };
  return { compare, timestampProfile };
}

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

function validateRecordPayload(
  record,
  tables,
  certifiedTables,
  semanticComparison,
  blockers,
  warnings,
) {
  const rows = tables[record.table].filter(
    (row) => row.document_id === record.documentId,
  );
  const certifiedRows = certifiedTables[record.table].filter(
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
  const certifiedProtectedFamily = certifiedRows.filter((row) =>
    ["en", "tr-TR", "zh-CN"].includes(row.locale),
  );
  const currentProtectedFamily = rows.filter((row) =>
    ["en", "tr-TR", "zh-CN"].includes(row.locale),
  );
  if (stableHash(certifiedProtectedFamily) !== record.protectedFamilyHash) {
    blockers.push(
      `${record.documentId}: certified protected family integrity mismatch`,
    );
  }
  if (
    !semanticComparison.compare(
      record.table,
      certifiedProtectedFamily,
      currentProtectedFamily,
    ).equal
  ) {
    blockers.push(`${record.documentId}: protected EN/TR/ZH family drift`);
  }
  for (const source of record.sourceRows) {
    const certified = certifiedRows.find(
      (row) =>
        row.locale === "en" &&
        row.id === source.id &&
        statusOf(row) === source.status,
    );
    if (!certified || stableHash(certified) !== source.hash) {
      blockers.push(
        `${record.documentId}:${source.status}: certified EN source integrity mismatch`,
      );
      continue;
    }
    const actual = enRows.filter((row) => statusOf(row) === source.status);
    if (
      actual.length !== 1 ||
      !semanticComparison.compare(record.table, [certified], actual).equal
    ) {
      blockers.push(`${record.documentId}:${source.status}: EN source drift`);
    }
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

function validateState(
  payload,
  tables,
  certifiedBaseline = loadCertifiedBaseline(payload.metadata.backupDir),
) {
  const blockers = [];
  const warnings = [];
  const counters = { values: 0, leaves: 0 };
  const semanticComparison = buildSemanticComparison(
    certifiedBaseline.tables,
    tables,
    certifiedBaseline.schema,
  );
  const representationNormalizedTables = [];
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
    const certifiedRows = certifiedBaseline.tables[table];
    const currentRows = tables[table];
    if (!certifiedRows || stableHash(certifiedRows) !== expectedHash) {
      blockers.push(`certified backup integrity mismatch: ${table}`);
      continue;
    }
    if (!currentRows) {
      blockers.push(`protected baseline table missing: ${table}`);
      continue;
    }
    const comparison = semanticComparison.compare(
      table,
      certifiedRows,
      currentRows,
    );
    if (!comparison.equal) {
      blockers.push(`protected baseline drift: ${table}`);
    } else if (!comparison.rawEqual) {
      representationNormalizedTables.push(table);
    }
  }
  for (const record of payload.records) {
    validateRecordPayload(
      record,
      tables,
      certifiedBaseline.tables,
      semanticComparison,
      blockers,
      warnings,
    );
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
  return {
    blockers,
    warnings,
    counters,
    representationDiagnostics: {
      timestampProfile: semanticComparison.timestampProfile,
      normalizedTableCount: representationNormalizedTables.length,
      normalizedTables: representationNormalizedTables,
      rawRepresentationDiffers: representationNormalizedTables.length > 0,
      canonicalSemanticValuesEqual:
        representationNormalizedTables.length > 0 &&
        !blockers.some((blocker) => blocker.includes("baseline drift")),
    },
  };
}

function validateProtectedBaseline(payload, tables, certifiedBaseline) {
  return validateState(payload, tables, certifiedBaseline);
}

function compareSameQuerySnapshots(before, after, schema) {
  const comparison = buildSemanticComparison(before, after, schema);
  const changedTables = [];
  for (const [table, beforeRows] of Object.entries(before)) {
    const beforeIds = new Set(beforeRows.map((row) => String(row.id)));
    const existingAfterRows = (after[table] || []).filter((row) =>
      beforeIds.has(String(row.id)),
    );
    if (!comparison.compare(table, beforeRows, existingAfterRows).equal) {
      changedTables.push(table);
    }
  }
  return {
    changedTables,
    timestampProfile: comparison.timestampProfile,
  };
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

function componentProjectionForRecord(record) {
  const contentTypeSchema = JSON.parse(
    fs.readFileSync(path.join(ROOT, record.schema), "utf8"),
  );
  const projections = [];
  for (const [field, attribute] of Object.entries(
    contentTypeSchema.attributes,
  )) {
    if (attribute.type !== "component") continue;
    const value = { ...record.sharedFields, ...record.fields }[field];
    const componentCount = attribute.repeatable
      ? Array.isArray(value)
        ? value.length
        : 0
      : value == null
        ? 0
        : 1;
    if (!componentCount) continue;
    const [category, component] = attribute.component.split(".");
    const componentSchema = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "src/components", category, `${component}.json`),
        "utf8",
      ),
    );
    projections.push({
      field,
      componentCount,
      componentType: attribute.component,
      repeatable: Boolean(attribute.repeatable),
      componentSchema,
      componentTable: componentSchema.collectionName,
      linkTable: `${contentTypeSchema.collectionName}_cmps`,
    });
  }
  return projections;
}

function buildExpectedTableDeltaManifest(payload) {
  const manifest = Object.fromEntries(
    Object.entries(payload.baseline.counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([table, baselineCount]) => [
        table,
        {
          baselineCount,
          projectedDelta: 0,
          expectedPostApplyCount: baselineCount,
          sources: [],
        },
      ]),
  );
  const add = (table, count, source) => {
    if (!Object.hasOwn(manifest, table)) {
      throw new Error(`Projected table is absent from baseline: ${table}`);
    }
    manifest[table].projectedDelta += count;
    manifest[table].expectedPostApplyCount += count;
    manifest[table].sources.push(source);
  };

  for (const record of payload.records) {
    add(
      record.table,
      LOCALIZATION_STATES.length,
      `${record.documentId}:localized-content`,
    );
    for (const component of componentProjectionForRecord(record)) {
      const count = component.componentCount * LOCALIZATION_STATES.length;
      const source = `${record.documentId}.${component.field}:component`;
      add(component.componentTable, count, source);
      add(component.linkTable, count, `${source}-link`);
    }
    add(
      "files_related_mph",
      record.media.length * LOCALIZATION_STATES.length,
      `${record.documentId}:media`,
    );
  }

  const experiences = payload.records.filter(
    (record) => record.contentType === "api::experience.experience",
  );
  for (const record of experiences) {
    add(
      "experiences_destination_lnk",
      record.relations.draft.destination.length +
        record.relations.published.destination.length,
      `${record.documentId}:destination`,
    );
    add(
      "experiences_related_experiences_lnk",
      record.relations.draft.relatedExperiences.length +
        record.relations.published.relatedExperiences.length,
      `${record.documentId}:related-experiences`,
    );
  }
  for (const [field, config] of Object.entries(ONTOLOGY_RELATIONS)) {
    for (const record of experiences) {
      add(
        config.table,
        record.relations.draft.ontology[field].length +
          record.relations.published.ontology[field].length,
        `${record.documentId}:${field}`,
      );
    }
  }
  return manifest;
}

function expectedPostApplyCounts(payload) {
  return Object.fromEntries(
    Object.entries(buildExpectedTableDeltaManifest(payload)).map(
      ([table, entry]) => [table, entry.expectedPostApplyCount],
    ),
  );
}

function validateExpectedTableDeltaManifest(payload, tables, manifest) {
  const blockers = [];
  const baselineTables = Object.keys(payload.baseline.counts).sort();
  const currentTables = Object.keys(tables).sort();
  const manifestTables = Object.keys(manifest).sort();
  if (stableHash(manifestTables) !== stableHash(baselineTables)) {
    blockers.push("projection manifest does not cover every baseline table");
  }
  if (stableHash(currentTables) !== stableHash(baselineTables)) {
    blockers.push("current table inventory differs from projection manifest");
  }
  for (const table of baselineTables) {
    if (!manifest[table]) continue;
    const actualCount = tables[table]?.length;
    if (actualCount !== manifest[table].baselineCount) {
      blockers.push(
        `${table}: baseline count ${actualCount} differs from ${manifest[table].baselineCount}`,
      );
    }
  }
  return blockers;
}

function validateProjectedTableCounts(manifest, actualCounts) {
  const blockers = [];
  const expectedTables = Object.keys(manifest).sort();
  const actualTables = Object.keys(actualCounts).sort();
  if (stableHash(actualTables) !== stableHash(expectedTables)) {
    const unexpected = actualTables.filter(
      (table) => !Object.hasOwn(manifest, table),
    );
    const missing = expectedTables.filter(
      (table) => !Object.hasOwn(actualCounts, table),
    );
    if (unexpected.length)
      blockers.push(`unexpected changed table: ${unexpected.join(", ")}`);
    if (missing.length)
      blockers.push(`projected table missing: ${missing.join(", ")}`);
  }
  for (const [table, entry] of Object.entries(manifest)) {
    if (!Object.hasOwn(actualCounts, table)) continue;
    if (actualCounts[table] !== entry.expectedPostApplyCount) {
      blockers.push(
        `${table}: expected ${entry.expectedPostApplyCount} rows after apply, found ${actualCounts[table]}`,
      );
    }
  }
  return blockers;
}

async function readAllTablesWithTransaction(trx) {
  const result = await trx.raw(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const tables = {};
  for (const { tablename } of result.rows) {
    tables[tablename] = await trx(tablename).select("*").orderBy("id");
  }
  return tables;
}

function buildDocumentData(record) {
  const data = { ...record.sharedFields, ...record.fields };
  if (record.identity) data[record.identity.field] = record.identity.value;
  for (const component of componentProjectionForRecord(record)) {
    const sanitize = (item) =>
      Object.fromEntries(
        Object.keys(component.componentSchema.attributes)
          .filter((field) => Object.hasOwn(item, field))
          .map((field) => [field, item[field]]),
      );
    data[component.field] = component.repeatable
      ? data[component.field].map(sanitize)
      : sanitize(data[component.field]);
  }
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

async function assertRecordComponents(trx, record, row, schema) {
  const supplied = { ...record.sharedFields, ...record.fields };
  for (const component of componentProjectionForRecord(record)) {
    const value = supplied[component.field];
    const expectedItems = component.repeatable ? value : [value];
    const links = await trx(component.linkTable)
      .where({ entity_id: row.id, field: component.field })
      .select("cmp_id", "component_type", "field", "order")
      .orderBy("order")
      .orderBy("cmp_id");
    if (links.length !== expectedItems.length) {
      throw new Error(
        `${record.documentId}:${statusOf(row)}: component count mismatch: ${component.field}`,
      );
    }
    for (const [index, expectedItem] of expectedItems.entries()) {
      const link = links[index];
      if (
        link.component_type !== component.componentType ||
        link.field !== component.field ||
        normalizeNumeric(link.order) !== normalizeNumeric(index + 1)
      ) {
        throw new Error(
          `${record.documentId}:${statusOf(row)}: component link mismatch: ${component.field}.${index}`,
        );
      }
      const actualItem = await trx(component.componentTable)
        .where({ id: link.cmp_id })
        .first();
      if (!actualItem) {
        throw new Error(
          `${record.documentId}:${statusOf(row)}: component row missing: ${component.field}.${index}`,
        );
      }
      for (const field of Object.keys(component.componentSchema.attributes)) {
        const expected = Object.hasOwn(expectedItem, field)
          ? expectedItem[field]
          : null;
        if (
          !databaseFieldValuesSemanticallyEqual(
            component.componentTable,
            field,
            expected,
            actualItem[field],
            schema,
          )
        ) {
          throw new Error(
            `${record.documentId}:${statusOf(row)}: component field mismatch: ${component.field}.${index}.${field}`,
          );
        }
      }
    }
  }
}

async function assertAppliedProjection(
  trx,
  payload,
  manifest,
  actualTables,
  schema,
) {
  const actualCounts = Object.fromEntries(
    Object.entries(actualTables).map(([table, rows]) => [table, rows.length]),
  );
  const countBlockers = validateProjectedTableCounts(manifest, actualCounts);
  if (countBlockers.length) throw new Error(countBlockers.join("; "));

  for (const record of payload.records) {
    const contentTypeSchema = JSON.parse(
      fs.readFileSync(path.join(ROOT, record.schema), "utf8"),
    );
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
        const attribute = contentTypeSchema.attributes[field];
        if (!attribute) {
          throw new Error(
            `${record.documentId}:${status}: schema field missing: ${field}`,
          );
        }
        if (attribute.type === "component") continue;
        if (
          !databaseFieldValuesSemanticallyEqual(
            record.table,
            field,
            expected,
            row[field],
            schema,
          )
        ) {
          throw new Error(
            `${record.documentId}:${status}: field mismatch: ${field}`,
          );
        }
      }
      await assertRecordComponents(trx, record, row, schema);
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
      if (
        !databaseRowsSemanticallyEqual(
          "files_related_mph",
          expectedMedia,
          media,
          schema,
        )
      ) {
        throw new Error(
          `${record.documentId}:${status}: media relation mismatch`,
        );
      }
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
      if (
        !databaseRowsSemanticallyEqual(
          "experiences_destination_lnk",
          expectedDestinations,
          destinations,
          schema,
        )
      ) {
        throw new Error(`${record.documentId}:${status}: destination mismatch`);
      }

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
      if (
        !databaseRowsSemanticallyEqual(
          "experiences_related_experiences_lnk",
          expectedRelated,
          related,
          schema,
        )
      ) {
        throw new Error(
          `${record.documentId}:${status}: related Experience mismatch`,
        );
      }

      for (const [field, config] of Object.entries(ONTOLOGY_RELATIONS)) {
        const actual = await trx(config.table)
          .where({ experience_id: row.id })
          .select(config.targetColumn);
        const expected = relation.ontology[field].map((item) => ({
          [config.targetColumn]: item.sourceTargetId,
        }));
        if (
          !databaseRowsSemanticallyEqual(config.table, expected, actual, schema)
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

async function runDryRun(options, payload, certifiedBaseline) {
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
    const validation = validateProtectedBaseline(
      payload,
      before,
      certifiedBaseline,
    );
    const expectedTableDeltaManifest = buildExpectedTableDeltaManifest(payload);
    validation.blockers.push(
      ...validateExpectedTableDeltaManifest(
        payload,
        before,
        expectedTableDeltaManifest,
      ),
    );
    const after = await readAllTables(client);
    const changed = Object.keys(before).filter(
      (table) => stableHash(before[table]) !== stableHash(after[table]),
    );
    await client.query("ROLLBACK");
    report = {
      migration: "ru-v5-localizations",
      mode: "DRY_RUN",
      protectedBaselineValidator: PROTECTED_BASELINE_VALIDATOR_ID,
      transactionReadOnly: readOnly,
      rolledBack: true,
      writeAttempted: false,
      payloadSha256: fileHash(PAYLOAD_PATH),
      backupManifestSha256: fileHash(
        path.join(options.backupDir, "SHA256SUMS"),
      ),
      projection: projection(payload),
      expectedTableDeltaManifest,
      lengthValuesChecked: validation.counters.values,
      nestedTextLeavesChecked: validation.counters.leaves,
      warnings: validation.warnings,
      representationDiagnostics: validation.representationDiagnostics,
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

function isExpectedTarnPoolAbort(error) {
  return (
    error instanceof Error &&
    error.message === "aborted" &&
    /tarn[/\\]dist[/\\](?:PendingOperation|Pool)/u.test(error.stack || "")
  );
}

async function settleEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function destroyStrapiSafely(strapi, summary) {
  const asynchronousFailures = [];
  const captureUnhandledRejection = (reason) => {
    asynchronousFailures.push(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };
  let directFailure = null;
  process.on("unhandledRejection", captureUnhandledRejection);
  try {
    await settleEventLoop();
    await strapi.destroy();
    await settleEventLoop();
  } catch (error) {
    directFailure = error;
    await settleEventLoop();
  } finally {
    process.off("unhandledRejection", captureUnhandledRejection);
  }

  const failures = [
    ...(directFailure ? [directFailure] : []),
    ...asynchronousFailures,
  ];
  const unexpected = failures.find((error) => !isExpectedTarnPoolAbort(error));
  if (unexpected) throw unexpected;
  if (failures.length) {
    summary.cleanupWarning =
      "Strapi closed after an expected Tarn connection-pool abort.";
  }
}

async function runApply(options, payload, certifiedBaseline) {
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
      const before = await readAllTablesWithTransaction(trx);
      const preflight = validateProtectedBaseline(
        payload,
        before,
        certifiedBaseline,
      );
      const expectedTableDeltaManifest =
        buildExpectedTableDeltaManifest(payload);
      preflight.blockers.push(
        ...validateExpectedTableDeltaManifest(
          payload,
          before,
          expectedTableDeltaManifest,
        ),
      );
      if (preflight.blockers.length) {
        throw new Error(
          `Apply preflight blocked: ${preflight.blockers.join("; ")}`,
        );
      }
      await applyDocuments(strapi, payload, summary);
      await replaceExperienceRelations(trx, payload);
      const after = await readAllTablesWithTransaction(trx);
      await assertAppliedProjection(
        trx,
        payload,
        expectedTableDeltaManifest,
        after,
        certifiedBaseline.schema,
      );
      const snapshotComparison = compareSameQuerySnapshots(
        before,
        after,
        certifiedBaseline.schema,
      );
      if (snapshotComparison.changedTables.length) {
        throw new Error(
          `Existing protected rows changed: ${snapshotComparison.changedTables.join(", ")}`,
        );
      }
      const ruInsights = await trx("insights")
        .where({ locale: TARGET_LOCALE })
        .count({ count: "*" })
        .first();
      if (Number(ruInsights.count) !== 0)
        throw new Error("RU Insights changed unexpectedly.");
    });
    summary.transactionCommitted = true;
    summary.protectedBaselineValidator = PROTECTED_BASELINE_VALIDATOR_ID;
  } finally {
    await destroyStrapiSafely(strapi, summary);
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
  const certifiedBaseline = loadCertifiedBaseline(options.backupDir);
  const report =
    options.mode === "dry-run"
      ? await runDryRun(options, payload, certifiedBaseline)
      : await runApply(options, payload, certifiedBaseline);
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
  assertRecordComponents,
  buildExpectedTableDeltaManifest,
  buildSemanticComparison,
  databaseFieldValuesSemanticallyEqual,
  databaseRowsSemanticallyEqual,
  buildDocumentData,
  destroyStrapiSafely,
  expectedPostApplyCounts,
  extractNumbers,
  isExpectedTarnPoolAbort,
  loadCertifiedBaseline,
  normalizeNumeric,
  parseArgs,
  PROTECTED_BASELINE_VALIDATOR_ID,
  projection,
  compareSameQuerySnapshots,
  readAllTablesWithTransaction,
  replaceExperienceRelations,
  runApply,
  runDryRun,
  stableHash,
  validateProtectedBaseline,
  validateExpectedTableDeltaManifest,
  validateProjectedTableCounts,
  validateState,
  walkStrings,
};
