export function ToggleRow({ label, icon, checked, onChange }: {
  label: string
  icon: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const id = `setting-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <label htmlFor={id} className="flex items-center gap-3 cursor-pointer group">
      <span className={`ms text-[18px] leading-none transition-colors ${checked ? 'text-amber-gold' : 'text-on-surface-variant group-hover:text-on-surface'}`} aria-hidden="true">
        {icon}
      </span>
      <span className={`flex-1 font-bold text-[11px] tracking-widest uppercase transition-colors ${checked ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
        {label}
      </span>
      <div className="relative shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-9 h-5 border transition-colors ${checked ? 'bg-amber-gold/20 border-amber-gold' : 'bg-surface-container border-outline-variant'}`} />
        <div className={`absolute top-0.5 h-4 w-4 border transition-all ${checked ? 'translate-x-4 bg-amber-gold border-amber-gold' : 'translate-x-0.5 bg-on-surface-variant border-on-surface-variant'}`} />
      </div>
    </label>
  )
}
