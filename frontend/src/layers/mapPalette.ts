/**
 * Colours for MapLibre paint properties, which take colour strings rather than Tailwind classes. Each value is the
 * design-system token named beside it (tailwind.config.js); change them together.
 */
export const MAP_PALETTE = {
  onyxBlack: '#050505',            // onyx-black
  onyxDeep: '#0a0a0a',             // onyx-deep
  surfaceHighest: '#1a1a1a',       // surface-container-highest
  outlineVariant: '#333333',       // outline-variant
  amberGoldMuted: '#4d3800',       // amber-gold-muted
} as const
