import React from 'react'
import { getAtlasIcons } from '../../layers/atlasIcons'

/**
 * Renders a specific icon from the application's icon atlas.
 * Uses CSS masks to allow for precise tinting of the white atlas icons.
 */
export function AtlasIcon({ 
  name, 
  color = '#ffffff', 
  size = 24, 
  className = "" 
}: { 
  name: string; 
  color?: string; 
  size?: number; 
  className?: string 
}) {
  const atlas = getAtlasIcons()
  const mapping = atlas.mapping[name]
  
  if (!mapping) return <span className="text-red-500 text-[11px]">?</span>

  const scale = size / mapping.width
  
  return (
    <div 
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: color,
        WebkitMaskImage: `url(${atlas.url})`,
        maskImage: `url(${atlas.url})`,
        WebkitMaskSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        maskSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
        WebkitMaskPosition: `-${mapping.x * scale}px -${mapping.y * scale}px`,
        maskPosition: `-${mapping.x * scale}px -${mapping.y * scale}px`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
      }}
    />
  )
}

/**
 * Premium documentation header with amber accents and subtle tactical flair.
 */
export function DocHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8 border-l-4 border-amber-gold pl-6 py-2 bg-gradient-to-r from-amber-gold/5 to-transparent animate-in fade-in slide-in-from-left-4 duration-700">
      <h1 className="text-2xl font-black tracking-[0.15em] uppercase text-white drop-shadow-[0_2px_10px_rgba(255,184,0,0.2)]">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 text-xs font-mono tracking-widest text-amber-gold/60 uppercase">
          {subtitle}
        </p>
      )}
    </div>
  )
}

/**
 * Section container with glassmorphic borders and smooth entrance animation.
 */
export function DocSection({ title, children, delay = 0 }: { title: string; children: React.ReactNode; delay?: number }) {
  return (
    <section 
      className="mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-white/10" />
        <h2 className="text-[11px] font-bold tracking-[0.25em] uppercase text-amber-gold shrink-0">
          {title}
        </h2>
        <div className="h-px w-8 bg-white/10" />
      </div>
      <div className="space-y-4 text-on-surface-variant leading-relaxed">
        {children}
      </div>
    </section>
  )
}

/**
 * High-legibility body text.
 */
export function DocText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[13px] text-on-surface-variant/90 leading-relaxed font-body ${className}`}>
      {children}
    </p>
  )
}

/**
 * Interactive card for highlighting specific features or data types.
 */
export function DocCard({ icon, title, description, badge }: { icon: string | React.ReactNode; title: string; description: string; badge?: string }) {
  return (
    <div className="group relative p-4 bg-white/[0.03] border border-white/5 hover:border-amber-gold/40 hover:bg-white/[0.05] transition-all duration-300 rounded-xl overflow-hidden">
      <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
        {typeof icon === 'string' ? (
          <span className="ms text-4xl">{icon}</span>
        ) : (
          <div className="scale-150 transform-gpu">{icon}</div>
        )}
      </div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {typeof icon === 'string' ? (
              <span className="ms text-amber-gold text-[20px]">{icon}</span>
            ) : (
              icon
            )}
            <h3 className="font-bold text-[13px] text-white tracking-tight">{title}</h3>
          </div>
          {badge && (
            <span className="text-[11px] px-1.5 py-0.5 bg-amber-gold/20 text-amber-gold border border-amber-gold/30 rounded uppercase tracking-widest font-bold">
              {badge}
            </span>
          )}
        </div>
        <p className="text-[11px] text-on-surface-variant/80 leading-normal">
          {description}
        </p>
      </div>
    </div>
  )
}

/**
 * Grid layout for DocCards.
 */
export function DocGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {children}
    </div>
  )
}

/**
 * Tactical list with custom markers.
 */
export function DocList({ items }: { items: (string | React.ReactNode)[] }) {
  return (
    <ul className="space-y-3 pl-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[13px] text-on-surface-variant/90">
          <span className="ms text-amber-gold text-[16px] shrink-0 translate-y-0.5">double_arrow</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Tactical callout/pro-tip box.
 */
export function DocCallout({ title, children, type = 'info' }: { title: string; children: React.ReactNode; type?: 'info' | 'warning' | 'danger' }) {
  const colors = {
    info: 'border-amber-gold/30 bg-amber-gold/5 text-amber-gold',
    warning: 'border-orange-500/30 bg-orange-500/5 text-orange-400',
    danger: 'border-red-500/30 bg-red-500/5 text-red-400',
  }
  const icons = { info: 'info', warning: 'warning', danger: 'report' }

  return (
    <div className={`p-4 border-l-2 rounded-r-lg ${colors[type]} my-6 animate-in zoom-in-95 duration-500`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="ms text-[18px]">{icons[type]}</span>
        <span className="text-[11px] font-black uppercase tracking-[0.2em]">{title}</span>
      </div>
      <div className="text-[12px] text-on-surface/80 leading-relaxed italic">
        {children}
      </div>
    </div>
  )
}

/**
 * Styled code block with syntax highlighting look.
 */
export function DocCode({ code }: { code: string }) {
  return (
    <div className="my-4 rounded-xl overflow-hidden border border-white/5 bg-onyx-black shadow-inner">
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500/30" />
          <div className="w-2 h-2 rounded-full bg-amber-500/30" />
          <div className="w-2 h-2 rounded-full bg-green-500/30" />
        </div>
        <span className="text-[11px] font-mono text-on-surface-variant/40 uppercase tracking-widest">terminal</span>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="text-[11px] font-mono text-amber-gold/90 leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  )
}
