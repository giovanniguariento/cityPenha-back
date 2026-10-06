import * as cheerio from 'cheerio';
import { validationError } from '../lib/httpErrors';

const DESCRIPTION_ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
]);

const ARTICLE_ALLOWED_TAGS = new Set([
  ...DESCRIPTION_ALLOWED_TAGS,
  'h2',
  'h3',
  'blockquote',
  'hr',
  'img',
  'figure',
]);

const DESCRIPTION_MAX_PLAIN_LENGTH = 2000;
const ARTICLE_MAX_PLAIN_LENGTH = 50_000;

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  );
}

function isSafeImgSrc(src: string): boolean {
  const trimmed = src.trim();
  return trimmed.startsWith('https://') || trimmed.startsWith('/');
}

function sanitizeWithAllowlist(
  html: string,
  allowedTags: Set<string>,
  maxPlainLength: number,
  label: string
): string {
  const raw = typeof html === 'string' ? html : '';
  const $ = cheerio.load(raw, { xml: false });

  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    const tag = el.tagName.toLowerCase();
    // Cheerio wraps fragments in html/head/body — never unwrap those or $('body') is empty.
    if (tag === 'html' || tag === 'head' || tag === 'body') return;
    if (!allowedTags.has(tag)) {
      $(el).replaceWith($(el).contents());
      return;
    }

    const attribs = { ...el.attribs };
    for (const name of Object.keys(attribs)) {
      if (tag === 'a' && (name === 'href' || name === 'rel' || name === 'target')) {
        if (name === 'href') {
          const href = attribs[name] ?? '';
          if (!isSafeHref(href)) {
            $(el).removeAttr(name);
          }
        }
        continue;
      }
      if (tag === 'img' && (name === 'src' || name === 'alt' || name === 'loading' || name === 'class')) {
        if (name === 'src') {
          const src = attribs[name] ?? '';
          if (!isSafeImgSrc(src)) {
            $(el).removeAttr(name);
          }
        }
        continue;
      }
      if (tag === 'figure' && name === 'class') {
        continue;
      }
      if (tag === 'hr' && name === 'class') {
        continue;
      }
      $(el).removeAttr(name);
    }
  });

  // Drop images without a safe src.
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || !isSafeImgSrc(src)) {
      $(el).remove();
    }
  });

  const body = $('body');
  const plain = body.text().replace(/\s+/g, ' ').trim();
  if (plain.length > maxPlainLength) {
    throw validationError(
      `${label} plain text exceeds the maximum of ${maxPlainLength} characters`
    );
  }

  return body.html() ?? '';
}

/**
 * Sanitizes short-post description HTML to a strict allowlist.
 * Throws VALIDATION_ERROR if plain text exceeds 2000 characters.
 */
export function sanitizePostDescriptionHtml(html: string): string {
  return sanitizeWithAllowlist(
    html,
    DESCRIPTION_ALLOWED_TAGS,
    DESCRIPTION_MAX_PLAIN_LENGTH,
    'Description'
  );
}

/**
 * Sanitizes in-app article HTML (TipTap) before storing on WordPress.
 * Throws VALIDATION_ERROR if plain text exceeds 50_000 characters.
 */
export function sanitizePostArticleHtml(html: string): string {
  return sanitizeWithAllowlist(
    html,
    ARTICLE_ALLOWED_TAGS,
    ARTICLE_MAX_PLAIN_LENGTH,
    'Article'
  );
}

export function plainTextFromHtml(html: string): string {
  if (!html) return '';
  return cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
}
