import type { Request, Response } from 'express';
import type { DiscoveryService } from '../services/discovery.service';
import {
  DISCOVERY_SEARCH_LIMIT_DEFAULT,
  DISCOVERY_SEARCH_LIMIT_MAX,
  DISCOVERY_SEARCH_MIN_Q,
} from '../config/discovery';
import { setFeedCacheHeaders } from '../helpers/feedCache.helper';
import { sendJsonSuccess } from '../lib/apiResponse';
import { validationError } from '../lib/httpErrors';

export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  get = async (req: Request, res: Response): Promise<void> => {
    const worldNewsCategoriesQuery =
      typeof req.query.worldNewsCategories === 'string'
        ? req.query.worldNewsCategories
        : undefined;

    const payload = await this.discoveryService.buildDiscoveryPayload({
      worldNewsCategoriesQuery,
      userId: req.appUser?.id,
    });

    setFeedCacheHeaders(res, Boolean(req.appUser?.id));
    sendJsonSuccess(res, payload);
  };

  search = async (req: Request, res: Response): Promise<void> => {
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (rawQ.length < DISCOVERY_SEARCH_MIN_Q) {
      throw validationError(
        `q must be at least ${DISCOVERY_SEARCH_MIN_Q} characters`,
        { minLength: DISCOVERY_SEARCH_MIN_Q }
      );
    }
    if (rawQ.length > 100) {
      throw validationError('q must be at most 100 characters', { maxLength: 100 });
    }

    let limit = DISCOVERY_SEARCH_LIMIT_DEFAULT;
    if (typeof req.query.limit === 'string' && req.query.limit.trim()) {
      const n = Number(req.query.limit);
      if (!Number.isFinite(n) || n < 1) {
        throw validationError('limit must be a positive integer');
      }
      limit = Math.min(Math.floor(n), DISCOVERY_SEARCH_LIMIT_MAX);
    }

    const payload = await this.discoveryService.search({
      q: rawQ,
      limit,
      userId: req.appUser?.id,
    });

    setFeedCacheHeaders(res, Boolean(req.appUser?.id));
    sendJsonSuccess(res, payload);
  };
}
