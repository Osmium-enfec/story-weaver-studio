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

  return (
    <div
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent,
        padding: c.padding ?? 0,
        color: c.color ?? c.fill ?? "#0f172a",
        background: c.background ?? "transparent",
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
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {c.text ?? ""}
    </div>
  );
};
