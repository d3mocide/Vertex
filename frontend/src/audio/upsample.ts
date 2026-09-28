/**
 * Streaming 8 kHz → output-rate upsampler (windowed-sinc interpolation).
 *
 * Handing the browser 8 kHz AudioBuffers makes it resample them itself, and
 * Chrome/WebKit do that by linear interpolation: images of the voice mirror
 * around 8 kHz (a 1 kHz tone gains 7 and 9 kHz copies) at only ~28 dB down,
 * which is the harsh, "digital" edge on top of the vocoder sound. This
 * interpolates with a Blackman-windowed sinc instead (artifacts ~97 dB down,
 * measured) and keeps its history across frames, so 20 ms frames join
 * seamlessly. Output buffers then play at the context's own rate.
 */
const TAPS = 16          // input samples either side of each output (2 ms)
const PHASES = 512       // kernel table resolution per input sample
const CUTOFF = 0.92      // pass band edge as a fraction of 4 kHz (~3.7 kHz)

const KERNEL = (() => {
  const k = new Float32Array(2 * TAPS * PHASES + 2)   // +1 so k + 1 is always in range
  for (let i = 0; i < k.length; i++) {
    const x = i / PHASES - TAPS
    const sinc = x === 0 ? CUTOFF : Math.sin(Math.PI * CUTOFF * x) / (Math.PI * x)
    const blackman = 0.42 + 0.5 * Math.cos((Math.PI * x) / TAPS) + 0.08 * Math.cos((2 * Math.PI * x) / TAPS)
    k[i] = sinc * blackman
  }
  return k
})()

export class Upsampler {
  private buf = new Float32Array(4096)
  private len = TAPS          // leading zeros stand in for history before the call
  private pos = TAPS          // input-sample position of the next output sample
  private readonly step: number

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate
  }

  /** Feed input samples; returns the output samples now computable. */
  push(input: Float32Array): Float32Array<ArrayBuffer> {
    if (this.len + input.length > this.buf.length) {
      const grown = new Float32Array(Math.max(this.buf.length * 2, this.len + input.length))
      grown.set(this.buf.subarray(0, this.len))
      this.buf = grown
    }
    this.buf.set(input, this.len)
    this.len += input.length

    const n = Math.max(0, Math.ceil((this.len - TAPS - this.pos) / this.step) + 1)
    const out = new Float32Array(n)
    let o = 0
    while (Math.floor(this.pos) + TAPS < this.len) {
      const i0 = Math.floor(this.pos)
      let acc = 0
      for (let j = i0 - TAPS + 1; j <= i0 + TAPS; j++) {
        // Kernel at this offset, linearly interpolated between table entries.
        const t = (this.pos - j + TAPS) * PHASES
        const k = Math.floor(t)
        acc += this.buf[j] * (KERNEL[k] + (KERNEL[k + 1] - KERNEL[k]) * (t - k))
      }
      out[o++] = acc
      this.pos += this.step
    }
    // Drop input no longer needed as history.
    const keep = Math.floor(this.pos) - TAPS + 1
    if (keep > 0) {
      this.buf.copyWithin(0, keep, this.len)
      this.len -= keep
      this.pos -= keep
    }
    return o === n ? out : out.slice(0, o)
  }

  /** End of stream: push silence through so the last 2 ms are not cut off. */
  flush(): Float32Array<ArrayBuffer> {
    return this.push(new Float32Array(TAPS + 1))
  }
}
