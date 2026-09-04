"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  COMMON_CATEGORY_FIELDS,
  EXPECTED,
  MEDIA_ATTRIBUTE_CONTRACTS,
  SPECIFIC_CATEGORY_FIELDS,
  assertAffectedRowCount,
  buildDestinationOrderPlan,
  buildLengthConstraints,
  canonicalizeDatabaseRows,
  canonicalizeDatabaseValue,
  compareFrozenTableSnapshots,
  countPostgresCharacters,
  documentValuesMatch,
  findBlackProhibitedClaims,
  frozenMutationStatements,
  parseArgs,
  validateCategoryMediaRelations,
  validateDestinationState,
  validateMediaInfrastructure,
  validatePayload,
  validatePlannedFieldLengths,
  validateProjectedCulturalMedia,
  validateSchemaDestinations,
  verifyBackup,
} = require("../migrate-editorial-reconstruction.js");

const ROOT_DIR = path.resolve(__dirname, "../..");
const readJson = (...segments) =>
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, ...segments), "utf8"));
const payload = readJson(
  "src",
  "migrations",
  "editorial-reconstruction-v1.json",
);
const culturalWorldSchema = readJson(
  "src",
  "api",
  "cultural-world-page",
  "content-types",
  "cultural-world-page",
  "schema.json",
);
const categorySchema = readJson(
  "src",
  "api",
  "experience-category-page",
  "content-types",
  "experience-category-page",
  "schema.json",
);

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const schemas = {
  culturalWorlds: {
    tableName: "cultural_world_pages",
    schema: culturalWorldSchema,
  },
  category: {
    tableName: "experience_category_pages",
    schema: categorySchema,
  },
};

