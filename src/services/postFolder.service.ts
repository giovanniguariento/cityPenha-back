import { prisma } from '../lib/prisma';

/** Pasta fixa de curtidas (likes no WP são itens nesta pasta). */
export const SYSTEM_FOLDER_KEY_LIKES = 'likes' as const;
/** Pasta padrão de salvos. */
export const SYSTEM_FOLDER_KEY_DEFAULT_SAVED = 'default_saved' as const;

export const SYSTEM_FOLDER_NAME_LIKES = 'curtidas';
export const SYSTEM_FOLDER_NAME_SAVED = 'Salvos';

export class PostFolderService {
  /**
   * Garante que o usuário possui as pastas fixas `curtidas` e `Salvos`.
   * Idempotente (usuários legados ou criados antes da migration).
   */
  async ensureSystemFoldersForUser(userId: string): Promise<void> {
    const existing = await prisma.postFolder.findMany({
      where: { userId },
      select: { internalKey: true },
    });
    const keys = new Set(
      existing.map((f) => f.internalKey).filter((k): k is string => k != null)
    );

    if (!keys.has(SYSTEM_FOLDER_KEY_LIKES)) {
      await prisma.postFolder.create({
        data: {
          userId,
          name: SYSTEM_FOLDER_NAME_LIKES,
          internalKey: SYSTEM_FOLDER_KEY_LIKES,
        },
      });
    }
    if (!keys.has(SYSTEM_FOLDER_KEY_DEFAULT_SAVED)) {
      await prisma.postFolder.create({
        data: {
          userId,
          name: SYSTEM_FOLDER_NAME_SAVED,
          internalKey: SYSTEM_FOLDER_KEY_DEFAULT_SAVED,
        },
      });
    }
  }

  async getLikesFolder(userId: string) {
    await this.ensureSystemFoldersForUser(userId);
    return prisma.postFolder.findFirstOrThrow({
      where: { userId, internalKey: SYSTEM_FOLDER_KEY_LIKES },
    });
  }

  async getDefaultSavedFolder(userId: string) {
    await this.ensureSystemFoldersForUser(userId);
    return prisma.postFolder.findFirstOrThrow({
      where: { userId, internalKey: SYSTEM_FOLDER_KEY_DEFAULT_SAVED },
    });
  }

  async listFolders(userId: string) {
    await this.ensureSystemFoldersForUser(userId);
    return prisma.postFolder.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Para cada pasta do usuário, o `wordpressPostId` do item mais recente (`Favorite.createdAt` desc).
   * Usado para capa da pasta (último curtido/salvo).
   */
  async getLastFavoriteWordpressPostIdByFolder(userId: string): Promise<Map<string, number>> {
    await this.ensureSystemFoldersForUser(userId);
    const rows = await prisma.favorite.findMany({
      where: { folder: { userId } },
      orderBy: { createdAt: 'desc' },
      select: { folderId: true, wordpressPostId: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!map.has(r.folderId)) {
        map.set(r.folderId, r.wordpressPostId);
      }
    }
    return map;
  }

  /** Quantidade de itens (`favorites`) por pasta do usuário. Pastas vazias não aparecem no groupBy → contagem 0. */
  async getFavoriteCountByFolder(userId: string): Promise<Map<string, number>> {
    await this.ensureSystemFoldersForUser(userId);
    const grouped = await prisma.favorite.groupBy({
      by: ['folderId'],
      where: { folder: { userId } },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const row of grouped) {
      map.set(row.folderId, row._count._all);
    }
    return map;
  }

  /**
   * IDs WordPress dos itens da pasta, do mais recente ao mais antigo (`Favorite.createdAt` desc).
   */
  async listWordpressPostIdsInFolder(
    userId: string,
    folderId: string
  ): Promise<{ ok: true; wordpressPostIds: number[] } | { ok: false; reason: 'folder_not_found' }> {
    await this.ensureSystemFoldersForUser(userId);
    const folder = await prisma.postFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      return { ok: false, reason: 'folder_not_found' };
    }
    const rows = await prisma.favorite.findMany({
      where: { folderId },
      orderBy: { createdAt: 'desc' },
      select: { wordpressPostId: true },
    });
    return { ok: true, wordpressPostIds: rows.map((r) => r.wordpressPostId) };
  }

  /**
   * Cria pasta customizada. Não permite nome igual às pastas do sistema.
   */
  async createCustomFolder(userId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Folder name is required');
    }
    const lower = trimmed.toLowerCase();
    if (
      lower === SYSTEM_FOLDER_NAME_LIKES.toLowerCase() ||
      lower === SYSTEM_FOLDER_NAME_SAVED.toLowerCase()
    ) {
      throw new Error('Reserved folder name');
    }
    await this.ensureSystemFoldersForUser(userId);
    return prisma.postFolder.create({
      data: {
        userId,
        name: trimmed,
        internalKey: null,
      },
    });
  }

  async deleteFolder(userId: string, folderId: string) {
    const folder = await prisma.postFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      return null;
    }
    if (folder.internalKey != null) {
      throw new Error('Cannot delete system folder');
    }
    await prisma.postFolder.delete({ where: { id: folderId } });
    return folder;
  }

