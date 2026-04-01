import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareVersions,
  parseReleaseNotes,
} from '../src/utils/releaseNotesParser';

test('parseReleaseNotes supports feature-first release headers', () => {
  const content = `# Release Notes

## Intelligent Exclusions & Smart Maintenance - v1.2.40

_Release Date: March 16, 2026_

### Resume;
Welcome to the latest version.

### Highlights
- Smart .gitignore integration.
`;

  const parsed = parseReleaseNotes(content);

  assert.equal(
    parsed.releaseTitle,
    'Intelligent Exclusions & Smart Maintenance - v1.2.40',
  );
  assert.equal(parsed.releaseVersion, '1.2.40');
  assert.equal(parsed.lastReleaseDate, 'March 16, 2026');
  assert.match(parsed.summaryHtml, /Welcome to the latest version\./);
  assert.doesNotMatch(parsed.summaryHtml, /Resume;/);
  assert.match(parsed.detailsHtml, /<h3>Highlights<\/h3>/);
});

test('parseReleaseNotes supports spanish titles and omits resumen labels', () => {
  const content = `# Release Notes

# Exclusiones Inteligentes y Mantenimiento - v1.2.40

_Fecha de lanzamiento: 16 de marzo, 2026_

### Resumen
Texto de resumen.

### Destacados
- Punto importante.
`;

  const parsed = parseReleaseNotes(content);

  assert.equal(
    parsed.releaseTitle,
    'Exclusiones Inteligentes y Mantenimiento - v1.2.40',
  );
  assert.equal(parsed.releaseVersion, '1.2.40');
  assert.equal(parsed.lastReleaseDate, '16 de marzo, 2026');
  assert.match(parsed.summaryHtml, /Texto de resumen\./);
  assert.doesNotMatch(parsed.summaryHtml, /Resumen/);
  assert.match(parsed.detailsHtml, /<h3>Destacados<\/h3>/);
});

test('parseReleaseNotes keeps supporting version-first headers', () => {
  const content = `# Release Notes

## v1.2.39 - Existing Feature Name

_Release Date: March 15, 2026_

Short summary paragraph.

### Highlights
- Existing release note content.
`;

  const parsed = parseReleaseNotes(content);

  assert.equal(parsed.releaseTitle, 'v1.2.39 - Existing Feature Name');
  assert.equal(parsed.releaseVersion, '1.2.39');
  assert.equal(parsed.lastReleaseDate, 'March 15, 2026');
  assert.match(parsed.summaryHtml, /Short summary paragraph\./);
  assert.match(parsed.detailsHtml, /<h3>Highlights<\/h3>/);
});

test('compareVersions sorts semantic versions numerically', () => {
  assert.ok(compareVersions('1.2.40', '1.2.9') > 0);
  assert.equal(compareVersions('1.2.40', '1.2.40'), 0);
  assert.ok(compareVersions('1.2.9', '1.2.40') < 0);
});
