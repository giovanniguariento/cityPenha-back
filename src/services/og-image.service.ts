import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BR_TIMEZONE } from '../lib/brTime';
import { fetchWithTimeout } from '../helpers/fetch.helper';
import { logger } from '../lib/logger';

// ─── Canvas dimensions ───────────────────────────────────────────────────────
const WIDTH = 1200;
const HEIGHT = 630;

// ─── Design tokens (matches styles/_variables.scss) ──────────────────────────
const BRAND_PRIMARY = '#ff1500';
const BRAND_ACCENT = '#ff3b30';

// ─── Layout constants ─────────────────────────────────────────────────────────
const ACCENT_BAR_WIDTH = 6;
const OVERLAY_WIDTH_RATIO = 0.62;
const PADDING_X = 64;

// Logo
const LOGO_Y = 40;
const LOGO_MAX_WIDTH = 200;

// Vertical spacing (logo bottom → title → description → date)
const LOGO_TO_TITLE_GAP = 90;   // from logo bottom edge to first title baseline
const TITLE_TO_DESC_GAP = 38;   // from last title baseline to first desc baseline
const DATE_BASELINE_Y = HEIGHT - 57; // 573px from top

// Typography
const TITLE_FONT_SIZE = 56;
const TITLE_LINE_HEIGHT = 70;
const TITLE_MAX_LINES = 3;
const TITLE_MAX_WIDTH = 460;

const DESC_FONT_SIZE = 26;
const DESC_LINE_HEIGHT = 36;
const DESC_MAX_LINES = 3;
const DESC_MAX_WIDTH = 460;

const DATE_FONT = `22px Arial, Helvetica, sans-serif`;

// ─── Months ───────────────────────────────────────────────────────────────────
const MONTHS_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const LOGO_PATH = join(process.cwd(), 'assets', 'logo.png');

export interface OgImageParams {
  title: string;
  description: string;
  date: string;
  imageUrl: string;
}

// ─── Logo cache ───────────────────────────────────────────────────────────────
let logoImagePromise: Promise<Image | null> | undefined;

function loadLogo(): Promise<Image | null> {
  logoImagePromise ??= loadImage(readFileSync(LOGO_PATH)).catch((err) => {
    logger.warn({ err, path: LOGO_PATH }, 'og-image: logo file could not be loaded');
    return null;
  });
  return logoImagePromise;
}

// ─── Background ──────────────────────────────────────────────────────────────
async function loadBackground(url: string): Promise<Image | null> {
  try {
    const response = await fetchWithTimeout(url, {}, 10_000);
    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'og-image: background fetch returned non-ok status, using fallback');
      return null;
    }
    return await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    logger.warn({ url, err }, 'og-image: background fetch failed, using fallback');
    return null;
  }
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function drawFallbackBackground(ctx: SKRSContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#0a0f19');
  gradient.addColorStop(1, '#1a1f2e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawCoverImage(ctx: SKRSContext2D, image: Image): void {
  const imageRatio = image.width / image.height;
  const canvasRatio = WIDTH / HEIGHT;
  let sx = 0, sy = 0, sw = image.width, sh = image.height;
  if (imageRatio > canvasRatio) {
    sw = image.height * canvasRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / canvasRatio;
    sy = (image.height - sh) / 2;
  }
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, WIDTH, HEIGHT);
}

