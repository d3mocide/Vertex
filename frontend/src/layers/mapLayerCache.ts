/** Reference-based memoization shared by derived map data and layer groups. */
export class MapLayerCache {
  private entries = new Map<string, { inputs: unknown[]; value: unknown }>()

  get<T>(name: string, inputs: unknown[], build: () => T): T {
    const cached = this.entries.get(name)
    if (cached && inputs.length === cached.inputs.length &&
        inputs.every((value, i) => Object.is(value, cached.inputs[i]))) return cached.value as T
    const value = build()
    this.entries.set(name, { inputs, value })
    return value
  }
}
