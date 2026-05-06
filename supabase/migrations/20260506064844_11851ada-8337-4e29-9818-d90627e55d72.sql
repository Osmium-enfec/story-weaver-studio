
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS voice_trim_start_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_trim_end_ms integer,
  ADD COLUMN IF NOT EXISTS voice_cuts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS voice_volume real NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS voice_fade_in_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_fade_out_ms integer NOT NULL DEFAULT 0;
