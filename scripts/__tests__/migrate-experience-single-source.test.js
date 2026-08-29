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
  buildProjectedExperienceRecord,
  findProtectedNameMatches,
  validatePayload,
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
