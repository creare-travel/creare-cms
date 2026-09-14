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

function makeReadOnlyTrx(tables) {
  return (table) => {
    let rows = clone(tables[table] || []);
    const builder = {
      where(criteria) {
        rows = rows.filter((row) =>
          Object.entries(criteria).every(([key, value]) => row[key] === value),
        );
        return builder;
      },
      select(...fields) {
        rows = rows.map((row) =>
          Object.fromEntries(fields.map((field) => [field, row[field]])),
        );
        return builder;
      },
      orderBy(field) {
        rows.sort((left, right) =>
          String(left[field]).localeCompare(String(right[field]), "en", {
            numeric: true,
          }),
        );
        return builder;
      },
      first() {
        return Promise.resolve(rows[0]);
      },
      then(resolve, reject) {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  };
}

const payloadPath = path.join(root, "src/migrations/ru-v5-localizations.json");
const payloadSha256 = require("node:crypto")
  .createHash("sha256")
  .update(fs.readFileSync(payloadPath))
  .digest("hex");

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
  const result = migration.validateProtectedBaseline(payload, backup.tables, {
    tables: backup.tables,
    schema: backupSchema,
  });
  assert.deepEqual(result.blockers, []);
});

test("frozen RU payload remains byte-identical", () => {
  assert.equal(
    payloadSha256,
    "c36ba025eb30f25997d0b69d8cbbea2b33b5ee61e1f7a12a6f07278926719f01",
  );
});

