-- Where to deliver a popup notification (Web Push, CLAUDE.md ข้อ 10).
--
-- When someone allows notifications, the browser hands back an address on its
-- vendor's push service plus two keys that let only that browser read what is
-- sent. The server has to keep them: the whole point is reaching someone who
-- does not have the site open, and this table is the only way to know where
-- they are. One person may allow it on several devices, so one row per browser.

CREATE TABLE "push_subscriptions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    -- The browser's address on its push service. Unique, because one browser
    -- has exactly one: when somebody else signs in on the same browser the row
    -- moves to them instead of both people receiving each other's popups.
    "endpoint" TEXT NOT NULL,
    -- The browser's public key and auth secret, used to encrypt each message so
    -- the push service relays it without being able to read it.
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
