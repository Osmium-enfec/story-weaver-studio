
ALTER TABLE public.animation_components
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS lottie_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS color_support text NOT NULL DEFAULT 'fixed';

INSERT INTO storage.buckets (id, name, public)
VALUES ('lottie-uploads', 'lottie-uploads', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "lottie_uploads_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lottie-uploads');

CREATE POLICY "lottie_uploads_public_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'lottie-uploads');

CREATE POLICY "lottie_uploads_public_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'lottie-uploads');

CREATE POLICY "lottie_uploads_public_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'lottie-uploads');
