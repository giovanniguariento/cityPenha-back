-- AlterTable
ALTER TABLE `users` ADD COLUMN `canCreateExperiences` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `experiences` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(200) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NOT NULL,
    `coverUrl` VARCHAR(1000) NOT NULL,
    `xpReward` INTEGER NOT NULL DEFAULT 0,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `isAd` BOOLEAN NOT NULL DEFAULT false,
    `venue` VARCHAR(300) NOT NULL,
    `address` VARCHAR(500) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `timeLabel` VARCHAR(100) NOT NULL,
    `conditionLabel` VARCHAR(200) NULL,
    `tags` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'published',
    `createdByUserId` VARCHAR(191) NOT NULL,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `shareCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `experiences_slug_key`(`slug`),
    INDEX `experiences_status_startsAt_idx`(`status`, `startsAt`),
    INDEX `experiences_status_featured_startsAt_idx`(`status`, `featured`, `startsAt`),
    INDEX `experiences_createdByUserId_idx`(`createdByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experience_likes` (
    `id` VARCHAR(191) NOT NULL,
    `experienceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `experience_likes_userId_idx`(`userId`),
    UNIQUE INDEX `experience_likes_experienceId_userId_key`(`experienceId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experience_shares` (
    `id` VARCHAR(191) NOT NULL,
    `experienceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `experience_shares_userId_idx`(`userId`),
    UNIQUE INDEX `experience_shares_experienceId_userId_key`(`experienceId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experience_comments` (
    `id` VARCHAR(191) NOT NULL,
    `experienceId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `experience_comments_experienceId_parentId_createdAt_idx`(`experienceId`, `parentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experience_comment_likes` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `experience_comment_likes_commentId_userId_key`(`commentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `experiences` ADD CONSTRAINT `experiences_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_likes` ADD CONSTRAINT `experience_likes_experienceId_fkey` FOREIGN KEY (`experienceId`) REFERENCES `experiences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_likes` ADD CONSTRAINT `experience_likes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_shares` ADD CONSTRAINT `experience_shares_experienceId_fkey` FOREIGN KEY (`experienceId`) REFERENCES `experiences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_shares` ADD CONSTRAINT `experience_shares_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_comments` ADD CONSTRAINT `experience_comments_experienceId_fkey` FOREIGN KEY (`experienceId`) REFERENCES `experiences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_comments` ADD CONSTRAINT `experience_comments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_comments` ADD CONSTRAINT `experience_comments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `experience_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_comment_likes` ADD CONSTRAINT `experience_comment_likes_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `experience_comments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experience_comment_likes` ADD CONSTRAINT `experience_comment_likes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
