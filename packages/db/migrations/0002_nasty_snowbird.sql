ALTER TABLE "calendars" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ews_account_id" uuid;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_ews_account_id_mail_accounts_id_fk" FOREIGN KEY ("ews_account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_ews_account_url" ON "calendars" USING btree ("ews_account_id","caldav_url");