const FROZEN_TABLE_FIXTURE = [
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

function frozenFixture(experiences = []) {
  return Object.fromEntries(
    FROZEN_TABLE_FIXTURE.map((table) => [
      table,
      table === "experiences" ? experiences : [],
    ]),
  );
}

function destinationRows() {
  const documentIds = {
    istanbul: "tuzsm8ft9rnsb2pz0pdcgiqc",
    cappadocia: "v97gdhmnxy0t39jq51l2eo11",
    bodrum: "qcmgbt6odv19gs26o203em8v",
  };
  const currentOrder = { istanbul: 1, cappadocia: 3, bodrum: 2 };
  let id = 1;
  return Object.keys(documentIds).flatMap((slug) =>
    EXPECTED.locales.flatMap((locale) =>
      ["draft", "published"].map((status) => ({
        id: id++,
        document_id: documentIds[slug],
        name: `${slug}:${locale}`,
        slug,
        locale,
        published_at:
          status === "published" ? "2026-01-01T00:00:00.000Z" : null,
        order_index: currentOrder[slug],
        updated_at: "2026-01-01T00:00:00.000Z",
      })),
    ),
  );
}

function destinationState(rows = destinationRows()) {
  return {
    rows,
    relations: {
      destinations_cmps: [
        { id: 1, entity_id: 1, cmp_id: 7, field: "sections" },
      ],
      destinations_secondary_experiences_lnk: [],
      experiences_destination_lnk: [
        { id: 1, experience_id: 10, destination_id: 1 },
      ],
      insights_destination_lnk: [{ id: 1, insight_id: 20, destination_id: 1 }],
      destination_media: [
        {
          id: 1,
          file_id: 30,
          related_id: 1,
          related_type: "api::destination.destination",
          field: "cover_image",
          order: 1,
        },
      ],
    },
  };
}

function databaseType(attribute) {
  return {
    string: "character varying",
    text: "text",
    integer: "integer",
    boolean: "boolean",
    date: "date",
    datetime: "timestamp without time zone",
    enumeration: "character varying",
    json: "jsonb",
  }[attribute.type];
}

function makeDatabaseColumns() {
  return Object.fromEntries(
    Object.values(schemas).map((model) => [
      model.tableName,
      Object.fromEntries(
        Object.entries(model.schema.attributes)
          .filter(([, attribute]) => attribute.type !== "media")
          .map(([field, attribute]) => [
            field,
            {
              dataType: databaseType(attribute),
              characterMaximumLength:
                attribute.type === "string" || attribute.type === "enumeration"
                  ? 255
                  : null,
              isNullable: "YES",
            },
          ]),
      ),
    ]),
  );
}

function makeMediaInfrastructure() {
  return {
    filesTable: {
      exists: true,
      tableName: "files",
      columns: ["id", "url", "provider", "provider_metadata"],
    },
    relationTables: [
      {
        tableName: "files_related_mph",
        columns: [
          "id",
          "file_id",
          "related_id",
          "related_type",
          "field",
          "order",
        ],
      },
    ],
  };
}

test("payload locks owner-approved locales, language corrections, and ordering", () => {
  const validation = validatePayload(payload);

  assert.deepEqual(validation.blockers, []);
  assert.deepEqual(payload.locales, ["en", "tr-TR", "zh-CN"]);
  assert.equal(
    payload.categories.signature.locales["tr-TR"].signature_inquiry_title,
    "İlk temastan teyide",
  );
  assert.equal(
    payload.categories.signature.locales["tr-TR"].cta_heading,
    "SIGNATURE™ Deneyiminizi Görüşelim",
  );
  assert.equal(
    payload.categories.lab.locales["tr-TR"].lab_principle_1_title,
    "Netlik",
  );
  assert.deepEqual(payload.destinationOrder, [
    { slug: "istanbul", order_index: 1 },
    { slug: "cappadocia", order_index: 2 },
    { slug: "bodrum", order_index: 3 },
  ]);
  assert.equal(payload.officialExperienceNames.length, 14);
  assert.equal(validation.blackProhibitedClaims.length, 0);
  assert.equal(validation.protectedOldNameMatches.length, 0);
});

test("Cultural Worlds schema is optional, localized, and uses the canonical field name", () => {
  const attributes = culturalWorldSchema.attributes;
  const textFields = Object.entries(attributes).filter(([, attribute]) =>
    ["string", "text"].includes(attribute.type),
  );

  assert.equal(culturalWorldSchema.kind, "singleType");
  assert.equal(culturalWorldSchema.options.draftAndPublish, true);
  assert.equal(culturalWorldSchema.pluginOptions.i18n.localized, true);
  assert.ok(attributes.destination_section_supporting_text);
  assert.equal(attributes.destination_section_support, undefined);
  assert.equal(textFields.length, 16);
  assert.ok(
    textFields.every(
      ([, attribute]) =>
        attribute.pluginOptions?.i18n?.localized === true &&
        attribute.required !== true &&
        Number.isInteger(attribute.maxLength),
    ),
  );
  assert.deepEqual(attributes.hero_image, {
    type: "media",
    multiple: false,
    allowedTypes: ["images"],
  });
});

test("category extension is additive, optional, localized, and non-repeatable", () => {
  const fields = Object.values(SPECIFIC_CATEGORY_FIELDS).flat();

  assert.equal(fields.length, 48);
  assert.equal(new Set(fields).size, 48);
  for (const field of fields) {
    const attribute = categorySchema.attributes[field];
    assert.ok(attribute, `missing category field ${field}`);
    assert.ok(["string", "text"].includes(attribute.type));
    assert.equal(attribute.required, undefined);
    assert.equal(attribute.repeatable, undefined);
    assert.equal(attribute.pluginOptions?.i18n?.localized, true);
    assert.ok(Number.isInteger(attribute.maxLength));
  }

  for (const key of EXPECTED.categoryKeys) {
    const required = [
      ...COMMON_CATEGORY_FIELDS,
      ...SPECIFIC_CATEGORY_FIELDS[key],
    ];
    for (const locale of EXPECTED.locales) {
      assert.deepEqual(
        Object.keys(payload.categories[key].locales[locale]).sort(),
        [...required].sort(),
      );
    }
  }
});

test("length validation uses Unicode code points and catches schema overflow", () => {
  assert.equal(countPostgresCharacters("清晰"), 2);
  assert.equal(countPostgresCharacters("İlk"), 3);

  const schemas = {
    culturalWorlds: {
      tableName: "cultural_world_pages",
      schema: culturalWorldSchema,
    },
    category: {
      tableName: "experience_category_pages",
      schema: categorySchema,
    },
  };
  const constraints = buildLengthConstraints(schemas, {
    cultural_world_pages: {},
    experience_category_pages: {},
  });
  const clean = validatePlannedFieldLengths(payload, constraints);
  assert.equal(clean.lengthConstraintBlockers, 0);
  assert.equal(clean.checkedValues, 528);

  const overflow = structuredClone(payload);
  overflow.culturalWorlds.locales.en.eyebrow = "x".repeat(81);
  const invalid = validatePlannedFieldLengths(overflow, constraints);
  assert.equal(invalid.lengthConstraintBlockers, 2);
  assert.ok(
    invalid.violations.every(
      (violation) =>
        violation.fieldPath === "culturalWorlds.locales.en.eyebrow",
    ),
  );
});

test("BLACK scanner blocks prohibited claims in multilingual content", () => {
  assert.ok(findBlackProhibitedClaims({ body: "Access is granted." }).length);
  assert.ok(findBlackProhibitedClaims({ body: "Yalnızca davetle." }).length);
  assert.ok(findBlackProhibitedClaims({ body: "仅限邀请" }).length);
  assert.deepEqual(
    findBlackProhibitedClaims(payload.categories.black.locales),
    [],
  );
});

test("argument parser requires one mode and an explicit backup", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--backup-dir=/tmp/backup"]), {
    mode: "dry-run",
    backupDir: "/tmp/backup",
  });
  assert.throws(() => parseArgs([]), /Choose exactly one mode/);
  assert.throws(
    () => parseArgs(["--dry-run", "--apply", "--backup-dir=/tmp/backup"]),
    /Choose exactly one mode/,
  );
  assert.throws(
    () => parseArgs(["--dry-run", "--unknown"]),
    /Unknown argument/,
  );
  assert.deepEqual(parseArgs(["--rehearse", "--backup-dir=/tmp/backup"]), {
    mode: "rehearse",
    backupDir: "/tmp/backup",
  });
});

