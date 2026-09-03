import * as cheerio from 'cheerio';

/** `hqdefault` is the only YouTube thumbnail size guaranteed to exist for every video. */
const YOUTUBE_THUMBNAIL_SIZE = 'hqdefault';
const YOUTUBE_ID_PATTERN =
  /(?:youtube(?:-nocookie)?\.com\/(?:embed|shorts|v)\/|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export interface ExtractedPostVideo {
  /** Direct media file URL, from a self-hosted `<video>`. */
  contentUrl?: string;
  /** Player URL, from an `<iframe>` embed (YouTube, Vimeo, ...). */
  embedUrl?: string;
  /** Still image representing the video, for `VideoObject.thumbnailUrl`. */
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export function isSingleVideoContent(htmlContent: string): boolean {
  if (!htmlContent) return false;

  const $ = cheerio.load(htmlContent);
  const body = $('body');

  // 1. Contar Mídias
  const iframeCount = body.find('iframe').length;
  const videoCount = body.find('video').length;
  const totalMedia = iframeCount + videoCount;

  if (totalMedia !== 1) return false;

  // 2. Verificar Imagens
  if (body.find('img').length > 0) return false;

  // 3. Remover as mídias para ver o que sobra
  body.find('iframe').remove();
  body.find('video').remove();

  // 4. Checar texto restante
  const remainingText = body.text().trim();

  return remainingText.length === 0;
}

/**
 * Reads the first player in the post markup so the frontend can emit VideoObject
 * structured data — without it Google classifies the page as a plain article and
 * refuses to index the video ("video isn't on a watch page").
 *
 * `fallbackThumbnailUrl` (the post's featured image) is used for self-hosted
 * videos, which carry no thumbnail of their own unless an editor set a `poster`.
 */
export function extractPostVideo(
  htmlContent: string,
  fallbackThumbnailUrl?: string
): ExtractedPostVideo | null {
  if (!htmlContent) return null;

  const $ = cheerio.load(htmlContent);
  const baseUrl = inferMediaBaseUrl(htmlContent);

  const video = $('video').first();
  if (video.length > 0) {
    const contentUrl = toAbsoluteMediaUrl(
      video.attr('src')?.trim() || video.find('source').first().attr('src')?.trim(),
      baseUrl
    );
    if (!contentUrl) return null;
    return omitEmpty({
      contentUrl,
      thumbnailUrl: toAbsoluteMediaUrl(
        video.attr('poster')?.trim() || fallbackThumbnailUrl,
        baseUrl
      ),
      width: toPositiveInt(video.attr('width')),
      height: toPositiveInt(video.attr('height')),
    });
  }

  const iframe = $('iframe').first();
  const embedUrl = toAbsoluteMediaUrl(iframe.attr('src')?.trim(), baseUrl);
  if (!embedUrl) return null;

  return omitEmpty({
    embedUrl,
    thumbnailUrl:
      youtubeThumbnailUrl(embedUrl) ??
      toAbsoluteMediaUrl(fallbackThumbnailUrl, baseUrl),
    width: toPositiveInt(iframe.attr('width')),
    height: toPositiveInt(iframe.attr('height')),
  });
}

/**
 * Prepares the single player of a watch page for crawling: gives self-hosted
 * videos a poster frame and drops `loading="lazy"`, which keeps embeds out of
 * the rendered DOM Googlebot evaluates for video prominence.
 */
export function prepareWatchPageMedia(htmlContent: string, thumbnailUrl?: string): string {
  if (!htmlContent) return htmlContent;

  const $ = cheerio.load(htmlContent);

  const video = $('video').first();
  if (video.length > 0) {
    if (thumbnailUrl && !video.attr('poster')?.trim()) {
      video.attr('poster', thumbnailUrl);
    }
    if (!video.attr('preload')?.trim()) {
      video.attr('preload', 'metadata');
    }
  }

  $('video, iframe').removeAttr('loading');

  return $('body').html() ?? htmlContent;
}

export function youtubeThumbnailUrl(embedUrl: string): string | undefined {
  const videoId = embedUrl.match(YOUTUBE_ID_PATTERN)?.[1];
  return videoId ? `https://i.ytimg.com/vi/${videoId}/${YOUTUBE_THUMBNAIL_SIZE}.jpg` : undefined;
}

function toPositiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function omitEmpty(video: ExtractedPostVideo): ExtractedPostVideo {
  return Object.fromEntries(
    Object.entries(video).filter(([, value]) => value != null && value !== '')
  ) as ExtractedPostVideo;
}

function inferMediaBaseUrl(htmlContent: string): string | undefined {
  const match = htmlContent.match(/https?:\/\/[^"'\s>]+/);
  if (!match) return undefined;
  try {
    const url = new URL(match[0]);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function toAbsoluteMediaUrl(
  url: string | undefined,
  baseUrl: string | undefined
): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!baseUrl) return trimmed;
  return `${baseUrl}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}
