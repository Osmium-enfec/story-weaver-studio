ALTER TABLE public.scenes
ADD COLUMN IF NOT EXISTS transitions jsonb NOT NULL DEFAULT '[]'::jsonb;