"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CMS_DESTINATION_FIELDS,
  EXPECTED_TITLE_REPLACEMENTS,
  KNOWN_PROTECTED_FIELD_CORRECTIONS,
  assertPreflightReady,
  buildLengthConstraints,
  buildProjectedExperienceRecord,
  countPostgresCharacters,
  findProtectedNameMatches,
  validatePayload,
  validatePlannedFieldLengths,
  validateProjectedCmsState,
} = require("../migrate-experience-single-source.js");

const ROOT_DIR = path.resolve(__dirname, "../..");
const payload = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT_DIR,
      "src",
      "migrations",
      "experience-single-source-v1.json",
    ),
    "utf8",
  ),
);
const experienceSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT_DIR,
      "src",
      "api",
      "experience",
      "content-types",
      "experience",
      "schema.json",
    ),
    "utf8",
  ),
);
const landingSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT_DIR,
      "src",
      "api",
      "experience-landing",
      "content-types",
      "experience-landing",
      "schema.json",
    ),
    "utf8",
  ),
);
const categorySchema = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT_DIR,
      "src",
      "api",
      "experience-category-page",
      "content-types",
      "experience-category-page",
      "schema.json",
    ),
    "utf8",
  ),
);

function makeLengthConstraints(
  shortDescriptionColumn = {
    dataType: "text",
    characterMaximumLength: null,
  },
) {
  return buildLengthConstraints(
    {
      experience: {
        tableName: "experiences",
        schema: experienceSchema,
      },
      landing: {
        tableName: "experience_landings",
        schema: landingSchema,
      },
      category: {
        tableName: "experience_category_pages",
        schema: categorySchema,
      },
    },
    {
      experiences: {
        short_description: shortDescriptionColumn,
      },
      experience_landings: {
        hero_title: {
          dataType: "character varying",
          characterMaximumLength: 255,
        },
      },
      experience_category_pages: {},
    },
  );
}

const LAB_SLUGS = new Set([
  "bodrum-beach-games-rhythm-competition-celebration",
  "princes-islands-regatta",
  "the-studio-session",
]);

function valueAtPath(value, fieldPath) {
  return fieldPath
    .split(".")
    .reduce((current, segment) => current?.[segment], value);
}

function makeProjectedFixture() {
  const experiences = payload.records.map((record) => {
    const source = Object.fromEntries(
      CMS_DESTINATION_FIELDS.map((field) => [field, null]),
    );
    Object.assign(source, {
      documentId: record.documentId,
      locale: record.locale,
      slug: record.slug,
      category: LAB_SLUGS.has(record.slug) ? "lab" : "signature",
    });

    return {
      kind: "experience",
      documentFamily: record.documentId,
      locale: record.locale,
      slug: record.slug,
      expectedSlug: record.slug,
      before: structuredClone(source),
      after: buildProjectedExperienceRecord(source, record),
    };
  });

  const landing = Object.entries(payload.landing).map(([locale, content]) => ({
    kind: "experience-landing",
    documentFamily: "experience-landing",
    locale,
    slug: null,
    expectedSlug: null,
    before: null,
    after: structuredClone(content),
  }));

  const categories = Object.entries(payload.categories).flatMap(
    ([key, category]) =>
      Object.entries(category.locales).map(([locale, content]) => ({
        kind: "experience-category-page",
        documentFamily: key,
        locale,
        slug: null,
        expectedSlug: null,
        before: null,
        after: {
          key,
          display_order: category.display_order,
          ...structuredClone(content),
        },
      })),
  );

  return { experiences, landing, categories };
}

test("payload locks all five official names and every known stale field", () => {
  const payloadValidation = validatePayload(payload);
  assert.deepEqual(payloadValidation.blockers, []);

  for (const [obsolete, replacement] of Object.entries(
    EXPECTED_TITLE_REPLACEMENTS,
  )) {
    assert.equal(payload.titleReplacements[obsolete], replacement);
  }

  const projected = makeProjectedFixture();
  const validation = validateProjectedCmsState(projected, payload);
  assert.equal(validation.protectedOldNameMatchCount, 0);
  assert.equal(validation.knownFieldCorrections.length, 9);
  assert.deepEqual(validation.knownCorrectionFailures, []);

  for (const correction of KNOWN_PROTECTED_FIELD_CORRECTIONS) {
    const record = payload.records.find(
      (candidate) =>
        candidate.locale === "tr-TR" && candidate.slug === correction.slug,
    );
    assert.equal(
      valueAtPath(record.fields, correction.fieldPath),
      correction.expected,
      `${correction.slug}:${correction.fieldPath}`,
    );
  }
});

test("recursive scanner finds obsolete names in nested rich-text arrays", () => {
  const matches = findProtectedNameMatches(
    {
      description: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: "Performansın İzinde, ekipleri pistte buluşturur.",
            },
          ],
        },
      ],
    },
    {
      documentFamily: "fixture-family",
      locale: "tr-TR",
    },
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].fieldPath, "description.0.children.0.text");
  assert.equal(matches[0].matchedObsoleteValue, "Performansın İzinde™");
});

test("scanner detects NFC, trademark, dash, and apostrophe spacing variants", () => {
  const decomposed = "I\u0307mparatorluk Lezzetleri™–Mutfak Atölyesi ’ nin";
  const matches = findProtectedNameMatches(decomposed, {
    documentFamily: "fixture-family",
    locale: "tr-TR",
    fieldPath: "cta_heading",
  });

  assert.equal(matches.length, 1);
  assert.equal(
    matches[0].matchedObsoleteValue,
    "İmparatorluk Lezzetleri™ — Mutfak Atölyesi",
  );
});

