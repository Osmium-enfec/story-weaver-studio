/**
 * Minimal shape renderer. Mirrors the small set of shapes used by the
 * editor's ShapeGlyph. Extend as new shape types are added in the app.
 */
export const ShapeElement: React.FC<{
  el: any;
  style: React.CSSProperties;
}> = ({ el, style }) => {
  const c = el.content ?? {};
  const fill = c.fill ?? c.color ?? "#0f172a";
  const stroke = c.stroke ?? "transparent";
  const strokeWidth = c.stroke_width ?? 0;
  const radius =
    c.shape_type === "circle"
      ? "50%"
      : c.shape_type === "rounded"
      ? c.radius ?? 16
      : 0;

  if (c.shape_type === "line") {
    return (
      <div style={style}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            stroke={fill}
            strokeWidth={strokeWidth || 4}
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      style={{
        ...style,
        background: fill,
        border: stroke !== "transparent" ? `${strokeWidth}px solid ${stroke}` : undefined,
        borderRadius: radius,
      }}
    />
  );
};