function drawGradientOverlay(ctx: SKRSContext2D): void {
  const overlayWidth = WIDTH * OVERLAY_WIDTH_RATIO;
  const gradient = ctx.createLinearGradient(0, 0, overlayWidth, 0);
  gradient.addColorStop(0, 'rgba(10, 15, 25, 0.94)');
  gradient.addColorStop(0.7, 'rgba(10, 15, 25, 0.70)');
  gradient.addColorStop(1, 'rgba(10, 15, 25, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, overlayWidth, HEIGHT);
}

function drawAccentBar(ctx: SKRSContext2D): void {
  ctx.fillStyle = BRAND_PRIMARY;
  ctx.fillRect(0, 0, ACCENT_BAR_WIDTH, HEIGHT);
}

function drawLogo(ctx: SKRSContext2D, logo: Image | null): number {
  if (!logo) return 0;
  const scale = LOGO_MAX_WIDTH / logo.width;
  const logoHeight = Math.round(logo.height * scale);
  ctx.drawImage(logo, PADDING_X, LOGO_Y, LOGO_MAX_WIDTH, logoHeight);
  return logoHeight;
}

/**
 * Wraps text into lines fitting maxWidth, truncating with "..." on the last
 * allowed line if there is overflow.
 */
function wrapText(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const candidate = current ? `${current} ${word}` : word;

    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;

    if (lines.length >= maxLines) {
      // Overflow: truncate last line with ellipsis
      let last = lines[maxLines - 1]!;
      while (last.length > 0 && ctx.measureText(`${last}...`).width > maxWidth) {
        last = last.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${last}...`;
      return lines;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current && lines.length >= maxLines) {
    let last = lines[maxLines - 1]!;
    while (last.length > 0 && ctx.measureText(`${last}...`).width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[maxLines - 1] = `${last}...`;
  }

  return lines;
}

function drawTitle(ctx: SKRSContext2D, title: string, titleBaselineY: number): void {
  ctx.font = `bold ${TITLE_FONT_SIZE}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = '#ffffff';
  const lines = wrapText(ctx, title.toUpperCase(), TITLE_MAX_WIDTH, TITLE_MAX_LINES);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, PADDING_X, titleBaselineY + i * TITLE_LINE_HEIGHT);
  }
}

function drawDescription(ctx: SKRSContext2D, description: string, descBaselineY: number): void {
  ctx.font = `${DESC_FONT_SIZE}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = '#cccccc';
  const lines = wrapText(ctx, description, DESC_MAX_WIDTH, DESC_MAX_LINES);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, PADDING_X, descBaselineY + i * DESC_LINE_HEIGHT);
  }
}

function drawDate(ctx: SKRSContext2D, dateInput: string): void {
  const label = formatOgDate(dateInput);
  if (!label) return;
  ctx.font = DATE_FONT;
  ctx.fillStyle = BRAND_ACCENT;
  ctx.fillText(label, PADDING_X, DATE_BASELINE_Y);
}

function formatOgDate(dateInput: string): string {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BR_TIMEZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const day = get('day');
  const month = Number(get('month'));
  const year = get('year');
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');

  return `${day} ${MONTHS_PT[month - 1] ?? ''} ${year} | ${hour}:${minute}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateOgImage(params: OgImageParams): Promise<Buffer> {
  const [background, logo] = await Promise.all([loadBackground(params.imageUrl), loadLogo()]);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // 1. Background photo (cover fill) — or dark gradient fallback
  if (background) {
    drawCoverImage(ctx, background);
  } else {
    drawFallbackBackground(ctx);
  }

  // 2. Dark gradient overlay (left → transparent) — only needed over a photo
  if (background) {
    drawGradientOverlay(ctx);
  }

  // 3. Red accent bar (leftmost edge)
  drawAccentBar(ctx);

  // 4. Logo (top-left) — returns rendered height to anchor text below it
  const logoHeight = drawLogo(ctx, logo);

  // 5. Vertical text anchors
  const titleBaselineY = LOGO_Y + logoHeight + LOGO_TO_TITLE_GAP;
  const lastTitleBaselineY = titleBaselineY + (TITLE_MAX_LINES - 1) * TITLE_LINE_HEIGHT;
  const descBaselineY = lastTitleBaselineY + TITLE_TO_DESC_GAP;

  // 6. Title
  drawTitle(ctx, params.title, titleBaselineY);

  // 7. Description
  drawDescription(ctx, params.description, descBaselineY);

  // 8. Date (pinned to bottom)
  drawDate(ctx, params.date);

  return canvas.toBuffer('image/jpeg', 85);
}
