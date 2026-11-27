ALTER TABLE `tasks` ADD `type` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_key` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `status` text DEFAULT 'backlog' NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_by_parent` ON `tasks` (`project_id`,`source_id`,`parent_key`);--> statement-breakpoint
UPDATE tasks SET status = 'done' WHERE json_extract(extras, '$.statusCategory') = 'done';