import { marked } from 'marked';

type ReleaseSection = {
  version: string;
  feature: string;
  body: string;
  rawTitle: string;
};

export type ParsedReleaseNotes = {
  releaseTitle?: string;
  releaseVersion?: string;
  lastReleaseDate?: string;
  summaryHtml: string;
  detailsHtml: string;
};

export function parseReleaseNotes(content: string): ParsedReleaseNotes {
  const sections = extractVersionSections(content);
  if (sections.length > 0) {
    const latestSection = sections.sort((a, b) =>
      compareVersions(b.version, a.version),
    )[0];
    const cleanBody = removeReleaseDateLine(latestSection.body).trim();
    const htmlParts = splitBodyIntoHtml(cleanBody);

    return {
      releaseVersion: latestSection.version,
      releaseTitle: latestSection.rawTitle,
      lastReleaseDate: extractReleaseDate(latestSection.body),
      summaryHtml: htmlParts.summaryHtml,
      detailsHtml: htmlParts.detailsHtml,
    };
  }

  const legacyTitleMatch = content.match(/^(?:#|##)\s+(.+)$/m);
  let legacyContent = content;
  let releaseTitle: string | undefined;

  if (legacyTitleMatch) {
    releaseTitle = legacyTitleMatch[1].trim();
    legacyContent = legacyContent.replace(/^(?:#|##)\s+.+\r?\n?/, '');
  }

  const cleanLegacyContent = removeReleaseDateLine(legacyContent).trim();
  const htmlParts = splitBodyIntoHtml(cleanLegacyContent);

  return {
    releaseTitle,
    lastReleaseDate: extractReleaseDate(legacyContent),
    summaryHtml: htmlParts.summaryHtml,
    detailsHtml: htmlParts.detailsHtml,
  };
}

function splitBodyIntoHtml(content: string): {
  summaryHtml: string;
  detailsHtml: string;
} {
  const normalizedContent = removeSummaryHeading(content);
  const splitMatch = content.match(/^###\s+/m);
  const normalizedSplitMatch = normalizedContent.match(/^###\s+/m);
  if (normalizedSplitMatch && normalizedSplitMatch.index !== undefined) {
    const summaryPart = normalizedContent
      .substring(0, normalizedSplitMatch.index)
      .trim();
    const detailsPart = normalizedContent
      .substring(normalizedSplitMatch.index)
      .trim();

    return {
      summaryHtml: summaryPart ? (marked.parse(summaryPart) as string) : '',
      detailsHtml: detailsPart ? (marked.parse(detailsPart) as string) : '',
    };
  }

  return {
    summaryHtml: normalizedContent ? (marked.parse(normalizedContent) as string) : '',
    detailsHtml: '',
  };
}

function extractVersionSections(content: string): ReleaseSection[] {
  const normalized = stripReleaseNotesHeader(content.replace(/^\uFEFF/, ''));
  const sectionRegex =
    /^#{1,2}\s+(?:(.+?)\s*-\s*v(\d+(?:\.\d+){1,3})|v(\d+(?:\.\d+){1,3})\s*-\s*(.+?))\s*$/gm;
  const matches = Array.from(normalized.matchAll(sectionRegex));

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const bodyEnd =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? normalized.length)
        : normalized.length;

    const feature = (match[1] ?? match[4] ?? '').trim();
    const version = (match[2] ?? match[3] ?? '').trim();

    return {
      version,
      feature,
      rawTitle: match[0].replace(/^#{1,2}\s+/, '').trim(),
      body: normalized.substring(bodyStart, bodyEnd).trim(),
    };
  });
}

function stripReleaseNotesHeader(content: string): string {
  return content.replace(/^#\s+Release Notes\s*\r?\n+/i, '');
}

function removeSummaryHeading(content: string): string {
  return content.replace(/^###\s+(?:Resumen|Resume;?)\s*\r?\n?/i, '');
}

function extractReleaseDate(content: string): string | undefined {
  const dateMatch = content.match(
    /_\s*(?:Release date|Release Date|Fecha de lanzamiento):\s*([^_\n\r]+)_/i,
  );
  return dateMatch?.[1].trim();
}

function removeReleaseDateLine(content: string): string {
  return content.replace(
    /_\s*(?:Release date|Release Date|Fecha de lanzamiento):\s*[^_\n\r]+_\r?\n?/i,
    '',
  );
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}
