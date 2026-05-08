-- Add optional profile fields: nickname and about
ALTER TABLE `users`
  ADD COLUMN `nickname` VARCHAR(191) NULL,
  ADD COLUMN `about` TEXT NULL;