test("database canonicalization accepts equivalent JSON representations", () => {
  const parsed = [
    { id: 1, description: [{ type: "paragraph", children: [] }] },
  ];
  const stringified = [
    { id: "1", description: '[{"children":[],"type":"paragraph"}]' },
  ];
  assert.deepEqual(
    canonicalizeDatabaseRows(parsed),
    canonicalizeDatabaseRows(stringified),
  );
});

test("database canonicalization accepts equivalent timestamps and object key order", () => {
  const date = new Date("2026-09-04T19:55:23.394Z");
  assert.deepEqual(
    canonicalizeDatabaseValue(date, "updated_at"),
    canonicalizeDatabaseValue("2026-09-04T19:55:23.394Z", "updated_at"),
  );
  assert.deepEqual(
    canonicalizeDatabaseValue({ z: 1, a: { y: 2, x: 1 } }),
    canonicalizeDatabaseValue({ a: { x: 1, y: 2 }, z: 1 }),
  );
  assert.deepEqual(
    canonicalizeDatabaseValue("2026-09-04T22:55:23.394+03:00", "updated_at"),
    canonicalizeDatabaseValue("2026-09-04T19:55:23.394Z", "updated_at"),
  );
  assert.notDeepEqual(
    canonicalizeDatabaseValue("2026-09-04T19:55:23.394001Z", "updated_at"),
    canonicalizeDatabaseValue("2026-09-04T19:55:23.394002Z", "updated_at"),
  );
});

