// Conversión de bytes, base64 y gzip con lo que trae el navegador (sin librerías).

export function bytesToBase64 (bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function base64ToBytes (b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Texto → gzip → base64. Un XML firmado baja a la cuarta parte. */
export async function gzipText (text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()))
}

export async function gunzipText (b64) {
  const stream = new Blob([base64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export function downloadBlob (blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
