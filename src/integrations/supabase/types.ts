export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      animation_components: {
        Row: {
          category: string
          color_support: string
          concepts: string[]
          course_tags: string[]
          created_at: string
          default_props: Json
          description: string | null
          external_id: string | null
          id: string
          lottie_url: string | null
          name: string
          preview_url: string | null
          provider: string
          slug: string
          tags: string[]
          thumbnail_url: string | null
          video_url: string | null
        }
        Insert: {
          category: string
          color_support?: string
          concepts?: string[]
          course_tags?: string[]
          created_at?: string
          default_props?: Json
          description?: string | null
          external_id?: string | null
          id?: string
          lottie_url?: string | null
          name: string
          preview_url?: string | null
          provider?: string
          slug: string
          tags?: string[]
          thumbnail_url?: string | null
          video_url?: string | null
        }
        Update: {
          category?: string
          color_support?: string
          concepts?: string[]
          course_tags?: string[]
          created_at?: string
          default_props?: Json
          description?: string | null
          external_id?: string | null
          id?: string
          lottie_url?: string | null
          name?: string
          preview_url?: string | null
          provider?: string
          slug?: string
          tags?: string[]
          thumbnail_url?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      concepts: {
        Row: {
          aliases: string[]
          category: string
          course_tags: string[]
          created_at: string
          difficulty: string
          id: string
          keywords: string[]
          name: string
        }
        Insert: {
          aliases?: string[]
          category: string
          course_tags?: string[]
          created_at?: string
          difficulty?: string
          id?: string
          keywords?: string[]
          name: string
        }
        Update: {
          aliases?: string[]
          category?: string
          course_tags?: string[]
          created_at?: string
          difficulty?: string
          id?: string
          keywords?: string[]
          name?: string
        }
        Relationships: []
      }
      exports: {
        Row: {
          created_at: string
          format: string
          id: string
          project_id: string
          render_job_id: string | null
          resolution: string
          settings: Json
          srt_url: string | null
          thumbnail_url: string | null
          url: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          format?: string
          id?: string
          project_id: string
          render_job_id?: string | null
          resolution?: string
          settings?: Json
          srt_url?: string | null
          thumbnail_url?: string | null
          url?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          format?: string
          id?: string
          project_id?: string
          render_job_id?: string | null
          resolution?: string
          settings?: Json
          srt_url?: string | null
          thumbnail_url?: string | null
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_render_job_id_fkey"
            columns: ["render_job_id"]
            isOneToOne: false
            referencedRelation: "render_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          created_at: string
          duration_ms: number | null
          filename: string
          id: string
          metadata: Json
          project_id: string | null
          size_bytes: number | null
          source: string
          tags: string[]
          thumbnail_url: string | null
          type: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          filename: string
          id?: string
          metadata?: Json
          project_id?: string | null
          size_bytes?: number | null
          source?: string
          tags?: string[]
          thumbnail_url?: string | null
          type: string
          url: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          filename?: string
          id?: string
          metadata?: Json
          project_id?: string | null
          size_bytes?: number | null
          source?: string
          tags?: string[]
          thumbnail_url?: string | null
          type?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          aspect_ratio: string
          audience_level: string
          course_type: string
          created_at: string
          estimated_duration_ms: number
          id: string
          script: string
          status: string
          theme: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          voice_mode: string
          workspace_id: string
        }
        Insert: {
          aspect_ratio?: string
          audience_level?: string
          course_type?: string
          created_at?: string
          estimated_duration_ms?: number
          id?: string
          script?: string
          status?: string
          theme?: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          voice_mode?: string
          workspace_id?: string
        }
        Update: {
          aspect_ratio?: string
          audience_level?: string
          course_type?: string
          created_at?: string
          estimated_duration_ms?: number
          id?: string
          script?: string
          status?: string
          theme?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          voice_mode?: string
          workspace_id?: string
        }
        Relationships: []
      }
      render_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          log: string | null
          output_url: string | null
          progress: number
          project_id: string
          render_plan: Json | null
          settings: Json
          status: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          log?: string | null
          output_url?: string | null
          progress?: number
          project_id: string
          render_plan?: Json | null
          settings?: Json
          status?: string
          workspace_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          log?: string | null
          output_url?: string | null
          progress?: number
          project_id?: string
          render_plan?: Json | null
          settings?: Json
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_elements: {
        Row: {
          content: Json
          created_at: string
          end_ms: number
          id: string
          position: Json
          scene_id: string
          start_ms: number
          type: string
          workspace_id: string
          z_index: number
        }
        Insert: {
          content?: Json
          created_at?: string
          end_ms?: number
          id?: string
          position?: Json
          scene_id: string
          start_ms?: number
          type: string
          workspace_id?: string
          z_index?: number
        }
        Update: {
          content?: Json
          created_at?: string
          end_ms?: number
          id?: string
          position?: Json
          scene_id?: string
          start_ms?: number
          type?: string
          workspace_id?: string
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "scene_elements_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          background: Json
          created_at: string
          detected_concepts: string[]
          director_plan: Json
          duration_ms: number
          id: string
          narration: string
          order_index: number
          project_id: string
          storyboard: Json
          suggested_animation: string | null
          title: string | null
          transition: string
          updated_at: string
          visual_brief: string
          voice_cuts: Json
          voice_end_ms: number | null
          voice_fade_in_ms: number
          voice_fade_out_ms: number
          voice_start_ms: number | null
          voice_trim_end_ms: number | null
          voice_trim_start_ms: number
          voice_url: string | null
          voice_volume: number
          word_timings: Json
          workspace_id: string
        }
        Insert: {
          background?: Json
          created_at?: string
          detected_concepts?: string[]
          director_plan?: Json
          duration_ms?: number
          id?: string
          narration?: string
          order_index?: number
          project_id: string
          storyboard?: Json
          suggested_animation?: string | null
          title?: string | null
          transition?: string
          updated_at?: string
          visual_brief?: string
          voice_cuts?: Json
          voice_end_ms?: number | null
          voice_fade_in_ms?: number
          voice_fade_out_ms?: number
          voice_start_ms?: number | null
          voice_trim_end_ms?: number | null
          voice_trim_start_ms?: number
          voice_url?: string | null
          voice_volume?: number
          word_timings?: Json
          workspace_id?: string
        }
        Update: {
          background?: Json
          created_at?: string
          detected_concepts?: string[]
          director_plan?: Json
          duration_ms?: number
          id?: string
          narration?: string
          order_index?: number
          project_id?: string
          storyboard?: Json
          suggested_animation?: string | null
          title?: string | null
          transition?: string
          updated_at?: string
          visual_brief?: string
          voice_cuts?: Json
          voice_end_ms?: number | null
          voice_fade_in_ms?: number
          voice_fade_out_ms?: number
          voice_start_ms?: number | null
          voice_trim_end_ms?: number | null
          voice_trim_start_ms?: number
          voice_url?: string | null
          voice_volume?: number
          word_timings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      themes: {
        Row: {
          created_at: string
          description: string | null
          design_tokens: Json
          id: string
          is_system: boolean
          name: string
          preview_color: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          design_tokens?: Json
          id?: string
          is_system?: boolean
          name: string
          preview_color?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          design_tokens?: Json
          id?: string
          is_system?: boolean
          name?: string
          preview_color?: string | null
        }
        Relationships: []
      }
      user_themes: {
        Row: {
          created_at: string
          data: Json
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          name: string
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      voice_tracks: {
        Row: {
          created_at: string
          duration_ms: number | null
          id: string
          project_id: string
          scene_id: string | null
          source: string
          transcript: string | null
          url: string
          word_timestamps: Json | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          project_id: string
          scene_id?: string | null
          source?: string
          transcript?: string | null
          url: string
          word_timestamps?: Json | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          id?: string
          project_id?: string
          scene_id?: string | null
          source?: string
          transcript?: string | null
          url?: string
          word_timestamps?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_tracks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_tracks_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
