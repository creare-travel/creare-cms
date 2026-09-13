"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const migration = require("../migrate-ru-v5-localizations");
const root = path.resolve(__dirname, "../..");
const payload = JSON.parse(
  fs.readFileSync(
    path.join(root, "src/migrations/ru-v5-localizations.json"),
    "utf8",
  ),
);
const backup = JSON.parse(
  fs.readFileSync(
    path.join(payload.metadata.backupDir, "db/all-production-tables.json"),
    "utf8",
  ),
);
const backupSchema = JSON.parse(
  fs.readFileSync(
    path.join(payload.metadata.backupDir, "db/schema-metadata.json"),
    "utf8",
  ),
);

const clone = (value) => structuredClone(value);

const semanticTestSchema = {
  columns: [
    {
      table_name: "sample",
      column_name: "id",
      data_type: "integer",
      udt_name: "int4",
    },
    {
      table_name: "sample",
      column_name: "happened_at",
      data_type: "timestamp without time zone",
      udt_name: "timestamp",
    },
    {
      table_name: "sample",
      column_name: "payload",
      data_type: "jsonb",
      udt_name: "jsonb",
    },
  ],
};

function compareSample(expected, current) {
  const comparison = migration.buildSemanticComparison(
    { sample: expected },
    { sample: current },
    semanticTestSchema,
  );
  return {
    ...comparison.compare("sample", expected, current),
    timestampProfile: comparison.timestampProfile,
  };
}

test("certified baseline has no blockers", () => {
  const result = migration.validateState(payload, backup.tables);
  assert.deepEqual(result.blockers, []);
});

test("container UTC timestamp representation equals certified ISO text", () => {
  const tables = clone(backup.tables);
  const timestampColumns = new Set(
    backupSchema.columns
      .filter((column) => column.data_type === "timestamp without time zone")
      .map((column) => `${column.table_name}.${column.column_name}`),
  );
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (
          value &&
          timestampColumns.has(`${table}.${column}`) &&
          typeof value === "string"
        ) {
          row[column] = new Date(Date.parse(value) + 3 * 60 * 60 * 1000);
        }
      }
    }
  }
  const result = migration.validateState(payload, tables);
  assert.deepEqual(result.blockers, []);
  assert.equal(
    result.representationDiagnostics.timestampProfile.offsetMs,
    3 * 60 * 60 * 1000,
  );
  assert.equal(result.representationDiagnostics.rawRepresentationDiffers, true);
  assert.equal(
    result.representationDiagnostics.canonicalSemanticValuesEqual,
    true,
  );
});

test("timestamp representation normalization does not hide real drift", () => {
  const expected = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    happened_at: "2026-09-13T09:00:00.000Z",
    payload: null,
  }));
  const current = expected.map((row) => ({
    ...row,
    happened_at: new Date("2026-09-13T12:00:00.000Z"),
  }));
  current.at(-1).happened_at = new Date("2026-09-13T12:00:00.001Z");
  const result = compareSample(expected, current);
  assert.equal(result.timestampProfile.offsetMs, 3 * 60 * 60 * 1000);
  assert.equal(result.equal, false);
});

test("equivalent JSONB object and array strings compare semantically", () => {
  const expected = [
    {
      id: "1",
      happened_at: null,
      payload: [{ beta: 2, alpha: { second: true, first: false } }],
    },
  ];
  const current = [
    {
      id: 1,
      happened_at: null,
      payload: '[{"alpha":{"first":false,"second":true},"beta":2}]',
    },
  ];
  const result = compareSample(expected, current);
  assert.equal(result.rawEqual, false);
  assert.equal(result.equal, true);
});

test("JSON object key order does not create semantic drift", () => {
  const expected = [
    { id: 1, happened_at: null, payload: { beta: 2, alpha: 1 } },
  ];
  const current = [
    { id: 1, happened_at: null, payload: { alpha: 1, beta: 2 } },
  ];
  assert.equal(compareSample(expected, current).equal, true);
});

