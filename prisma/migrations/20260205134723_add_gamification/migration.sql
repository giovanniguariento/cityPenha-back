-- Add gamification fields to users and create related tables
-- Add xp and coins to users
ALTER TABLE `users`
  ADD COLUMN `xp` INT NOT NULL DEFAULT 0,
  ADD COLUMN `coins` INT NOT NULL DEFAULT 0;

-- Create read_posts table (tracks which posts a user has fully read)
CREATE TABLE `read_posts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `wordpressPostId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `read_posts_userId_wordpressPostId_key`(`userId`, `wordpressPostId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign key to users
ALTER TABLE `read_posts` ADD CONSTRAINT `read_posts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Create missions table (defines available missions)
CREATE TABLE `missions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `target` INTEGER NOT NULL,
    `coinReward` INTEGER NOT NULL DEFAULT 0,
    `xpReward` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `missions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user_missions table (tracks per-user progress on missions)
CREATE TABLE `user_missions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `missionId` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `completed` TINYINT(1) NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `user_missions_userId_missionId_key`(`userId`, `missionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys for user_missions
ALTER TABLE `user_missions` ADD CONSTRAINT `user_missions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_missions` ADD CONSTRAINT `user_missions_missionId_fkey` FOREIGN KEY (`missionId`) REFERENCES `missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default mission: read_10_posts
INSERT INTO `missions` (`id`, `key`, `title`, `description`, `target`, `coinReward`, `xpReward`, `createdAt`)
VALUES (UUID(), 'read_10_posts', 'Read 10 posts', 'Read 10 different posts to complete this mission.', 10, 50, 0, NOW());

