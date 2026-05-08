-- Post folders (curtidas, Salvos, custom) + favorites as folder items

CREATE TABLE `post_folders` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `internalKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `post_folders_userId_internalKey_key`(`userId`, `internalKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `post_folders` ADD CONSTRAINT `post_folders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Default system folders for every existing user
INSERT INTO `post_folders` (`id`, `userId`, `name`, `internalKey`, `createdAt`)
SELECT UUID(), `id`, 'curtidas', 'likes', NOW(3) FROM `users`;

INSERT INTO `post_folders` (`id`, `userId`, `name`, `internalKey`, `createdAt`)
SELECT UUID(), `id`, 'Salvos', 'default_saved', NOW(3) FROM `users`;

-- Repurpose favorites: add folderId, migrate old rows into "Salvos" folder
ALTER TABLE `favorites` ADD COLUMN `folderId` VARCHAR(191) NULL;

UPDATE `favorites` `f`
INNER JOIN `post_folders` `pf`
  ON `pf`.`userId` = `f`.`userId` AND `pf`.`internalKey` = 'default_saved'
SET `f`.`folderId` = `pf`.`id`;

ALTER TABLE `favorites` DROP FOREIGN KEY `favorites_userId_fkey`;
ALTER TABLE `favorites` DROP INDEX `favorites_userId_wordpressPostId_key`;
ALTER TABLE `favorites` DROP COLUMN `userId`;

ALTER TABLE `favorites` MODIFY COLUMN `folderId` VARCHAR(191) NOT NULL;

ALTER TABLE `favorites` ADD CONSTRAINT `favorites_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `post_folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `favorites` ADD UNIQUE INDEX `favorites_folderId_wordpressPostId_key`(`folderId`, `wordpressPostId`);
