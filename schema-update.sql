-- Sharankrishna Short Film Awards — schema update for Cashfree integration
-- Run in Supabase SQL Editor (project flwlbraeyyrofkhxnvwt)
-- Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS)

-- Add Cashfree/email columns to film_entries
ALTER TABLE public.film_entries
  ADD COLUMN IF NOT EXISTS payment_method      text,
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_sent   boolean NOT NULL DEFAULT false;

-- Index for dedup/idempotency checks (may already exist)
CREATE UNIQUE INDEX IF NOT EXISTS film_entries_cashfree_order_id_key
  ON public.film_entries (cashfree_order_id);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'film_entries'
ORDER BY ordinal_position;

-- Direct Submission Links (added in phase 2)
-- Run this in Supabase SQL Editor if not already applied via MCP migration
CREATE TABLE IF NOT EXISTS public.submission_links (
  id          bigserial PRIMARY KEY,
  token       text NOT NULL UNIQUE,
  label       text NOT NULL,
  note        text,
  max_uses    integer NOT NULL DEFAULT 0,
  use_count   integer NOT NULL DEFAULT 0,
  expires_at  timestamptz,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.submission_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.film_entries
  ADD COLUMN IF NOT EXISTS source  text,
  ADD COLUMN IF NOT EXISTS link_id bigint REFERENCES public.submission_links(id);

CREATE INDEX IF NOT EXISTS submission_links_token_idx ON public.submission_links (token);
