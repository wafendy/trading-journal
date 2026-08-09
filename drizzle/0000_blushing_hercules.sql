CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`upeti` real NOT NULL,
	`entry_price` real NOT NULL,
	`sl_price` real NOT NULL,
	`tp_price` real,
	`entry_type` text NOT NULL,
	`entry_signal` text NOT NULL,
	`entry_date` text NOT NULL,
	`verify_days` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fill_date` text,
	`dud_decision` text,
	`exit_price` real,
	`exit_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