test("database canonicalization preserves JSON array order and text whitespace", () => {
  assert.notDeepEqual(
    canonicalizeDatabaseValue(["a", "b"]),
    canonicalizeDatabaseValue(["b", "a"]),
  );
  assert.notDeepEqual(
    canonicalizeDatabaseValue("same text"),
    canonicalizeDatabaseValue("same  text"),
  );
});

test("frozen comparison detects row insertion and deletion", () => {
  const empty = frozenFixture();
  const inserted = frozenFixture([{ id: 1, title: "A" }]);
  assert.equal(
    compareFrozenTableSnapshots(empty, inserted)[0].table,
    "experiences",
  );
  assert.equal(
    compareFrozenTableSnapshots(inserted, empty)[0].table,
    "experiences",
  );
});

test("frozen comparison accepts stable primary-key ordering but detects Experience text mutation", () => {
  const ordered = frozenFixture([
    { id: 1, title: "First" },
    { id: 2, title: "Second" },
  ]);
  const reversed = frozenFixture([
    { id: 2, title: "Second" },
    { id: 1, title: "First" },
  ]);
  const mutated = frozenFixture([
    { id: 1, title: "First changed" },
    { id: 2, title: "Second" },
  ]);
  assert.deepEqual(compareFrozenTableSnapshots(ordered, reversed), []);
  assert.equal(
    compareFrozenTableSnapshots(ordered, mutated)[0].table,
    "experiences",
  );
});

test("frozen comparison detects missing columns, null changes, and numeric changes", () => {
  const before = frozenFixture([
    { id: 1, title: "A", optional: null, priority: 1 },
  ]);
  const missing = frozenFixture([{ id: 1, title: "A", optional: null }]);
  const nullChanged = frozenFixture([
    { id: 1, title: "A", optional: "", priority: 1 },
  ]);
  const numberChanged = frozenFixture([
    { id: 1, title: "A", optional: null, priority: 2 },
  ]);
  assert.equal(compareFrozenTableSnapshots(before, missing).length, 1);
  assert.equal(compareFrozenTableSnapshots(before, nullChanged).length, 1);
  assert.equal(compareFrozenTableSnapshots(before, numberChanged).length, 1);
});

test("frozen comparison detects relation changes", () => {
  const before = frozenFixture();
  const after = frozenFixture();
  before.experiences_destination_lnk = [
    { id: 1, experience_id: 7, destination_id: 3 },
  ];
  after.experiences_destination_lnk = [
    { id: 1, experience_id: 7, destination_id: 4 },
  ];
  assert.equal(
    compareFrozenTableSnapshots(before, after)[0].table,
    "experiences_destination_lnk",
  );
});

test("frozen SQL scanner blocks mutations but permits reads", () => {
  const queries = [
    { sql: 'select * from "experiences" order by "id" asc' },
    { sql: 'update "experiences" set "title" = $1 where "id" = $2' },
    {
      sql: 'insert into "experiences_destination_lnk" ("experience_id") values ($1)',
    },
    { sql: 'update "destinations" set "order_index" = $1' },
  ];
  assert.deepEqual(
    frozenMutationStatements(queries).map(({ sql }) => sql),
    queries.slice(1, 3).map(({ sql }) => sql),
  );
});

test("Destination plan updates only order_index across draft and published locales", () => {
  const plan = buildDestinationOrderPlan(
    destinationRows(),
    payload.destinationOrder,
  );
  assert.equal(plan.targetRows, 18);
  assert.equal(plan.updates.length, 12);
  assert.ok(
    plan.updates.every(
      (update) => Object.keys(update.data).join() === "order_index",
    ),
  );
  assert.deepEqual(
    [...new Set(plan.updates.map((update) => update.status))].sort(),
    ["draft", "published"],
  );
  assert.deepEqual(
    [...new Set(plan.updates.map((update) => update.locale))].sort(),
    [...EXPECTED.locales].sort(),
  );
});

