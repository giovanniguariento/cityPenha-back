import * as cheerio from 'cheerio';
import type { IPost } from '../models/post.interface';

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 140;

function htmlToPlainText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $('body').text().replace(/\s+/g, ' ').trim();
}

/**
 * Lowercase + strip diacritics for accent/case-insensitive matching, preserving
 * the character count so match indices stay aligned with the original string.
 */
function normalize(value: string): string {
  let out = '';
  for (const ch of value) {
    const stripped = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    out += stripped.length === 1 ? stripped : ch.toLowerCase();
  }
  return out;
}

/**
 * Builds a plain-text context snippet around the first occurrence of `query`
 * in the post excerpt/content. Matching is accent- and case-insensitive, but
 * the returned text preserves the original accents/casing for display.
 * Returns '' when the term is not present in the body (e.g. it matched the title only).
 */
export function buildSearchSnippet(post: IPost, query: string): string {
  const needle = query.trim();
  if (!needle) return '';

  const excerpt = htmlToPlainText(post.excerpt?.rendered ?? '');
  const content = htmlToPlainText(post.content?.rendered ?? '');
  const haystack = [excerpt, content].filter(Boolean).join(' ').trim();
  if (!haystack) return '';

  const normalizedHaystack = normalize(haystack);
  const normalizedNeedle = normalize(needle);
  if (!normalizedNeedle) return '';

  const matchIndex = normalizedHaystack.indexOf(normalizedNeedle);
  if (matchIndex === -1) return '';

  const start = Math.max(0, matchIndex - SNIPPET_BEFORE);
  const end = Math.min(haystack.length, matchIndex + normalizedNeedle.length + SNIPPET_AFTER);

  let snippet = haystack.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < haystack.length) snippet = `${snippet}…`;

  return snippet;
}
