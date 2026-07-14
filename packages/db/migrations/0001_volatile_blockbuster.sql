CREATE TYPE "public"."mail_protocol" AS ENUM('imap', 'ews');--> statement-breakpoint
ALTER TABLE "mail_accounts" ALTER COLUMN "imap_host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ALTER COLUMN "imap_user" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ALTER COLUMN "imap_password_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ALTER COLUMN "smtp_host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ALTER COLUMN "smtp_user" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ALTER COLUMN "smtp_password_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "protocol" "mail_protocol" DEFAULT 'imap' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "ews_url" text;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "ews_user" text;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "ews_password_enc" text;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD COLUMN "ews_domain" text;--> statement-breakpoint
ALTER TABLE "mail_folders" ADD COLUMN "ews_folder_id" text;--> statement-breakpoint
ALTER TABLE "mail_folders" ADD COLUMN "ews_sync_state" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "ews_item_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_folder_ews_item" ON "mail_messages" USING btree ("folder_id","ews_item_id");