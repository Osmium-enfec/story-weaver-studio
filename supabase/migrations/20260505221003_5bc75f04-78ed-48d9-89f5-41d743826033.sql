-- Extend animation_components for cached external assets
ALTER TABLE public.animation_components
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS animation_components_provider_external_id_idx
  ON public.animation_components (provider, external_id)
  WHERE external_id IS NOT NULL;

-- Public bucket for mirrored animation files (mp4 previews, lottie json)
INSERT INTO storage.buckets (id, name, public)
VALUES ('animation-cache', 'animation-cache', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "animation_cache_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'animation-cache');

-- Server-side writes only (service role bypasses RLS; this just blocks anon writes)
CREATE POLICY "animation_cache_no_anon_write"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'animation-cache' AND auth.role() = 'service_role');
