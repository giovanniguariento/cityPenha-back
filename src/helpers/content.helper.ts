import * as cheerio from 'cheerio';

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