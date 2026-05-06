CREATE TABLE public.user_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default_workspace',
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all_user_themes" ON public.user_themes
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER user_themes_updated_at
  BEFORE UPDATE ON public.user_themes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();