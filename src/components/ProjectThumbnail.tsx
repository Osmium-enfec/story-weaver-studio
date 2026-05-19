import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExportSceneStage, type ExportSceneData } from "@/components/ExportSceneStage";
import { DESIGN } from "@/lib/grid";
import { Film } from "lucide-react";

export function ProjectThumbnail({ projectId }: { projectId: string }) {
  const [scene, setScene] = useState<ExportSceneData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("scenes")
        .select("id, background, duration_ms, scene_elements(*)")
        .eq("project_id", projectId)
        .order("order_index")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const els = ((data as any).scene_elements ?? []).map((e: any) => ({
          id: e.id,
          type: e.type,
          content: e.content ?? {},
          position: e.position ?? { x: 0, y: 0, w: 100, h: 100 },
          z_index: e.z_index ?? 0,
        }));
        setScene({
          id: data.id as string,
          background: (data as any).background ?? { type: "color", value: "#ffffff" },
          elements: els,
          duration_ms: (data as any).duration_ms ?? 4000,
        });
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setScale(w / DESIGN.w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-gradient-to-br from-primary/20 to-accent"
    >
      {scene ? (
        <div
          style={{
            width: DESIGN.w,
            height: DESIGN.h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        >
          <ExportSceneStage scene={scene} isPlaying={false} currentMs={0} />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-primary">
          <Film className={`h-10 w-10 opacity-40 ${loaded ? "" : "animate-pulse"}`} />
        </div>
      )}
    </div>
  );
}
