ALTER TABLE `scenario_sessions` ADD `cleared_at` integer;--> statement-breakpoint
UPDATE `scenario_sessions` SET `cleared_at` = `ended_at` WHERE `id` IN (SELECT `scenario_session_id` FROM `session_log` WHERE `text` LIKE 'シナリオクリア%');
