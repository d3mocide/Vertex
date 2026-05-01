You are about to make a frontend change on the Vertex project. Before writing any code, review the design system rules below and apply them to every decision.

The canonical source of truth is `/home/user/Vertex/vertex-design-system.html`. This skill is a fast-reference summary — consult the HTML file for full component specs and animation details.

---

## IDENTITY

**Brand** — VERTEX · SITUATIONAL AWARENESS  
**Direction** — 07 · SCOPE (adopted 2026-05-01)  
**Theme** — DARK ONLY  
**Radius** — 0px everywhere. The only exception is `rounded-full` (9999px) for circular indicators.

---

## CANONICAL LOGO — Scope Mark

Use this exact SVG. Do not modify stroke weights, corner positions, or pip color.

```svg
<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="text-white">
  <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
    <path d="M2 8 V2 H8"/>
    <path d="M24 2 H30 V8"/>
    <path d="M30 24 V30 H24"/>
    <path d="M8 30 H2 V24"/>
  </g>
  <polygon points="16,7 25,16 16,25 7,16" fill="none" stroke="currentColor" strokeWidth="2"/>
  <rect x="14" y="14" width="4" height="4" fill="#FFB800"/>
</svg>
```

**Scale rules:**
- 16px — favicon floor (minimum)
- 20px — inline UI
- 24px — avatar
- 28px — ops header / sidebar
- 40px — splash
- 56px — lockup / login
- 72–96px — marketing / hero

**Never:** recolor the pip · round corners · add a background plate · outline the wordmark · use the legacy circle crosshair.

---

## COLOR TOKENS (Tailwind class → hex)

### Surfaces
| Token | Hex | Use |
|-------|-----|-----|
| `bg-onyx-black` | `#050505` | Page background, deepest surface |
| `bg-onyx-deep` | `#0A0A0A` | Panel headers, nav chrome |
| `bg-surface-container` | `#0F0F0F` | Cards, panels |
| `bg-surface-container-low` | `#080808` | Recessed areas |
| `bg-surface-container-high` | `#141414` | Elevated cards |
| `bg-surface-container-highest` | `#1A1A1A` | Tooltips, modals |

### Primary accent
| Token | Hex | Use |
|-------|-----|-----|
| `text-amber-gold` / `bg-amber-gold` | `#FFB800` | Signal accent, active states, pip |
| `text-amber-gold-dim` | `#B88600` | Dimmed amber text |
| `border-amber-gold-muted` | `#4D3800` | Subtle amber borders |

### Foreground
| Token | Hex | Use |
|-------|-----|-----|
| `text-on-surface` | `#F2F2F2` | Primary text |
| `text-on-surface-variant` | `#8C8C8C` | Labels, metadata, secondary text |
| `border-outline-variant` | `#333333` | Component borders |

### Signal colors (data only — never decorative)
| Token | Hex | Signal |
|-------|-----|--------|
| `text-cyan-adsb` / `bg-cyan-adsb` | `#00BFFF` | Aircraft (ADS-B) |
| `text-green-ais` / `bg-green-ais` | `#00C853` | Vessels (AIS) · live/nominal |
| `text-amber-p25` / `bg-amber-p25` | `#FF8F00` | P25 radio |
| `text-red-emergency` / `bg-red-emergency` | `#C62828` | Emergency · critical mode |

### Shadows (Tailwind `shadow-*`)
| Class | Use |
|-------|-----|
| `shadow-gold-glow` | Panel ambient glow |
| `shadow-gold-sm` | Active indicator glow |
| `shadow-red-glow` | Emergency state glow |

---

## TYPOGRAPHY

### Fonts
- **Body / UI** — `font-body` (Inter) — headings, labels, nav, buttons
- **Data / Mono** — `font-mono` (Roboto Mono) — all numeric values, coordinates, timestamps, IDs, hex codes, code

### Type utilities (use these, don't invent new ones)
| Class | Spec | Use |
|-------|------|-----|
| `.label-caps` | Inter 700 · 10px · tracking-widest · uppercase · `text-on-surface-variant` | Section labels |
| `.data-value` | Roboto Mono · 11px · `text-amber-gold` | Live data readouts |
| `.section-heading` | Inter 700 · 10px · tracking-widest · uppercase · amber-gold | Panel section titles |

### Type scale reference
| Role | Size | Weight | Family |
|------|------|--------|--------|
| Hero | 64px | 900 | Inter |
| Section title | 32px | 900 | Inter |
| Panel header | 16px | 900 | Inter |
| Body text | 14px | 400 | Inter |
| Labels | 10px | 700 | Inter |
| Data values | 11–13px | 400 | Roboto Mono |
| Micro labels | 9px | 700 | Roboto Mono |

---

## COMPONENTS

All components are defined in `frontend/src/index.css`. Use these classes — do not reinvent them.

### Panels
| Class | Description |
|-------|-------------|
| `.hud-panel` | Glassmorphic panel — `rgba(5,5,5,0.8)` + blur + dark border |
| `.glass-morphism` | Lighter glass — `rgba(5,5,5,0.4)` + blur |
| `.map-overlay-card` | Map overlay with amber border |
| `.sidebar-panel` | Sidebar — `#050505` + right amber border |

