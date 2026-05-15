// Mirrors the WHITE_KEY filter used by AnimationBlock in the editor so renders
// match the preview when an element has `remove_background: true`.
export const WHITE_KEY_FILTER_ID = "anim-white-key";

export function WhiteKeyFilterDef() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id={WHITE_KEY_FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1 0 0 0 1" result="wR" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 -1 0 0 1" result="wG" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -1 0 1" result="wB" />
          <feBlend in="wR" in2="wG" mode="lighten" result="wRG" />
          <feBlend in="wRG" in2="wB" mode="lighten" result="whiteAlpha" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="dR" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 1 0 0 0" result="dG" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="dB" />
          <feBlend in="dR" in2="dG" mode="lighten" result="dRG" />
          <feBlend in="dRG" in2="dB" mode="lighten" result="darkAlpha" />
          <feComposite in="whiteAlpha" in2="darkAlpha" operator="arithmetic"
            k1="1" k2="0" k3="0" k4="0" result="rawAlpha" />
          <feComponentTransfer in="rawAlpha" result="keyAlpha">
            <feFuncA type="linear" slope="10" intercept="-1.2" />
          </feComponentTransfer>
          <feComposite in="SourceGraphic" in2="keyAlpha" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

export function whiteKeyFilterCss(enabled?: boolean) {
  return enabled ? `url(#${WHITE_KEY_FILTER_ID})` : undefined;
}
