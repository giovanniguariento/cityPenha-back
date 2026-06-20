-- AlterTable
ALTER TABLE `users` ADD COLUMN `wordpressUsername` VARCHAR(60) NULL,
    ADD COLUMN `wordpressPasswordEnc` TEXT NULL;
