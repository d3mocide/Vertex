import { useCivicStore, TrafficCamera } from '../../store'

export function CameraModal() {
  const { 
    selectedCamId, setSelectedCamId, 
    cameras, ldiMode,
    favoriteCamIds, toggleFavoriteCam
  } = useCivicStore()

  if (!selectedCamId) return null

  const selectedCam = cameras.find((c) => c.id === selectedCamId)
  if (!selectedCam) return null

  const isFavorite = favoriteCamIds.includes(selectedCam.id)

  const closeModal = () => {
    setSelectedCamId(null)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-xl animate-in fade-in zoom-in duration-300"
      onClick={closeModal}
    >
      <div 
        className="hud-panel w-full max-w-3xl overflow-hidden pointer-events-auto shadow-2xl border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center justify-between bg-onyx-deep/60 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="ms text-[18px] text-amber-gold" style={{ fontVariationSettings: "'FILL' 1" }}>videocam</span>
            <span className="font-bold text-sm uppercase tracking-tight text-on-surface truncate">
              {selectedCam.name}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => toggleFavoriteCam(selectedCam.id)}
              className="text-amber-gold hover:scale-110 transition-transform focus:outline-none"
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              title={isFavorite ? 'Remove from favorites' : 'Bookmark feed'}
            >
              <span
                className="ms text-[20px] leading-none"
                aria-hidden="true"
                style={{ fontVariationSettings: `'FILL' ${isFavorite ? 1 : 0}` }}
              >
                bookmark
              </span>
            </button>
            <button
              onClick={closeModal}
              className="ms text-[20px] text-on-surface-variant hover:text-amber-gold transition-colors"
            >
              close
            </button>
          </div>
        </div>
        
        <div className="aspect-video bg-surface-container relative overflow-hidden">
          <img 
            src={ldiMode && selectedCam.ldi_url ? selectedCam.ldi_url : selectedCam.url} 
            alt={selectedCam.name}
            className="w-full h-full object-contain"
          />
          
          {/* Metadata overlays */}
          <div className="absolute top-4 left-4 flex flex-col gap-1">
            <div className="bg-onyx-black/60 px-2 py-1 rounded-sm border border-white/10">
               <span className="font-mono text-[10px] text-amber-gold">
                LIVE FEED • {selectedCam.dist_km != null ? `${selectedCam.dist_km}km` : 'Range N/A'}
               </span>
            </div>
            {selectedCam.road && (
              <div className="bg-onyx-black/60 px-2 py-1 rounded-sm border border-white/10 w-fit">
                <span className="font-mono text-[10px] text-on-surface-variant uppercase">{selectedCam.road}</span>
              </div>
            )}
          </div>

          <div className="absolute bottom-4 right-4">
            <div className="bg-onyx-black/40 backdrop-blur-sm px-2 py-1 rounded-sm border border-white/5">
               <span className="font-mono text-[9px] text-white/40 uppercase">
                 {ldiMode ? 'Last Daylight Image' : 'Current Conditions'}
               </span>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-amber-gold-muted/30 bg-white/[0.02] flex items-center justify-between">
           <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
             Source: ODOT TRIPCHECK • ID: {selectedCam.id}
           </span>
           <button
             onClick={closeModal}
             className="px-6 py-1.5 bg-amber-gold text-onyx-black font-bold text-[10px] uppercase tracking-widest hover:bg-amber-400 transition-all hover:scale-105 active:scale-95"
           >
             Acknowledge
           </button>
        </div>
      </div>
    </div>
  )
}
