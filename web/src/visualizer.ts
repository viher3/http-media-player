/**
 * Visualizador opcional (Web Audio). Al activarlo el audio de los elementos <video> pasa a
 * enrutarse por un AudioContext hasta recargar la página; por eso solo se crea tras un clic.
 */
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
const connected = new WeakSet<HTMLMediaElement>()

export function enableVisualizer(els: HTMLMediaElement[]): AnalyserNode | null {
  try {
    ctx ??= new AudioContext()
    if (!analyser) {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.8
      analyser.connect(ctx.destination)
    }
    for (const el of els) {
      if (connected.has(el)) continue
      ctx.createMediaElementSource(el).connect(analyser)
      connected.add(el)
    }
    void ctx.resume()
    return analyser
  } catch {
    return null
  }
}

export const getAnalyser = () => analyser