### Buttons
| Class | Style |
|-------|-------|
| `.btn-primary` | Amber-gold bg · onyx text · uppercase · hover→white |
| `.btn-ghost` | Amber border · amber text · hover→amber bg |
| `.btn-danger` | Red-emergency bg · glow shadow · hover→`#e23535` |

**Never use `rounded-*` on buttons.** All buttons are sharp-cornered.

### Typography utilities
`.label-caps` · `.data-value` · `.section-heading` · `.nav-link` · `.nav-link-active`

### Status & indicators
`.status-pill` · `.tl-green` · `.tl-yellow` · `.tl-red` · `.incident-card`

### Map markers
`.aircraft-marker` · `.aircraft-marker-dot` · `.aircraft-marker-ring` · `.aircraft-marker-pulse`

### Icons
Always use Material Symbols Outlined via `<span className="ms">icon_name</span>`.  
For filled variant: add `.ms-fill` class or `fontVariationSettings: "'FILL' 1"`.

---

## ANIMATION (from index.css)

| Class / Keyframe | Spec | Use |
|-------|------|-----|
| `animate-ping-slow` | ping · 2s | Entity pulse rings |
| `animate-pulse-slow` | pulse · 3s | Ambient indicators |
| `pulse-fast` | scale 0.9↔1.1 · 1.2s | Critical alerts |
| `animate-spin-slow` | 8s linear | Loading spinners |
| `wave-bar` | waveform · 1.2s | Audio level bars |
| `pulse-dot` | opacity 1↔0.35 · 1.6s | Live status dots |

Logo animations (for boot/login/loading screens):
- **ACQUIRE** (M-01) — brackets fly in, diamond fades, pip locks · 2400ms
- **SWEEP** (M-02) — amber ray rotates clockwise · 3000ms linear loop
- **BREATHE** (M-03) — pip glows, diamond breathes · 3200ms ease-in-out loop

---

## LAYOUT PATTERNS

### Glassmorphic header
```tsx
<header className="bg-white/[0.03] border-b border-white/[0.06] backdrop-blur-md relative">
  {/* Amber gradient underline */}
  <div className="absolute left-0 right-0 bottom-[-1px] h-px pointer-events-none"
       style={{ background: 'linear-gradient(90deg, transparent, #FFB800 20%, #FFB800 80%, transparent)', opacity: 0.35 }} />
</header>
```

### HUD card with corner brackets
```tsx
<div className="relative hud-panel border border-amber-gold/20">
  <span className="absolute top-2 left-2 w-4 h-4 border-t border-l border-amber-gold" />
  <span className="absolute top-2 right-2 w-4 h-4 border-t border-r border-amber-gold" />
  <span className="absolute bottom-2 left-2 w-4 h-4 border-b border-l border-amber-gold" />
  <span className="absolute bottom-2 right-2 w-4 h-4 border-b border-r border-amber-gold" />
  {/* content */}
</div>
```

### Wordmark lockup (horizontal — use in headers)
```tsx
<div className="flex items-center gap-3">
  {/* 28px Scope mark SVG */}
  <div className="flex flex-col leading-none gap-1">
    <span className="text-[16px] font-black tracking-[0.05em] text-white uppercase">VERTEX</span>
    <span className="font-mono text-[9px] tracking-[0.2em] text-amber-gold uppercase">SITUATIONAL AWARENESS</span>
  </div>
</div>
```

### Wordmark lockup (stacked — use on login/splash)
```tsx
<div className="flex flex-col items-center gap-3">
  {/* 56px Scope mark SVG */}
  <div className="flex flex-col items-center gap-1 leading-none">
    <span className="text-[22px] font-black tracking-[0.08em] text-white uppercase">VERTEX</span>
    <span className="font-mono text-[9px] tracking-[0.25em] text-amber-gold uppercase">SITUATIONAL AWARENESS</span>
  </div>
</div>
```

---

## CRITICAL RULES — NEVER VIOLATE

1. **0px radius** — never add `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`. Only `rounded-full` for circles.
2. **No hardcoded hex in TSX** — use Tailwind tokens. Exception: inline `style` for gradient stops that have no Tailwind equivalent.
3. **Signal colors are semantic** — cyan = aircraft, green = AIS/nominal, amber-p25 = radio, red = emergency. Never use them for decoration.
4. **Amber-gold is accent, not decoration** — every use of `#FFB800` should carry meaning (active state, live data, primary action).
5. **Roboto Mono for all data** — numbers, coordinates, timestamps, IDs, callsigns must use `font-mono`.
6. **Logo mark is immutable** — use the exact SVG from Sidebar.tsx. Do not approximate with CSS shapes or emoji.
7. **Dark only** — no light mode code, no conditional color schemes, no `dark:` prefixes (the `dark` class is always on `<html>`).
8. **Material Symbols only** — no emoji in UI chrome, no other icon libraries.
