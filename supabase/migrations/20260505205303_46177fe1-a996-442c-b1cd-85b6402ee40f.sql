
-- Themes
CREATE TABLE public.themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  design_tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  preview_color TEXT,
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Concepts
CREATE TABLE public.concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  course_tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Animation components
CREATE TABLE public.animation_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  concepts TEXT[] NOT NULL DEFAULT '{}',
  course_tags TEXT[] NOT NULL DEFAULT '{}',
  preview_url TEXT,
  default_props JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  title TEXT NOT NULL,
  course_type TEXT NOT NULL DEFAULT 'Other',
  audience_level TEXT NOT NULL DEFAULT 'Beginner',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  theme TEXT NOT NULL DEFAULT 'Whiteboard',
  voice_mode TEXT NOT NULL DEFAULT 'no_voice',
  script TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  thumbnail_url TEXT,
  estimated_duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scenes
CREATE TABLE public.scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  order_index INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  narration TEXT NOT NULL DEFAULT '',
  visual_brief TEXT NOT NULL DEFAULT '',
  suggested_animation TEXT,
  detected_concepts TEXT[] NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 5000,
  transition TEXT NOT NULL DEFAULT 'fade',
  background JSONB NOT NULL DEFAULT '{"type":"color","value":"#ffffff"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scenes_project ON public.scenes(project_id, order_index);

-- Scene elements
CREATE TABLE public.scene_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  type TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  position JSONB NOT NULL DEFAULT '{"x":0,"y":0,"w":100,"h":100}'::jsonb,
  start_ms INTEGER NOT NULL DEFAULT 0,
  end_ms INTEGER NOT NULL DEFAULT 5000,
  z_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scene_elements_scene ON public.scene_elements(scene_id);

-- Media assets
CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  size_bytes BIGINT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Voice tracks
CREATE TABLE public.voice_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES public.scenes(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  duration_ms INTEGER,
  transcript TEXT,
  word_timestamps JSONB,
  source TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Render jobs
CREATE TABLE public.render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  render_plan JSONB,
  output_url TEXT,
  log TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Exports
CREATE TABLE public.exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  render_job_id UUID REFERENCES public.render_jobs(id) ON DELETE SET NULL,
  format TEXT NOT NULL DEFAULT 'mp4',
  resolution TEXT NOT NULL DEFAULT '1080p',
  url TEXT,
  srt_url TEXT,
  thumbnail_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_scenes_updated BEFORE UPDATE ON public.scenes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS, open policies for internal use (no auth yet)
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animation_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['themes','concepts','animation_components','projects','scenes','scene_elements','media_assets','voice_tracks','render_jobs','exports']) LOOP
    EXECUTE format('CREATE POLICY "open_all_%s" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
