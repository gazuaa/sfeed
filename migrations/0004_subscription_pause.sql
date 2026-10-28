-- A subscriber can stop receiving a feed's new articles without unsubscribing.
-- Articles first stored after paused_at stay hidden from that subscriber.
ALTER TABLE subscriptions ADD COLUMN paused_at TEXT;
