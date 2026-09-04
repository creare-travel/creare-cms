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
  buildLengthConstraints,
  countPostgresCharacters,
  documentValuesMatch,
  findBlackProhibitedClaims,
  parseArgs,
  validateCategoryMediaRelations,
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