test("dry-run and apply use the same protected-baseline validator", () => {
  assert.equal(
    migration.PROTECTED_BASELINE_VALIDATOR_ID,
    "canonical-protected-baseline-v2",
  );
  assert.match(
    migration.runDryRun.toString(),
    /validateProtectedBaseline\s*\(/u,
  );
  assert.match(
    migration.runApply.toString(),
    /validateProtectedBaseline\s*\(/u,
  );
});

test("apply preflight validator is exercised by the dry-run path", () => {
  const tables = clone(backup.tables);
  tables.audience_segments[0].slug = "unauthorized-drift";
  const result = migration.validateProtectedBaseline(payload, tables, {
    tables: backup.tables,
    schema: backupSchema,
  });
  assert.match(
    result.blockers.join("\n"),
    /protected baseline drift: audience_segments/u,
  );
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

test("driver representation differences in the four reported tables are equivalent", () => {
  const tables = clone(backup.tables);
  const columns = new Map(
    backupSchema.columns.map((column) => [
      `${column.table_name}.${column.column_name}`,
      column,
    ]),
  );
  const affected = new Set([
    "audience_segments",
    "experience_types",
    "files",
    "moods",
  ]);
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        const metadata = columns.get(`${table}.${column}`);
        if (
          typeof value === "string" &&
          metadata?.data_type === "timestamp without time zone"
        ) {
          row[column] = new Date(Date.parse(value) + 3 * 60 * 60 * 1000);
        } else if (
          affected.has(table) &&
          typeof value === "string" &&
          ["json", "jsonb"].includes(metadata?.data_type) &&
          /^[{[]/u.test(value.trim())
        ) {
          row[column] = JSON.parse(value);
        } else if (
          affected.has(table) &&
          typeof value === "string" &&
          ["numeric", "decimal", "real", "double precision"].includes(
            metadata?.data_type,
          )
        ) {
          row[column] = Number(value);
        }
      }
    }
  }
  const result = migration.validateProtectedBaseline(payload, tables, {
    tables: backup.tables,
    schema: backupSchema,
  });
  assert.deepEqual(result.blockers, []);
  for (const table of affected) {
    assert.ok(
      result.representationDiagnostics.normalizedTables.includes(table),
    );
  }
});

test("numeric representation normalization does not hide real value drift", () => {
  const tables = clone(backup.tables);
  tables.audience_segments[0].confidence_score =
    Number(tables.audience_segments[0].confidence_score) + 0.01;
  const result = migration.validateProtectedBaseline(payload, tables, {
    tables: backup.tables,
    schema: backupSchema,
  });
  assert.match(
    result.blockers.join("\n"),
    /protected baseline drift: audience_segments/u,
  );
});

test("numeric representations normalize losslessly", () => {
  assert.equal(migration.normalizeNumeric("001.2300"), "1.23");
  assert.equal(migration.normalizeNumeric(1.23), "1.23");
  assert.equal(migration.normalizeNumeric("1.23e2"), "123");
  assert.equal(migration.normalizeNumeric("-0.000"), "0");
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

test("same-query snapshot comparison blocks value, row, timestamp and identity drift", () => {
  const before = {
    sample: [
      {
        id: 1,
        happened_at: new Date("2026-09-13T12:00:00.000Z"),
        payload: { nested: "stable" },
      },
    ],
  };
  assert.deepEqual(
    migration.compareSameQuerySnapshots(
      before,
      clone(before),
      semanticTestSchema,
    ).changedTables,
    [],
  );

  const mutations = [
    (tables) => {
      tables.sample[0].payload.nested = "changed";
    },
    (tables) => {
      tables.sample = [];
    },
    (tables) => {
      tables.sample[0].happened_at = new Date("2026-09-13T12:00:00.001Z");
    },
    (tables) => {
      tables.sample[0].id = 2;
    },
  ];
  for (const mutate of mutations) {
    const after = clone(before);
    mutate(after);
    assert.deepEqual(
      migration.compareSameQuerySnapshots(before, after, semanticTestSchema)
        .changedTables,
      ["sample"],
    );
  }
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

test("post-apply JSONB field validation accepts equivalent driver representations", () => {
  const expected = [
    { type: "paragraph", children: [{ type: "text", text: "Текст" }] },
  ];
  const actual = JSON.stringify(expected);
  assert.equal(
    migration.databaseFieldValuesSemanticallyEqual(
      "sample",
      "payload",
      expected,
      actual,
      semanticTestSchema,
    ),
    true,
  );
  const changed = clone(expected);
  changed[0].children[0].text = "Изменённый текст";
  assert.equal(
    migration.databaseFieldValuesSemanticallyEqual(
      "sample",
      "payload",
      expected,
      JSON.stringify(changed),
      semanticTestSchema,
    ),
    false,
  );
});

test("post-apply relation rows normalize database numeric representation", () => {
  const schema = {
    columns: [
      {
        table_name: "relation_sample",
        column_name: "target_id",
        data_type: "integer",
      },
      {
        table_name: "relation_sample",
        column_name: "order",
        data_type: "double precision",
      },
    ],
  };
  assert.equal(
    migration.databaseRowsSemanticallyEqual(
      "relation_sample",
      [
        { target_id: 7, order: 1 },
        { target_id: 9, order: 2 },
      ],
      [
        { target_id: "9", order: "2.0" },
        { target_id: "7", order: "1.0" },
      ],
      schema,
    ),
    true,
  );
});

test("Strapi cleanup suppresses only the known Tarn pool abort", async () => {
  const tarnAbort = new Error("aborted");
  tarnAbort.stack =
    "Error: aborted\n    at PendingOperation.abort (/app/node_modules/tarn/dist/PendingOperation.js:25:21)";
  assert.equal(migration.isExpectedTarnPoolAbort(tarnAbort), true);
  assert.equal(migration.isExpectedTarnPoolAbort(new Error("aborted")), false);

  const summary = {};
  await migration.destroyStrapiSafely(
    {
      async destroy() {
        throw tarnAbort;
      },
    },
    summary,
  );
  assert.match(summary.cleanupWarning, /expected Tarn connection-pool abort/u);

  await assert.rejects(
    migration.destroyStrapiSafely(
      {
        async destroy() {
          throw new Error("unexpected cleanup failure");
        },
      },
      {},
    ),
    /unexpected cleanup failure/u,
  );
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

test("every supplied payload field is a database column or declared component", () => {
  const columns = new Set(
    backupSchema.columns.map(
      (column) => `${column.table_name}.${column.column_name}`,
    ),
  );
  for (const record of payload.records) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, record.schema)));
    for (const field of Object.keys({
      ...record.sharedFields,
      ...record.fields,
    })) {
      const attribute = schema.attributes[field];
      assert.ok(
        attribute,
        `${record.documentId}.${field} is absent from schema`,
      );
      assert.ok(
        attribute.type === "component" ||
          columns.has(`${record.table}.${field}`),
        `${record.documentId}.${field} has no database storage contract`,
      );
    }
  }
});

test("Destination component projection derives six rows for both storage tables", () => {
  const manifest = migration.buildExpectedTableDeltaManifest(payload);
  for (const table of [
    "components_destination_sections",
    "destinations_cmps",
  ]) {
    assert.equal(manifest[table].baselineCount, 42);
    assert.equal(manifest[table].projectedDelta, 6);
    assert.equal(manifest[table].expectedPostApplyCount, 48);
    assert.equal(manifest[table].sources.length, 3);
  }
});

test("post-apply Destination component content is validated semantically", async () => {
  const record = payload.records.find(
    (item) => item.contentType === "api::destination.destination",
  );
  const expected = record.fields.sections[0];
  const row = { id: 9000, published_at: null };
  const tables = {
    destinations_cmps: [
      {
        entity_id: row.id,
        cmp_id: 9100,
        component_type: "destination.section",
        field: "sections",
        order: "1.0",
      },
    ],
    components_destination_sections: [
      {
        ...clone(expected),
        id: 9100,
        section_number: String(expected.section_number),
      },
    ],
  };
  await migration.assertRecordComponents(
    makeReadOnlyTrx(tables),
    record,
    row,
    backupSchema,
  );
  tables.components_destination_sections[0].body +=
    " Несогласованное изменение.";
  await assert.rejects(
    migration.assertRecordComponents(
      makeReadOnlyTrx(tables),
      record,
      row,
      backupSchema,
    ),
    /component field mismatch: sections\.0\.body/u,
  );
});

test("missing or additional Destination component rows block projection", () => {
  const manifest = migration.buildExpectedTableDeltaManifest(payload);
  const actualCounts = Object.fromEntries(
    Object.entries(manifest).map(([table, entry]) => [
      table,
      entry.expectedPostApplyCount,
    ]),
  );
  for (const count of [47, 49]) {
    const changed = { ...actualCounts, components_destination_sections: count };
    assert.match(
      migration.validateProjectedTableCounts(manifest, changed).join("\n"),
      /components_destination_sections: expected 48 rows after apply/u,
    );
  }
});

test("complete RU V5 changed-table inventory is explicit", () => {
  const manifest = migration.buildExpectedTableDeltaManifest(payload);
  const changedTables = Object.entries(manifest)
    .filter(([, entry]) => entry.projectedDelta !== 0)
    .map(([table]) => table)
    .sort();
  assert.deepEqual(changedTables, [
    "components_destination_sections",
    "cultural_world_pages",
    "destinations",
    "destinations_cmps",
    "experience_category_pages",
    "experience_landings",
    "experiences",
    "experiences_audience_entity_lnk",
    "experiences_destination_lnk",
    "experiences_experience_type_entity_lnk",
    "experiences_intensity_entity_lnk",
    "experiences_mood_entity_lnk",
    "experiences_related_experiences_lnk",
    "files_related_mph",
  ]);
  assert.equal(Object.keys(manifest).length, 67);
  assert.equal(manifest.insights.projectedDelta, 0);
  assert.equal(manifest.experiences_insights_lnk.projectedDelta, 0);
  assert.equal(manifest.experiences_related_insights_lnk.projectedDelta, 0);
});

test("unexpected changed table blocks projection", () => {
  const manifest = migration.buildExpectedTableDeltaManifest(payload);
  const actualCounts = Object.fromEntries(
    Object.entries(manifest).map(([table, entry]) => [
      table,
      entry.expectedPostApplyCount,
    ]),
  );
  actualCounts.unlisted_table = 1;
  assert.match(
    migration.validateProjectedTableCounts(manifest, actualCounts).join("\n"),
    /unexpected changed table: unlisted_table/u,
  );
});

test("dry-run and apply share the complete projection builder", () => {
  assert.match(
    migration.runDryRun.toString(),
    /buildExpectedTableDeltaManifest\s*\(/u,
  );
  assert.match(
    migration.runApply.toString(),
    /buildExpectedTableDeltaManifest\s*\(/u,
  );
});

test("post-apply counts include every projected media and relation row", () => {
  const counts = migration.expectedPostApplyCounts(payload);
  const projected = migration.projection(payload);
  assert.equal(counts.experiences - payload.baseline.counts.experiences, 28);
  assert.equal(counts.components_destination_sections, 48);
  assert.equal(counts.destinations_cmps, 48);
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

test("source component IDs never enter localized document data", () => {
  const destination = payload.records.find(
    (item) => item.contentType === "api::destination.destination",
  );
  assert.ok(destination.fields.sections[0].id);
  const data = migration.buildDocumentData(destination);
  assert.equal(Object.hasOwn(data.sections[0], "id"), false);
  assert.deepEqual(Object.keys(data.sections[0]).sort(), [
    "body",
    "section_number",
    "title",
  ]);
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
