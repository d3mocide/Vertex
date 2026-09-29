import { ForecastStrip } from './ForecastStrip'
import { NwwsProducts } from './NwwsCard'

/** What is coming: NWS hourly + day/night forecast, then the forecasters' own words. */
export function OutlookCard() {
  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 space-y-4">
      <div className="label-caps flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-sky-400" aria-hidden="true">partly_cloudy_day</span>
        OUTLOOK
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant">NWS Portland</span>
      </div>
      <ForecastStrip />
      <NwwsProducts />
    </div>
  )
}
