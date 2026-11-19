CREATE TABLE `backlog_imports` (
	`run` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text,
	`state` text DEFAULT 'running' NOT NULL,
	`result` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`acceptance_criteria` text NOT NULL,
	`non_goals` text NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`import_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_id_import_key_key` ON `tasks` (`project_id`,`import_key`);--> statement-breakpoint
CREATE INDEX `tasks_project_id_status_idx` ON `tasks` (`project_id`,`status`);