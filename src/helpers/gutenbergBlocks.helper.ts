import * as cheerio from 'cheerio';

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Wraps sanitized TipTap/HTML fragments in Gutenberg block comments so
 * WordPress admin can open/edit them as blocks.
 */
export function wrapHtmlAsGutenbergBlocks(html: string): string {
  const raw = typeof html === 'string' ? html.trim() : '';
  if (!raw) return '';

  const $ = cheerio.load(`<div id="cp-root">${raw}</div>`, { xml: false });
  const root = $('#cp-root');
  const parts: string[] = [];

  root.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = ((node as { data?: string }).data ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      parts.push(
        `<!-- wp:paragraph -->\n<p>${escapeHtmlAttr(text)}</p>\n<!-- /wp:paragraph -->`
      );
      return;
    }

    if (node.type !== 'tag') return;

    const el = node as { tagName?: string; name?: string; attribs?: Record<string, string> };
    const tag = (el.tagName ?? el.name ?? '').toLowerCase();
    const outer = $.html(node as never) ?? '';

    switch (tag) {
      case 'p':
        parts.push(`<!-- wp:paragraph -->\n${outer}\n<!-- /wp:paragraph -->`);
        break;
      case 'h2':
        parts.push(`<!-- wp:heading {"level":2} -->\n${outer}\n<!-- /wp:heading -->`);
        break;
      case 'h3':
        parts.push(`<!-- wp:heading {"level":3} -->\n${outer}\n<!-- /wp:heading -->`);
        break;
      case 'ul':
        parts.push(`<!-- wp:list -->\n${outer}\n<!-- /wp:list -->`);
        break;
      case 'ol':
        parts.push(`<!-- wp:list {"ordered":true} -->\n${outer}\n<!-- /wp:list -->`);
        break;
      case 'blockquote':
        parts.push(`<!-- wp:quote -->\n${outer}\n<!-- /wp:quote -->`);
        break;
      case 'hr':
        parts.push(
          `<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->`
        );
        break;
      case 'figure':
        parts.push(`<!-- wp:image -->\n${outer}\n<!-- /wp:image -->`);
        break;
      case 'img': {
        const src = $(node as never).attr('src') ?? '';
        const alt = $(node as never).attr('alt') ?? '';
        const img = `<figure class="wp-block-image"><img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}"/></figure>`;
        parts.push(`<!-- wp:image -->\n${img}\n<!-- /wp:image -->`);
        break;
      }
      case 'br':
        break;
      default:
        parts.push(`<!-- wp:html -->\n${outer}\n<!-- /wp:html -->`);
        break;
    }
  });

  return parts.join('\n\n');
}