test("Destination plan hard-stops on a missing locale or duplicate identity", () => {
  const missing = destinationRows().filter(
    (row) =>
      !(row.slug === "bodrum" && row.locale === "zh-CN" && !row.published_at),
  );
  assert.throws(
    () => buildDestinationOrderPlan(missing, payload.destinationOrder),
    /row count|Missing Destination identity/,
  );
  const duplicate = destinationRows();
  duplicate[duplicate.length - 1] = { ...duplicate[0], id: 999 };
  assert.throws(
    () => buildDestinationOrderPlan(duplicate, payload.destinationOrder),
    /Duplicate Destination identity/,
  );
});

test("Destination plan hard-stops on document drift and affected-row mismatch", () => {
  const wrongDocument = destinationRows();
  wrongDocument[0].document_id = "wrong";
  assert.throws(
    () => buildDestinationOrderPlan(wrongDocument, payload.destinationOrder),
    /document identity differs/,
  );
  const update = buildDestinationOrderPlan(
    destinationRows(),
    payload.destinationOrder,
  ).updates[0];
  assert.throws(
    () => assertAffectedRowCount([], update),
    /unexpected row count/,
  );
  assert.throws(
    () => assertAffectedRowCount([{ id: update.id }, { id: 999 }], update),
    /unexpected row count/,
  );
  assert.doesNotThrow(() =>
    assertAffectedRowCount([{ id: update.id }], update),
  );
});

test("Destination scalar update preserves content, timestamps, and relation identities", () => {
  const before = destinationState();
  const after = structuredClone(before);
  const desired = new Map(
    payload.destinationOrder.map(({ slug, order_index }) => [
      slug,
      order_index,
    ]),
  );
  for (const row of after.rows) row.order_index = desired.get(row.slug);
  assert.deepEqual(
    validateDestinationState(before, after, payload.destinationOrder),
    [],
  );
  assert.deepEqual(
    before.rows.map(({ name, slug, updated_at }) => ({
      name,
      slug,
      updated_at,
    })),
    after.rows.map(({ name, slug, updated_at }) => ({
      name,
      slug,
      updated_at,
    })),
  );
  assert.deepEqual(before.relations, after.relations);
});

test("Destination validator detects document-service relation churn and genuine relation changes", () => {
  const before = destinationState();
  const after = structuredClone(before);
  const desired = new Map(
    payload.destinationOrder.map(({ slug, order_index }) => [
      slug,
      order_index,
    ]),
  );
  for (const row of after.rows) row.order_index = desired.get(row.slug);
  after.relations.experiences_destination_lnk[0].id = 99;
  assert.match(
    validateDestinationState(before, after, payload.destinationOrder).join(
      " | ",
    ),
    /experiences_destination_lnk/,
  );
  after.relations = structuredClone(before.relations);
  after.relations.destination_media[0].order = 2;
  assert.match(
    validateDestinationState(before, after, payload.destinationOrder).join(
      " | ",
    ),
    /destination_media/,
  );
});

test("Destination validator detects non-order content changes", () => {
  const before = destinationState();
  const after = structuredClone(before);
  const desired = new Map(
    payload.destinationOrder.map(({ slug, order_index }) => [
      slug,
      order_index,
    ]),
  );
  for (const row of after.rows) row.order_index = desired.get(row.slug);
  after.rows[0].name = "Changed";
  assert.match(
    validateDestinationState(before, after, payload.destinationOrder).join(
      " | ",
    ),
    /changed field name/,
  );
});

