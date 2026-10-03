/** Internal helpers: read a Blob's bytes, and hash them. */

/**
 * The bytes of a Blob. Uses `Blob.arrayBuffer()` where it exists (every current browser) and falls back to
 * `FileReader` (older Safari, and jsdom, whose Blob has no `arrayBuffer`).
 */
export async function readBytes(blob: Blob): Promise<Uint8Array> {
  const b = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (typeof b.arrayBuffer === 'function') return new Uint8Array(await b.arrayBuffer())
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      // Not `instanceof ArrayBuffer`: in jsdom (and across frames) the buffer can come from another realm.
      if (result !== null && typeof result !== 'string') resolve(new Uint8Array(result))
      else reject(new Error('Could not read the file'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsArrayBuffer(blob)
  })
}

/** Lower-case hex SHA-256, via `crypto.subtle`. */
export async function sha256Hex(input: Blob | Uint8Array): Promise<string> {
  // `ArrayBuffer.isView`, not `instanceof Uint8Array`, which is false for bytes made in another realm.
  const bytes = ArrayBuffer.isView(input) ? (input as Uint8Array) : await readBytes(input as Blob)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new Error('This browser cannot hash files (crypto.subtle is unavailable; is the page served over https?)')
  // Copy into a fresh buffer: `digest` refuses views onto a SharedArrayBuffer and, in some runtimes, buffers from another realm.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = new Uint8Array(await subtle.digest('SHA-256', copy))
  let hex = ''
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0')
  return hex
}
