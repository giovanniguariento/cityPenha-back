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
  'video',
  'iframe',
]);

const DESCRIPTION_MAX_PLAIN_LENGTH = 2000;
const ARTICLE_MAX_PLAIN_LENGTH = 50_000;

const IMG_ATTRS = new Set(['src', 'alt', 'loading', 'class']);
const VIDEO_ATTRS = new Set([
  'src',
  'controls',
  'poster',
  'preload',
  'width',
  'height',
  'class',
]);
const IFRAME_ATTRS = new Set([
  'src',
  'width',
  'height',
  'title',
  'allow',
  'allowfullscreen',
  'referrerpolicy',
  'loading',
  'class',
  'frameborder',
]);

const EMBED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
]);

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  );
}

function isSafeMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  // Allow http for local WP media (e.g. http://localhost/wp-content/...).
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/')
  );
}

function isSafeEmbedSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed.startsWith('https://')) return false;
  try {
    const url = new URL(trimmed);
    return EMBED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
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
      if (tag === 'img' && IMG_ATTRS.has(name)) {
        if (name === 'src') {
          const src = attribs[name] ?? '';
          if (!isSafeMediaSrc(src)) {
            $(el).removeAttr(name);
          }
        }
        continue;
      }
      if (tag === 'video' && VIDEO_ATTRS.has(name)) {
        if (name === 'src' || name === 'poster') {
          const src = attribs[name] ?? '';
          if (!isSafeMediaSrc(src)) {
            $(el).removeAttr(name);
          }
        }
        continue;
      }
      if (tag === 'iframe' && IFRAME_ATTRS.has(name)) {
        if (name === 'src') {
          const src = attribs[name] ?? '';
          if (!isSafeEmbedSrc(src)) {
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

  // Drop media without a safe src.
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || !isSafeMediaSrc(src)) {
      $(el).remove();
    }
  });
  $('video').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || !isSafeMediaSrc(src)) {
      $(el).remove();
    } else if (!('controls' in (el.attribs ?? {}))) {
      $(el).attr('controls', '');
    }
  });
  $('iframe').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || !isSafeEmbedSrc(src)) {
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

/** True when article HTML has plain text or at least one safe media element. */
export function articleHtmlHasContent(html: string): boolean {
  if (!html?.trim()) return false;
  const $ = cheerio.load(html, { xml: false });
  const plain = $('body').text().replace(/\s+/g, ' ').trim();
  if (plain) return true;
  if ($('img[src], video[src], iframe[src]').length > 0) return true;
  return false;
}