  async addPostToFolder(userId: string, folderId: string, wordpressPostId: number) {
    await this.ensureSystemFoldersForUser(userId);
    const folder = await prisma.postFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    await prisma.favorite.upsert({
      where: {
        folderId_wordpressPostId: { folderId, wordpressPostId },
      },
      create: { folderId, wordpressPostId },
      update: {},
    });
    return { ok: true as const };
  }

  async removePostFromFolder(userId: string, folderId: string, wordpressPostId: number) {
    await this.ensureSystemFoldersForUser(userId);
    const folder = await prisma.postFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    await prisma.favorite.deleteMany({
      where: { folderId, wordpressPostId },
    });
    return { ok: true as const };
  }

  /** Conta likes globais (itens na pasta `curtidas` de todos os usuários). */
  async countLikesForPost(wordpressPostId: number): Promise<number> {
    return prisma.favorite.count({
      where: {
        wordpressPostId,
        folder: { internalKey: SYSTEM_FOLDER_KEY_LIKES },
      },
    });
  }

  /** Conta likes atuais do usuário (itens na pasta fixa `curtidas`). */
  async countCurrentLikesByUser(userId: string): Promise<number> {
    await this.ensureSystemFoldersForUser(userId);
    return prisma.favorite.count({
      where: {
        folder: { userId, internalKey: SYSTEM_FOLDER_KEY_LIKES },
      },
    });
  }

  /** Todas as pastas do usuário que contêm o post (inclui curtidas e Salvos). */
  async getAllFolderIdsContainingPost(
    userId: string,
    wordpressPostId: number
  ): Promise<string[]> {
    await this.ensureSystemFoldersForUser(userId);
    const rows = await prisma.favorite.findMany({
      where: {
        wordpressPostId,
        folder: { userId },
      },
      select: { folderId: true },
    });
    return rows.map((r) => r.folderId);
  }

  async isPostLikedByUser(userId: string, wordpressPostId: number): Promise<boolean> {
    await this.ensureSystemFoldersForUser(userId);
    const likesFolder = await prisma.postFolder.findFirst({
      where: { userId, internalKey: SYSTEM_FOLDER_KEY_LIKES },
    });
    if (!likesFolder) return false;
    const row = await prisma.favorite.findUnique({
      where: {
        folderId_wordpressPostId: {
          folderId: likesFolder.id,
          wordpressPostId,
        },
      },
    });
    return row != null;
  }

  /** Toggle like na pasta fixa curtidas. */
  async toggleLike(userId: string, wordpressPostId: number): Promise<{ liked: boolean }> {
    const likesFolder = await this.getLikesFolder(userId);
    const existing = await prisma.favorite.findUnique({
      where: {
        folderId_wordpressPostId: {
          folderId: likesFolder.id,
          wordpressPostId,
        },
      },
    });
    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await prisma.favorite.create({
      data: {
        folderId: likesFolder.id,
        wordpressPostId,
      },
    });
    return { liked: true };
  }
}

export const postFolderService = new PostFolderService();
