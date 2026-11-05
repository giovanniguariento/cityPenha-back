import type { Experience, Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { notFound, forbidden, validationError } from '../lib/httpErrors';
import {
  formatExperienceDateLabel,
  formatExperienceTimeLabel,
  parseTagsInput,
  slugifyExperienceTitle,
} from '../helpers/experienceFormat.helper';

export type ExperienceStatus = 'draft' | 'published' | 'archived';

export interface ExperienceMetaView {
  venue: string;
  address?: string;
  dateLabel: string;
  timeLabel: string;
  conditionLabel?: string;
}

export interface ExperienceListItemView {
  id: string;
  slug: string;
  title: string;
  coverUrl: string;
  xpReward: number;
  featured: boolean;
  isAd: boolean;
  meta: ExperienceMetaView;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  startsAt: string;
  endsAt: string | null;
}

export interface ExperienceDetailView extends ExperienceListItemView {
  description: string;
  tags: string[];
  liked?: boolean;
  shared?: boolean;
}

export interface ExperienceMineView extends ExperienceDetailView {
  status: ExperienceStatus;
  createdAt: string;
  updatedAt: string;
}

function asTags(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string');
}

function toMeta(row: Experience): ExperienceMetaView {
  return {
    venue: row.venue,
    ...(row.address ? { address: row.address } : {}),
    dateLabel: formatExperienceDateLabel(row.startsAt, row.endsAt),
    timeLabel: formatExperienceTimeLabel(row.startsAt, row.endsAt),
    ...(row.conditionLabel ? { conditionLabel: row.conditionLabel } : {}),
  };
}

function toListItem(row: Experience): ExperienceListItemView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    coverUrl: row.coverUrl,
    xpReward: row.xpReward,
    featured: row.featured,
    isAd: row.isAd,
    meta: toMeta(row),
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    shareCount: row.shareCount,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
  };
}

function toDetail(
  row: Experience,
  viewer?: { liked: boolean; shared: boolean }
): ExperienceDetailView {
  return {
    ...toListItem(row),
    description: row.description,
    tags: asTags(row.tags),
    ...(viewer
      ? { liked: viewer.liked, shared: viewer.shared }
      : {}),
  };
}

export interface CreateExperienceInput {
  title: string;
  description: string;
  coverUrl: string;
  xpReward?: number;
  featured?: boolean;
  isAd?: boolean;
  venue: string;
  address?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  /** Ignored when present — derived from startsAt/endsAt. */
  timeLabel?: string;
  conditionLabel?: string | null;
  tags?: unknown;
  status?: ExperienceStatus;
}

export interface UpdateExperienceInput {
  title?: string;
  description?: string;
  coverUrl?: string;
  xpReward?: number;
  featured?: boolean;
  isAd?: boolean;
  venue?: string;
  address?: string | null;
  startsAt?: Date;
  endsAt?: Date | null;
  /** Ignored when present — derived from startsAt/endsAt. */
  timeLabel?: string;
  conditionLabel?: string | null;
  tags?: unknown;
  status?: ExperienceStatus;
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base.slice(0, 180);
  let n = 0;
  for (;;) {
    const slug = n === 0 ? candidate : `${candidate.slice(0, 170)}-${n}`;
    const existing = await prisma.experience.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing || (excludeId && existing.id === excludeId)) return slug;
    n += 1;
  }
}

