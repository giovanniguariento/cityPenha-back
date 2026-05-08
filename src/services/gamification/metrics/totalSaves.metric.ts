import type { MetricDescriptor } from './registry';
import { SYSTEM_FOLDER_KEY_DEFAULT_SAVED } from '../../postFolder.service';

export const totalSavesMetric: MetricDescriptor = {
  key: 'total_saves',
  description: 'Quantidade de posts atualmente salvos pelo usuário (favoritos na pasta sistema "default_saved").',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.favorite.count({
      where: { folder: { userId, internalKey: SYSTEM_FOLDER_KEY_DEFAULT_SAVED } },
    });
  },
};
