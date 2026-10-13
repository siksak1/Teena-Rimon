/** Decode a file bundled as base64 (see `bundledBinaries` in vite.config.ts). */
export function fromBase64(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** The OCR models are bundled gzipped; the browser unpacks them natively. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