test("an injected obsolete name blocks preflight before any mutation path", () => {
  const projected = makeProjectedFixture();
  const target = projected.experiences.find(
    (entry) => entry.locale === "tr-TR" && entry.slug === "silk-road-istanbul",
  );
  target.after.cta_heading = "İpek Yolu: İstanbul Deneyimini Rezerve Edin";

  const validation = validateProjectedCmsState(projected, payload);
  assert.equal(validation.protectedOldNameMatchCount, 1);
  assert.throws(
    () => assertPreflightReady(validatePayload(payload), validation),
    /Migration preflight blockers/,
  );
});

test("official English names pass without rewriting EN or ZH content", () => {
  const officialNames = Object.values(EXPECTED_TITLE_REPLACEMENTS);
  const matches = findProtectedNameMatches(officialNames, {
    documentFamily: "fixture-family",
    locale: "tr-TR",
  });
  assert.deepEqual(matches, []);

  for (const locale of ["en", "zh-CN"]) {
    const record = payload.records.find(
      (candidate) =>
        candidate.locale === locale && candidate.slug === "silk-road-istanbul",
    );
    const source = {
      documentId: record.documentId,
      locale,
      slug: record.slug,
      title: "Unchanged source fixture",
    };
    const sourceSnapshot = structuredClone(source);
    const projected = buildProjectedExperienceRecord(source, record);

    assert.deepEqual(source, sourceSnapshot);
    assert.equal(projected.title, record.fields.title);
    assert.equal(projected.slug, source.slug);
  }
});

test("projection never accepts a payload slug as a writable field", () => {
  const source = {
    documentId: "family",
    locale: "tr-TR",
    slug: "frozen-canonical-slug",
    title: "Source",
  };
  const projected = buildProjectedExperienceRecord(source, {
    documentId: "family",
    locale: "tr-TR",
    slug: "malformed-new-slug",
    fields: {
      title: "Projected",
      slug: "also-forbidden",
    },
  });

  assert.equal(projected.slug, "frozen-canonical-slug");
  assert.equal(source.slug, "frozen-canonical-slug");
});

test("Experience short_description is localized text with a 700-character limit", () => {
  const attribute = experienceSchema.attributes.short_description;
  assert.equal(attribute.type, "text");
  assert.equal(attribute.maxLength, 700);
  assert.equal(attribute.pluginOptions.i18n.localized, true);
  assert.equal(attribute.required, undefined);
});

test("the approved 269-character Imperial Flavors short description passes 700", () => {
  const validation = validatePlannedFieldLengths(
    payload,
    makeLengthConstraints(),
  );
  assert.equal(validation.lengthConstraintBlockers, 0);
  assert.equal(validation.imperialFlavorsShortDescription.actualLength, 269);
  assert.equal(validation.imperialFlavorsShortDescription.permittedLength, 700);
  assert.equal(validation.imperialFlavorsShortDescription.passes, true);
});

test("the actual database varchar limit overrides the widened application limit", () => {
  const validation = validatePlannedFieldLengths(
    payload,
    makeLengthConstraints({
      dataType: "character varying",
      characterMaximumLength: 255,
    }),
  );
  const imperialViolations = validation.violations.filter(
    (violation) =>
      violation.documentFamily === "a5fl4lc5kkl3okseczixktre" &&
      violation.locale === "tr-TR" &&
      violation.field === "short_description",
  );
  assert.equal(imperialViolations.length, 2);
  assert.equal(validation.imperialFlavorsShortDescription.permittedLength, 255);
  assert.equal(validation.imperialFlavorsShortDescription.passes, false);
});

test("a 701-character short description blocks draft and published targets", () => {
  const fixture = structuredClone(payload);
  const target = fixture.records.find(
    (record) =>
      record.locale === "tr-TR" &&
      record.slug === "imperial-flavors-culinary-atelier",
  );
  target.fields.short_description = "a".repeat(701);

  const validation = validatePlannedFieldLengths(
    fixture,
    makeLengthConstraints(),
  );
  const violations = validation.violations.filter(
    (violation) => violation.field === "short_description",
  );
  assert.equal(violations.length, 2);
  assert.deepEqual(
    violations.map((violation) => violation.targetStatus).sort(),
    ["draft", "published"],
  );
  assert.ok(
    violations.every(
      (violation) =>
        violation.actualLength === 701 && violation.permittedLength === 700,
    ),
  );
  assert.throws(
    () => assertPreflightReady(validation),
    /Migration preflight blockers/,
  );
});

test("another varchar(255) payload field remains blocked", () => {
  const fixture = structuredClone(payload);
  fixture.landing.en.hero_title = "x".repeat(256);
  const validation = validatePlannedFieldLengths(
    fixture,
    makeLengthConstraints(),
  );
  const violations = validation.violations.filter(
    (violation) => violation.fieldPath === "landing.en.hero_title",
  );
  assert.equal(violations.length, 2);
  assert.ok(
    violations.every(
      (violation) =>
        violation.actualLength === 256 && violation.permittedLength === 255,
    ),
  );
});

test("PostgreSQL-compatible character counts handle Turkish and Chinese", () => {
  assert.equal(countPostgresCharacters("İstanbul"), 8);
  assert.equal(countPostgresCharacters("文化世界"), 4);
  assert.equal(countPostgresCharacters("体验".repeat(350)), 700);
  assert.equal(countPostgresCharacters("ğ".repeat(701)), 701);
  assert.equal(countPostgresCharacters("🧭"), 1);
});
