// Domain types mapped to DB tables
export type CourseType = "Python" | "Java" | "Android" | "Web" | "DSA" | "Database" | "API" | "Other";
export type AudienceLevel = "Beginner" | "Intermediate" | "Advanced";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type ThemeName = "Whiteboard" | "Dark Code" | "Flat Modern" | "Android UI" | "Classroom";
export type VoiceMode = "upload_voice" | "ai_voice" | "no_voice";
export type CanvasMode = "word" | "timeline";

export interface Project {
  id: string;
  workspace_id: string;
  title: string;
  course_type: CourseType;
  audience_level: AudienceLevel;
  aspect_ratio: AspectRatio;
  theme: ThemeName;
  voice_mode: VoiceMode;
  canvas_mode: CanvasMode;
  script: string;
  status: string;
  thumbnail_url: string | null;
  estimated_duration_ms: number;
  created_at: string;
  updated_at: string;
}

export interface Scene {
  id: string;
  project_id: string;
  workspace_id: string;
  order_index: number;
  title: string | null;
  narration: string;
  visual_brief: string;
  suggested_animation: string | null;
  detected_concepts: string[];
  duration_ms: number;
  transition: string;
  background: { type: string; value: string };
  created_at: string;
  updated_at: string;
}

export const WORKSPACE_ID = "default_workspace";