test("owner-approved frozen inventory remains 84 Experiences and 102 Insights", () => {
  const before = frozenFixture(
    Array.from({ length: 84 }, (_, index) => ({ id: index + 1 })),
  );
  before.insights = Array.from({ length: 102 }, (_, index) => ({
    id: index + 1,
  }));
  assert.deepEqual(
    compareFrozenTableSnapshots(before, structuredClone(before)),
    [],
  );
  const changed = structuredClone(before);
  changed.insights[101].title = "Unexpected";
  assert.equal(
    compareFrozenTableSnapshots(before, changed)[0].table,
    "insights",
  );
});

test("backup gate verifies every checksummed file and rejects drift", (t) => {
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "creare-editorial-backup-test-"),
  );
  t.after(() => fs.rmSync(backupDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(backupDir, "db"));
  const relativePath = "db/relevant-production-tables.json";
  const contents = '{"transaction":{"readOnly":true},"tables":{}}\n';
  fs.writeFileSync(path.join(backupDir, relativePath), contents);
  fs.writeFileSync(
    path.join(backupDir, "SHA256SUMS"),
    `${sha256(contents)}  ${relativePath}\n`,
  );

  const verified = verifyBackup(backupDir);
  assert.equal(verified.filesVerified, 1);

  fs.appendFileSync(path.join(backupDir, relativePath), "drift");
  assert.throws(() => verifyBackup(backupDir), /checksum mismatch/i);
});

test("exact document comparison supports idempotent skips and media IDs", () => {
  assert.equal(
    documentValuesMatch(
      { hero_title: "Worlds", hero_image: { id: 68 } },
      { hero_title: "Worlds", hero_image: 68 },
    ),
    true,
  );
  assert.equal(
    documentValuesMatch(
      { hero_title: "Old", hero_image: { id: 68 } },
      { hero_title: "Worlds", hero_image: 68 },
    ),
    false,
  );
});

test("valid media attributes pass without same-named content-table columns", () => {
  const columns = makeDatabaseColumns();
  assert.equal(columns.cultural_world_pages.hero_image, undefined);
  assert.equal(columns.experience_category_pages.hero_image, undefined);
  assert.equal(columns.experience_category_pages.card_image, undefined);

  const validation = validateSchemaDestinations(
    schemas,
    columns,
    makeMediaInfrastructure(),
  );
  assert.deepEqual(validation.blockers, []);
  assert.deepEqual(validation.missingSchema, []);
});

test("a missing media attribute fails the schema contract", () => {
  const invalidSchemas = structuredClone(schemas);
  delete invalidSchemas.culturalWorlds.schema.attributes.hero_image;

  const validation = validateSchemaDestinations(
    invalidSchemas,
    makeDatabaseColumns(),
    makeMediaInfrastructure(),
  );
  assert.equal(validation.mediaAttributeMismatches.length, 1);
  assert.equal(
    validation.mediaAttributeMismatches[0].reason,
    "missing-schema-attribute",
  );
});

test("an incorrectly typed media attribute fails the schema contract", () => {
  const invalidSchemas = structuredClone(schemas);
  invalidSchemas.culturalWorlds.schema.attributes.hero_image.type = "string";

  const validation = validateSchemaDestinations(
    invalidSchemas,
    makeDatabaseColumns(),
    makeMediaInfrastructure(),
  );
  assert.equal(validation.mediaAttributeMismatches.length, 1);
  assert.equal(validation.mediaAttributeMismatches[0].actual.type, "string");
});

test("incorrect media multiplicity fails the schema contract", () => {
  const invalidSchemas = structuredClone(schemas);
  invalidSchemas.category.schema.attributes.card_image.multiple = true;

  const validation = validateSchemaDestinations(
    invalidSchemas,
    makeDatabaseColumns(),
    makeMediaInfrastructure(),
  );
  assert.equal(validation.mediaAttributeMismatches.length, 1);
  assert.equal(validation.mediaAttributeMismatches[0].actual.multiple, true);
});

