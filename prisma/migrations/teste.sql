START TRANSACTION;

-- 1) WP users ligados a firebaseUid via users.wordpressId
CREATE TEMPORARY TABLE tmp_wp_user_ids (
  wp_id BIGINT UNSIGNED PRIMARY KEY
);

INSERT INTO tmp_wp_user_ids (wp_id)
SELECT DISTINCT u.wordpressId
FROM users u
WHERE u.wordpressId IS NOT NULL
  AND u.firebaseUid IS NOT NULL;  -- todos têm, mas deixa explícito

-- 2) Author terms PublishPress desses WP users
CREATE TEMPORARY TABLE tmp_author_term_ids (
  term_id BIGINT UNSIGNED PRIMARY KEY
);

INSERT INTO tmp_author_term_ids (term_id)
SELECT DISTINCT te.term_id
FROM wp_termmeta te
INNER JOIN wp_term_taxonomy tt
  ON tt.term_id = te.term_id
 AND tt.taxonomy = 'author'
INNER JOIN tmp_wp_user_ids t
  ON te.meta_key = CONCAT('user_id_', t.wp_id);

-- 3) PublishPress
DELETE ppar
FROM wp_ppma_author_relationships ppar
INNER JOIN tmp_wp_user_ids t ON ppar.author_user_id = t.wp_id;

DELETE tm
FROM wp_termmeta tm
INNER JOIN tmp_author_term_ids tat ON tat.term_id = tm.term_id;

DELETE tr
FROM wp_term_relationships tr
INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
INNER JOIN tmp_author_term_ids tat ON tat.term_id = tt.term_id;

DELETE tt
FROM wp_term_taxonomy tt
INNER JOIN tmp_author_term_ids tat ON tat.term_id = tt.term_id;

DELETE t
FROM wp_terms t
INNER JOIN tmp_author_term_ids tat ON tat.term_id = t.term_id;

-- 4) Comentários nativos WP desses usuários (se houver)
DELETE cm
FROM wp_commentmeta cm
INNER JOIN wp_comments c ON c.comment_ID = cm.comment_id
INNER JOIN tmp_wp_user_ids t ON c.user_id = t.wp_id;

DELETE c
FROM wp_comments c
INNER JOIN tmp_wp_user_ids t ON c.user_id = t.wp_id;

-- 5) Metadados e usuários WordPress (preserva admin ID 1)
DELETE um
FROM wp_usermeta um
INNER JOIN tmp_wp_user_ids t ON um.user_id = t.wp_id
WHERE t.wp_id > 1;

DELETE wu
FROM wp_users wu
INNER JOIN tmp_wp_user_ids t ON wu.ID = t.wp_id
WHERE wu.ID > 1;

-- 6) App: apaga users (firebaseUid) + histórico via CASCADE
--    favorites, read_posts, liked_posts, comments, gamification, etc.
DELETE FROM users;

-- 7) Opcional: views anônimas
TRUNCATE TABLE post_views;

DROP TEMPORARY TABLE tmp_author_term_ids;
DROP TEMPORARY TABLE tmp_wp_user_ids;

COMMIT;