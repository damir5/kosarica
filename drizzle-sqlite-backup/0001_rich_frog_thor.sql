CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`appName` text DEFAULT 'Kosarica',
	`requireEmailVerification` integer DEFAULT false,
	`minPasswordLength` integer DEFAULT 8,
	`maxPasswordLength` integer DEFAULT 128,
	`passkeyEnabled` integer DEFAULT true,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user` ADD `bannedAt` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `bannedReason` text;