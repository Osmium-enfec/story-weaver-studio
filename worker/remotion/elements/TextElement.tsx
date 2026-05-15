import { useLayoutEffect, useRef, useState } from "react";

export const TextElement: React.FC<{
  el: any;
  style: React.CSSProperties;
}> = ({ el, style }) => {
  const c = el.content ?? {};
  const align: React.CSSProperties["textAlign"] =
    (c.align as any) || (c.text_align as any) || "center";

  const justifyContent =
    align === "left"
      ? "flex-start"
      : align === "right"
      ? "flex-end"
      : "center";

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // Mirror the editor's TextBlockRenderer auto-fit: scale the text down so it
  // fits inside its element box. Without this, a large font_size on a small
  // box overflows in the rendered video while the editor preview looks fine.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    inner.style.transform = "none";
    const naturalW = inner.scrollWidth || 1;
    const naturalH = inner.scrollHeight || 1;
    const boxW = wrap.clientWidth;
    const boxH = wrap.clientHeight;
    const s = Math.max(0.05, Math.min(boxW / naturalW, boxH / naturalH, 1));
    setScale(s);
    inner.style.transform = `scale(${s})`;
  }, [
    c.text,
    c.font_size,
    c.fontSize,
    c.font_family,
    c.fontFamily,
    c.font_weight,
    c.fontWeight,
    c.line_height,
    c.lineHeight,
    style.width,
    style.height,
  ]);

  return (
    <div
      ref={wrapRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent,
        padding: c.padding ?? 0,
        background: c.background ?? "transparent",
        overflow: "hidden",
      }}
    >
      <div
        ref={innerRef}
        style={{
          display: "inline-block",
          color: c.color ?? c.fill ?? "#0f172a",
          fontFamily:
            c.font_family ||
            c.fontFamily ||
            "Inter, system-ui, -apple-system, sans-serif",
          fontSize: c.font_size ?? c.fontSize ?? 32,
          fontWeight: c.font_weight ?? c.fontWeight ?? 400,
          fontStyle: c.font_style ?? c.fontStyle ?? "normal",
          lineHeight: c.line_height ?? c.lineHeight ?? 1.2,
          letterSpacing: c.letter_spacing ?? c.letterSpacing ?? "normal",
          textAlign: align,
          textTransform:
            c.text_transform === "uppercase" ? "uppercase" : "none",
          whiteSpace: "pre",
          wordBreak: "normal",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          background: c.text_bg_color || undefined,
          padding: c.text_bg_color
            ? `${c.text_bg_padding_y ?? 12}px ${c.text_bg_padding_x ?? 24}px`
            : undefined,
          borderRadius: c.text_bg_color ? c.text_bg_radius ?? 4 : undefined,
          border:
            c.text_bg_border_color && (c.text_bg_border_width ?? 0) > 0
              ? `${c.text_bg_border_width}px solid ${c.text_bg_border_color}`
              : undefined,
        }}
      >
        {c.text ?? ""}
      </div>
    </div>
  );
};
