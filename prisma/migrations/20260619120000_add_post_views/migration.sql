-- post_views + index on read_posts.wordpressPostId

CREATE TABLE `post_views` (
    `id` VARCHAR(191) NOT NULL,
    `wordpressPostId` INTEGER NOT NULL,
    `visitorKey` VARCHAR(191) NOT NULL,
    `ipHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `post_views_visitorKey_wordpressPostId_key`(`visitorKey`, `wordpressPostId`),
    INDEX `post_views_wordpressPostId_idx`(`wordpressPostId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `read_posts_wordpressPostId_idx` ON `read_posts`(`wordpressPostId`);
