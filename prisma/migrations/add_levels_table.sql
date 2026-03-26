-- Criação da tabela levels
CREATE TABLE `levels` (
  `id` VARCHAR(191) NOT NULL,
  `levelNumber` INT NOT NULL,
  `minXp` INT NOT NULL DEFAULT 0,
  `minCompletedMissions` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `levels_levelNumber_key`(`levelNumber`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;