-- A deleted message leaves the search index: the update trigger only re-inserts live rows.
DROP TRIGGER `messages_fts_au`;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF `body`, `deleted_at` ON `messages` BEGIN
  INSERT INTO `messages_fts`(`messages_fts`, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO `messages_fts`(rowid, body) SELECT new.rowid, new.body WHERE new.deleted_at IS NULL;
END;
