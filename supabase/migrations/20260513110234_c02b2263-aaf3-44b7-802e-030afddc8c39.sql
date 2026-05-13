ALTER TABLE public.scenes
ADD COLUMN IF NOT EXISTS director_plan jsonb NOT NULL DEFAULT '{}'::jsonb;