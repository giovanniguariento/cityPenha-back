-- Gamificação dinâmica: torna missions/levels data-driven e adiciona badges + ledger.
-- Idempotente onde possível (use IF NOT EXISTS / IF EXISTS quando suportado pelo MariaDB).

-- ============================================================
-- 1) Estende `missions` com metadados, métrica primária e critério opcional.
-- ============================================================
ALTER TABLE `missions`
  ADD COLUMN `iconUrl` VARCHAR(191) NULL,
  ADD COLUMN `category` VARCHAR(64) NULL,
  ADD COLUMN `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN `startsAt` DATETIME(3) NULL,
  ADD COLUMN `endsAt` DATETIME(3) NULL,
  ADD COLUMN `metricKey` VARCHAR(64) NOT NULL DEFAULT 'total_reads',
  ADD COLUMN `metricParams` JSON NULL,
  ADD COLUMN `criteria` JSON NULL,
  ADD COLUMN `isReversible` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- Mapeia chaves hardcoded existentes para o novo modelo data-driven.
UPDATE `missions` SET `metricKey` = 'total_reads',                `isReversible` = 0 WHERE `key` = 'read_10_posts';
UPDATE `missions` SET `metricKey` = 'consecutive_reading_days',  `isReversible` = 1 WHERE `key` = 'read_7_days';
UPDATE `missions` SET `metricKey` = 'total_likes',                `isReversible` = 1 WHERE `key` = 'like_10_posts';
UPDATE `missions` SET `metricKey` = 'total_saves',                `isReversible` = 1 WHERE `key` = 'save_10_posts';

-- ============================================================
-- 2) Estende `levels` com título, ícone e recompensas por subida.
-- ============================================================
ALTER TABLE `levels`
  ADD COLUMN `title` VARCHAR(191) NULL,
  ADD COLUMN `iconUrl` VARCHAR(191) NULL,
  ADD COLUMN `rewardCoins` INT NOT NULL DEFAULT 0,
  ADD COLUMN `rewardXp` INT NOT NULL DEFAULT 0;

-- ============================================================
-- 3) Tabela `badges` — catálogo de insígnias data-driven.
-- ============================================================
CREATE TABLE `badges` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `metricKey` VARCHAR(64) NULL,
    `metricParams` JSON NULL,
    `threshold` INT NULL,
    `criteria` JSON NULL,
    `isActive` TINYINT(1) NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `badges_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- 4) Tabela `user_badges` — concessões de badge por usuário.
-- ============================================================
CREATE TABLE `user_badges` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,
    `earnedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_badges_userId_badgeId_key`(`userId`, `badgeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_badges`
  ADD CONSTRAINT `user_badges_userId_fkey`  FOREIGN KEY (`userId`)  REFERENCES `users`(`id`)  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_badges_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `badges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 5) Tabela `reward_ledger` — log imutável de XP/coins concedidos ou estornados.
-- ============================================================
CREATE TABLE `reward_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(32) NOT NULL,
    `coinsDelta` INT NOT NULL DEFAULT 0,
    `xpDelta` INT NOT NULL DEFAULT 0,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reward_ledger_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reward_ledger`
  ADD CONSTRAINT `reward_ledger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 6) Seed de badges de exemplo (todas opt-out via isActive=0 se desejado).
-- ============================================================
INSERT INTO `badges` (`id`, `key`, `title`, `description`, `metricKey`, `threshold`, `isActive`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'first_steps',      'Primeiros passos',     'Complete sua primeira missão.',                'missions_completed', 1,  1, NOW(3), NOW(3)),
  (UUID(), 'mission_explorer', 'Explorador de Missões', 'Complete 3 missões diferentes.',               'missions_completed', 3,  1, NOW(3), NOW(3)),
  (UUID(), 'mission_master',   'Mestre das Missões',    'Complete 5 missões diferentes.',               'missions_completed', 5,  1, NOW(3), NOW(3)),
  (UUID(), 'avid_reader',      'Leitor Ávido',          'Leia 25 publicações distintas.',                'total_reads',        25, 1, NOW(3), NOW(3)),
  (UUID(), 'streak_week',      'Constância',            'Mantenha 7 dias consecutivos lendo.',           'consecutive_reading_days', 7, 1, NOW(3), NOW(3));
