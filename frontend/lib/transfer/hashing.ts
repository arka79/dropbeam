export async function sha256OfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return sha256OfBuffer(buf);
}

export async function sha256OfBuffer(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return arrayBufferToHex(hash);
}

export function arrayBufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, '0');
  }
  return s;
}

export async function sha256Stream(
  file: Blob,
  onProgress?: (bytes: number) => void,
): Promise<string> {
  const chunkSize = 4 * 1024 * 1024;
  let offset = 0;
  let combined = '';

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const slice = file.slice(offset, end);
    const buf = await slice.arrayBuffer();
    const hashHex = await sha256OfBuffer(buf);
    combined += hashHex;
    offset = end;
    onProgress?.(offset);
  }

  const enc = new TextEncoder().encode(combined);
  const finalHash = await crypto.subtle.digest('SHA-256', enc);
  return arrayBufferToHex(finalHash);
}