test("JSON array order remains semantically significant", () => {
  const expected = [{ id: 1, happened_at: null, payload: ["first", "second"] }];
  const current = [{ id: 1, happened_at: null, payload: ["second", "first"] }];
  assert.equal(compareSample(expected, current).equal, false);
});

test("database row order does not create semantic drift", () => {
  const expected = [
    { id: 1, happened_at: null, payload: { value: "first" } },
    { id: 2, happened_at: null, payload: { value: "second" } },
  ];
  const current = [...expected].reverse();
  assert.equal(compareSample(expected, current).equal, true);
});

test("composite primary-key order is stable", () => {
  const schema = {
    columns: [
      {
        table_name: "composite_sample",
        column_name: "left_id",
        data_type: "integer",
      },
      {
        table_name: "composite_sample",
        column_name: "right_id",
        data_type: "integer",
      },
      {
        table_name: "composite_sample",
        column_name: "payload",
        data_type: "jsonb",
      },
    ],
    constraints: [
      {
        table_name: "composite_sample",
        definition: "PRIMARY KEY (left_id, right_id)",
      },
    ],
  };
  const expected = [
    { left_id: "1", right_id: "2", payload: { value: "first" } },
    { left_id: "2", right_id: "1", payload: { value: "second" } },
  ];
  const current = [
    { left_id: 2, right_id: 1, payload: { value: "second" } },
    { left_id: 1, right_id: 2, payload: { value: "first" } },
  ];
  const comparison = migration.buildSemanticComparison(
    { composite_sample: expected },
    { composite_sample: current },
    schema,
  );
  assert.equal(
    comparison.compare("composite_sample", expected, current).equal,
    true,
  );
});

test("projection is exactly 22 drafts and 22 publications", () => {
  const result = migration.projection(payload);
  assert.equal(result.families, 22);
  assert.equal(result.draftCreates, 22);
  assert.equal(result.draftUpdates, 0);
  assert.equal(result.publications, 22);
  assert.equal(result.physicalContentRowsAdded, 44);
  assert.equal(result.insightRelationsProjected, 0);
});

test("post-apply counts include every projected media and relation row", () => {
  const counts = migration.expectedPostApplyCounts(payload);
  const projected = migration.projection(payload);
  assert.equal(counts.experiences - payload.baseline.counts.experiences, 28);
  assert.equal(
    counts.files_related_mph - payload.baseline.counts.files_related_mph,
    projected.mediaRelationRowsProjected,
  );
  assert.equal(
    counts.experiences_destination_lnk -
      payload.baseline.counts.experiences_destination_lnk,
    projected.destinationRelationRowsProjected,
  );
  assert.equal(
    counts.experiences_related_experiences_lnk -
      payload.baseline.counts.experiences_related_experiences_lnk,
    projected.relatedExperienceRelationRowsProjected,
  );
  const ontologyDelta = [
    "experiences_mood_entity_lnk",
    "experiences_intensity_entity_lnk",
    "experiences_audience_entity_lnk",
    "experiences_experience_type_entity_lnk",
  ].reduce(
    (sum, table) => sum + counts[table] - payload.baseline.counts[table],
    0,
  );
  assert.equal(ontologyDelta, projected.ontologyRelationRowsProjected);
  assert.equal(
    counts.experiences_insights_lnk,
    payload.baseline.counts.experiences_insights_lnk,
  );
  assert.equal(
    counts.experiences_related_insights_lnk,
    payload.baseline.counts.experiences_related_insights_lnk,
  );
});

test("English Experience title leakage blocks migration", () => {
  const changed = clone(payload);
  changed.records.find(
    (record) => record.identity?.value === "the-studio-session",
  ).fields.cta_heading = "Discuss The Studio Session";
  const result = migration.validateState(changed, backup.tables);
  assert.match(result.blockers.join("\n"), /English title leakage/);
});

