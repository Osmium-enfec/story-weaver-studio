
-- Storage bucket for voice uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-uploads', 'voice-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Open RLS policies (workspace model already open in this project)
CREATE POLICY "voice_uploads_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'voice-uploads');

CREATE POLICY "voice_uploads_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'voice-uploads');

CREATE POLICY "voice_uploads_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'voice-uploads');

CREATE POLICY "voice_uploads_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'voice-uploads');

-- Scene columns for voice sync
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS voice_url text,
  ADD COLUMN IF NOT EXISTS voice_start_ms integer,
  ADD COLUMN IF NOT EXISTS voice_end_ms integer,
  ADD COLUMN IF NOT EXISTS word_timings jsonb NOT NULL DEFAULT '[]'::jsonb;
