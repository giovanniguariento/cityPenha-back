-- Opcional: executar manualmente após `add_liked_posts_table.sql` e após a missão `like_10_posts`
-- existir em `missions` (ex.: primeiro deploy que chama ensureDefaultMissions).
--
-- 1) Copia histórico de curtidas a partir de `favorites` na pasta fixa `likes`.
-- 2) Sincroniza `user_missions` (progresso / completed). Não concede moedas retroativas;
--    usuários que já tinham 10+ curtidas ficam com a missão concluída sem crédito extra de coins.

INSERT INTO `liked_posts` (`id`, `userId`, `wordpressPostId`, `createdAt`)
SELECT UUID(), `pf`.`userId`, `f`.`wordpressPostId`, MIN(`f`.`createdAt`)
FROM `favorites` `f`
INNER JOIN `post_folders` `pf` ON `pf`.`id` = `f`.`folderId`
WHERE `pf`.`internalKey` = 'likes'
GROUP BY `pf`.`userId`, `f`.`wordpressPostId`
ON DUPLICATE KEY UPDATE `liked_posts`.`userId` = `liked_posts`.`userId`;

INSERT INTO `user_missions` (`id`, `userId`, `missionId`, `progress`, `completed`, `completedAt`)
SELECT UUID(), `lc`.`userId`, `m`.`id`,
       LEAST(10, `lc`.`c`),
       (`lc`.`c` >= 10),
       IF(`lc`.`c` >= 10, NOW(), NULL)
FROM (
  SELECT `userId`, COUNT(*) AS `c` FROM `liked_posts` GROUP BY `userId`
) `lc`
CROSS JOIN `missions` `m`
WHERE `m`.`key` = 'like_10_posts'
  AND NOT EXISTS (
    SELECT 1 FROM `user_missions` `um`
    WHERE `um`.`userId` = `lc`.`userId` AND `um`.`missionId` = `m`.`id`
  );

UPDATE `user_missions` `um`
INNER JOIN `missions` `m` ON `m`.`id` = `um`.`missionId` AND `m`.`key` = 'like_10_posts'
INNER JOIN (
  SELECT `userId`, COUNT(*) AS `c` FROM `liked_posts` GROUP BY `userId`
) `lc` ON `lc`.`userId` = `um`.`userId`
SET
  `um`.`progress` = LEAST(10, `lc`.`c`),
  `um`.`completed` = IF(`lc`.`c` >= 10, 1, `um`.`completed`),
  `um`.`completedAt` = IF(`lc`.`c` >= 10, IFNULL(`um`.`completedAt`, NOW()), `um`.`completedAt`);