test("non-Cyrillic localized editorial copy blocks migration", () => {
  const changed = clone(payload);
  changed.records.find(
    (record) => record.identity?.value === "the-studio-session",
  ).fields.short_description = "This paragraph was not localized into Russian.";
  const result = migration.validateState(changed, backup.tables);
  assert.match(result.blockers.join("\n"), /has no Cyrillic content/);
});

test("prohibited Silk Road private-entry claim blocks migration", () => {
  const changed = clone(payload);
  changed.records.find(
    (record) => record.identity?.value === "silk-road-istanbul",
  ).fields.program[0].children[0].children[0].text =
    "Private entry to Topkapi Palace";
  const result = migration.validateState(changed, backup.tables);
  assert.match(result.blockers.join("\n"), /prohibited claim/);
});

test("protected EN source drift blocks migration", () => {
  const tables = clone(backup.tables);
  const row = tables.experiences.find(
    (item) =>
      item.document_id === "aejy953ggemrn765zpnqtx9o" &&
      item.locale === "en" &&
      item.published_at,
  );
  row.title = "Drifted title";
  const result = migration.validateState(payload, tables);
  assert.match(
    result.blockers.join("\n"),
    /protected EN\/TR\/ZH family drift|EN source drift/,
  );
});

test("unrelated nested source-field mutation still blocks migration", () => {
  const tables = clone(backup.tables);
  const row = tables.experiences.find(
    (item) =>
      item.document_id === "aejy953ggemrn765zpnqtx9o" &&
      item.locale === "en" &&
      item.published_at,
  );
  row.description[0].children[0].text += " Unauthorized change.";
  const result = migration.validateState(payload, tables);
  assert.match(
    result.blockers.join("\n"),
    /protected EN\/TR\/ZH family drift|EN source drift/,
  );
});

test("missing source-family row blocks migration", () => {
  const tables = clone(backup.tables);
  tables.experiences = tables.experiences.filter(
    (item) =>
      !(
        item.document_id === "aejy953ggemrn765zpnqtx9o" &&
        item.locale === "en" &&
        item.published_at
      ),
  );
  const result = migration.validateState(payload, tables);
  assert.match(
    result.blockers.join("\n"),
    /EN draft\/published pair differs|protected baseline drift/,
  );
});

test("protected physical relation drift blocks migration", () => {
  const tables = clone(backup.tables);
  tables.experiences_destination_lnk[0].experience_ord += 1;
  const result = migration.validateState(payload, tables);
  assert.match(
    result.blockers.join("\n"),
    /protected baseline drift: experiences_destination_lnk/,
  );
});

test("duplicate RU localization blocks migration", () => {
  const tables = clone(backup.tables);
  const row = clone(
    tables.experiences.find(
      (item) =>
        item.document_id === "aejy953ggemrn765zpnqtx9o" &&
        item.locale === "en" &&
        !item.published_at,
    ),
  );
  row.id = 999999;
  row.locale = "ru-RU";
  tables.experiences.push(row);
  const result = migration.validateState(payload, tables);
  assert.match(result.blockers.join("\n"), /unexpected RU localization exists/);
});

test("omitted Experience fields never enter document data", () => {
  const record = payload.records.find(
    (item) => item.contentType === "api::experience.experience",
  );
  const data = migration.buildDocumentData(record);
  for (const field of [
    "designed_for",
    "venue_details",
    "ideal_guest",
    "cta_text",
  ]) {
    assert.equal(Object.hasOwn(data, field), false);
  }
});

test("required shared fields enter document data without altering the package", () => {
  const destination = payload.records.find(
    (item) => item.contentType === "api::destination.destination",
  );
  const category = payload.records.find(
    (item) =>
      item.contentType ===
      "api::experience-category-page.experience-category-page",
  );
  assert.equal(
    migration.buildDocumentData(destination).visibility_status,
    "active",
  );
  assert.equal(migration.buildDocumentData(category).display_order, 1);
});
