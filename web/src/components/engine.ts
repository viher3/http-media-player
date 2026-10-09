/** Referencia a los elementos multimedia para módulos fuera de <Player/> (visualizador, atajos). */
let els: HTMLVideoElement[] = []
export const setMediaElements = (e: HTMLVideoElement[]) => { els = e }
export const getMediaElements = () => els
