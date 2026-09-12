-- Allow multiple calendar accounts per user (Gmail + Outlook each can have many)
DROP INDEX IF EXISTS "CalendarConnection_userId_provider_key";

CREATE UNIQUE INDEX "CalendarConnection_userId_provider_accountEmail_key" ON "CalendarConnection"("userId", "provider", "accountEmail");

CREATE INDEX "CalendarConnection_userId_provider_idx" ON "CalendarConnection"("userId", "provider");
