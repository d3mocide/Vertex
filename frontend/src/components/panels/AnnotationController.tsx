import { useCivicStore } from '../../store'

export function AnnotationController() {
  const annotationDrawMode = useCivicStore((s) => s.annotationDrawMode)
  const annotationsVisible = useCivicStore((s) => s.annotationsVisible)
  const open               = useCivicStore((s) => s.annotationToolbarOpen)
  const setOpen            = useCivicStore((s) => s.setAnnotationToolbarOpen)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`
          relative flex items-center gap-2 px-3 py-2
          hud-panel border border-amber-gold-muted text-[10px] font-mono uppercase tracking-widest shadow-2xl
          hover:border-amber-gold/60 transition-colors focus:outline-none
          ${open || annotationDrawMode ? 'text-amber-gold border-amber-gold' : 'text-on-surface-variant'}
        `}
        aria-expanded={open}
        title="Map Annotations & Drawing"
      >
        <span className="ms text-[16px] leading-none">{annotationsVisible ? 'edit_note' : 'visibility_off'}</span>
        ANNOTATE
      </button>
      <div id="annotation-toolbar-portal" className="absolute top-full mt-2 left-0 z-[40]" />
    </div>
  )
}
