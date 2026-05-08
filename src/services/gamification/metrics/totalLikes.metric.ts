import type { MetricDescriptor } from './registry';
import { SYSTEM_FOLDER_KEY_LIKES } from '../../postFolder.service';

export const totalLikesMetric: MetricDescriptor = {
  key: 'total_likes',
  description: 'Quantidade de posts atualmente curtidos pelo usuário (favoritos na pasta sistema "likes").',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.favorite.count({
      where: { folder: { userId, internalKey: SYSTEM_FOLDER_KEY_LIKES } },
    });
  },
};