test("missing or incompatible media infrastructure fails", () => {
  const missing = validateMediaInfrastructure({
    filesTable: { exists: false, columns: [] },
    relationTables: [],
  });
  assert.equal(missing.valid, false);
  assert.equal(missing.blockers.length, 2);

  const incompatible = makeMediaInfrastructure();
  incompatible.relationTables[0].columns = [
    "file_id",
    "related_id",
    "related_type",
    "field",
  ];
  const invalid = validateMediaInfrastructure(incompatible);
  assert.equal(invalid.valid, false);
  assert.match(invalid.blockers[0], /order/);
});

test("existing category media relations pass through Strapi polymorphic storage", () => {
  const files = EXPECTED.categoryKeys.map((key, index) => ({
    id: 69 + index,
    provider_metadata: {
      public_id: payload.categories[key].mediaPublicId,
    },
  }));
  let rowId = 1;
  let relationId = 1;
  const categories = [];
  const fileRelations = [];
  for (const [keyIndex, key] of EXPECTED.categoryKeys.entries()) {
    for (const locale of EXPECTED.locales) {
      for (const status of ["draft", "published"]) {
        const id = rowId++;
        categories.push({
          id,
          key,
          locale,
          published_at: status === "published" ? "2026-01-01" : null,
        });
        for (const field of ["hero_image", "card_image"]) {
          fileRelations.push({
            id: relationId++,
            file_id: files[keyIndex].id,
            related_id: id,
            related_type: MEDIA_ATTRIBUTE_CONTRACTS.category.contentTypeUid,
            field,
            order: 1,
          });
        }
      }
    }
  }

  const validation = validateCategoryMediaRelations({
    categories,
    files,
    fileRelations,
    payload,
  });
  assert.equal(validation.relationsChecked, 36);
  assert.deepEqual(validation.mismatches, []);
});

test("new Cultural Worlds hero passes as a projected relation without a row", () => {
  const validation = validateProjectedCulturalMedia(payload, []);

  assert.deepEqual(validation.blockers, []);
  assert.equal(validation.existingMediaId, null);
  assert.equal(validation.projectedRegistration, 1);
  assert.equal(validation.projectedUpload, 0);
});

test("scalar fields still require compatible physical database columns", () => {
  const missingColumns = makeDatabaseColumns();
  delete missingColumns.cultural_world_pages.hero_title;
  const missing = validateSchemaDestinations(
    schemas,
    missingColumns,
    makeMediaInfrastructure(),
  );
  assert.deepEqual(missing.missingSchema, ["culturalWorlds:hero_title"]);

  const wrongTypeColumns = makeDatabaseColumns();
  wrongTypeColumns.cultural_world_pages.hero_title.dataType = "integer";
  const wrongType = validateSchemaDestinations(
    schemas,
    wrongTypeColumns,
    makeMediaInfrastructure(),
  );
  assert.equal(wrongType.scalarMismatches.length, 1);
  assert.equal(wrongType.scalarMismatches[0].reason, "database-type");
});

test("the original media-column false positive is reproduced and eliminated", () => {
  const columns = makeDatabaseColumns();
  const legacyMissing = Object.entries(schemas).flatMap(([modelKey, model]) =>
    Object.keys(model.schema.attributes)
      .filter((field) => !columns[model.tableName][field])
      .map((field) => `${modelKey}:${field}`),
  );
  assert.deepEqual(legacyMissing, [
    "culturalWorlds:hero_image",
    "category:hero_image",
    "category:card_image",
  ]);

  const corrected = validateSchemaDestinations(
    schemas,
    columns,
    makeMediaInfrastructure(),
  );
  assert.deepEqual(corrected.blockers, []);
});

test("the approved editorial payload hash remains unchanged", () => {
  const payloadBuffer = fs.readFileSync(
    path.join(
      ROOT_DIR,
      "src",
      "migrations",
      "editorial-reconstruction-v1.json",
    ),
  );
  assert.equal(
    sha256(payloadBuffer),
    "9644398844052682c517d461776d3d51e27030f98ba9b1c4b9ad3195dc893333",
  );
});