export class ExperienceService {
  async listPublished(options: {
    q?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: ExperienceListItemView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const q = options.q?.trim();

    const where: Prisma.ExperienceWhereInput = {
      status: 'published',
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { venue: { contains: q } },
              { description: { contains: q } },
            ],
          }
        : {}),
    };

    const rows = await prisma.experience.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(options.cursor
        ? { cursor: { id: options.cursor }, skip: 1 }
        : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(toListItem),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async listFeatured(limit = 10): Promise<ExperienceListItemView[]> {
    const rows = await prisma.experience.findMany({
      where: { status: 'published', featured: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(limit, 1), 20),
    });
    return rows.map(toListItem);
  }

  async listNewForDiscovery(limit = 5): Promise<ExperienceListItemView[]> {
    const rows = await prisma.experience.findMany({
      where: { status: 'published' },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(limit, 1), 20),
    });
    return rows.map(toListItem);
  }

  async getBySlug(
    slug: string,
    viewerId?: string
  ): Promise<ExperienceDetailView | null> {
    const row = await prisma.experience.findFirst({
      where: { slug, status: 'published' },
    });
    if (!row) return null;

    if (!viewerId) return toDetail(row);

    const [like, share] = await Promise.all([
      prisma.experienceLike.findUnique({
        where: { experienceId_userId: { experienceId: row.id, userId: viewerId } },
        select: { id: true },
      }),
      prisma.experienceShare.findUnique({
        where: { experienceId_userId: { experienceId: row.id, userId: viewerId } },
        select: { id: true },
      }),
    ]);

    return toDetail(row, { liked: !!like, shared: !!share });
  }

  async getById(id: string): Promise<Experience | null> {
    return prisma.experience.findUnique({ where: { id } });
  }

  async listMine(userId: string): Promise<ExperienceMineView[]> {
    const rows = await prisma.experience.findMany({
      where: { createdByUserId: userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => ({
      ...toDetail(row),
      status: row.status as ExperienceStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getMineById(userId: string, id: string): Promise<ExperienceMineView | null> {
    const row = await prisma.experience.findFirst({
      where: { id, createdByUserId: userId },
    });
    if (!row) return null;
    return {
      ...toDetail(row),
      status: row.status as ExperienceStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(userId: string, input: CreateExperienceInput): Promise<ExperienceMineView> {
    const title = input.title.trim();
    if (!title) throw validationError('title is required');
    if (!input.description.trim()) throw validationError('description is required');
    if (!input.coverUrl.trim()) throw validationError('coverUrl is required');
    if (!input.venue.trim()) throw validationError('venue is required');

    const slug = await uniqueSlug(slugifyExperienceTitle(title));
    const tags = parseTagsInput(input.tags ?? []);
    const status = input.status ?? 'published';
    const endsAt = input.endsAt ?? null;
    const timeLabel = formatExperienceTimeLabel(input.startsAt, endsAt);

    const row = await prisma.experience.create({
      data: {
        slug,
        title,
        description: input.description.trim(),
        coverUrl: input.coverUrl.trim(),
        xpReward: Math.max(0, Math.floor(input.xpReward ?? 0)),
        featured: input.featured === true,
        isAd: input.isAd === true,
        venue: input.venue.trim(),
        address: input.address?.trim() || null,
        startsAt: input.startsAt,
        endsAt,
        timeLabel,
        conditionLabel: input.conditionLabel?.trim() || null,
        tags,
        status,
        createdByUserId: userId,
      },
    });

    return {
      ...toDetail(row),
      status: row.status as ExperienceStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(
    userId: string,
    id: string,
    input: UpdateExperienceInput,
    opts: { isAdmin?: boolean } = {}
  ): Promise<ExperienceMineView> {
    const existing = await prisma.experience.findUnique({ where: { id } });
    if (!existing) throw notFound('Experience not found');
    if (!opts.isAdmin && existing.createdByUserId !== userId) {
      throw forbidden('You can only edit your own experiences');
    }

    const data: Prisma.ExperienceUpdateInput = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw validationError('title is required');
      data.title = title;
      data.slug = await uniqueSlug(slugifyExperienceTitle(title), id);
    }
    if (input.description !== undefined) {
      if (!input.description.trim()) throw validationError('description is required');
      data.description = input.description.trim();
    }
    if (input.coverUrl !== undefined) {
      if (!input.coverUrl.trim()) throw validationError('coverUrl is required');
      data.coverUrl = input.coverUrl.trim();
    }
    if (input.xpReward !== undefined) data.xpReward = Math.max(0, Math.floor(input.xpReward));
    if (input.featured !== undefined) data.featured = input.featured;
    if (input.isAd !== undefined) data.isAd = input.isAd;
    if (input.venue !== undefined) {
      if (!input.venue.trim()) throw validationError('venue is required');
      data.venue = input.venue.trim();
    }
    if (input.address !== undefined) data.address = input.address?.trim() || null;
    if (input.startsAt !== undefined) data.startsAt = input.startsAt;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt;
    if (input.conditionLabel !== undefined) {
      data.conditionLabel = input.conditionLabel?.trim() || null;
    }
    if (input.tags !== undefined) data.tags = parseTagsInput(input.tags);
    if (input.status !== undefined) data.status = input.status;

    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      const nextStart = input.startsAt ?? existing.startsAt;
      const nextEnd =
        input.endsAt !== undefined ? input.endsAt : existing.endsAt;
      data.timeLabel = formatExperienceTimeLabel(nextStart, nextEnd);
    }

    const row = await prisma.experience.update({ where: { id }, data });
    return {
      ...toDetail(row),
      status: row.status as ExperienceStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(
    userId: string,
    id: string,
    opts: { isAdmin?: boolean } = {}
  ): Promise<void> {
    const existing = await prisma.experience.findUnique({ where: { id } });
    if (!existing) throw notFound('Experience not found');
    if (!opts.isAdmin && existing.createdByUserId !== userId) {
      throw forbidden('You can only delete your own experiences');
    }
    await prisma.experience.delete({ where: { id } });
  }

  async toggleLike(
    userId: string,
    experienceId: string
  ): Promise<{ liked: boolean; likeCount: number }> {
    const experience = await prisma.experience.findFirst({
      where: { id: experienceId, status: 'published' },
      select: { id: true },
    });
    if (!experience) throw notFound('Experience not found');

    const existing = await prisma.experienceLike.findUnique({
      where: { experienceId_userId: { experienceId, userId } },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.experienceLike.delete({ where: { id: existing.id } }),
        prisma.experience.update({
          where: { id: experienceId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.experienceLike.create({ data: { experienceId, userId } }),
        prisma.experience.update({
          where: { id: experienceId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
    }

    const updated = await prisma.experience.findUnique({
      where: { id: experienceId },
      select: { likeCount: true },
    });
    return { liked: !existing, likeCount: Math.max(0, updated?.likeCount ?? 0) };
  }

  async registerShare(
    userId: string,
    experienceId: string
  ): Promise<{ shared: boolean; shareCount: number; alreadyShared: boolean }> {
    const experience = await prisma.experience.findFirst({
      where: { id: experienceId, status: 'published' },
      select: { id: true },
    });
    if (!experience) throw notFound('Experience not found');

    const existing = await prisma.experienceShare.findUnique({
      where: { experienceId_userId: { experienceId, userId } },
    });

    if (existing) {
      const updated = await prisma.experience.findUnique({
        where: { id: experienceId },
        select: { shareCount: true },
      });
      return {
        shared: true,
        shareCount: updated?.shareCount ?? 0,
        alreadyShared: true,
      };
    }

    await prisma.$transaction([
      prisma.experienceShare.create({ data: { experienceId, userId } }),
      prisma.experience.update({
        where: { id: experienceId },
        data: { shareCount: { increment: 1 } },
      }),
    ]);

    const updated = await prisma.experience.findUnique({
      where: { id: experienceId },
      select: { shareCount: true },
    });
    return {
      shared: true,
      shareCount: updated?.shareCount ?? 1,
      alreadyShared: false,
    };
  }
}

export const experienceService = new ExperienceService();
