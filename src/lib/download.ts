/** Triggers a browser download of in-memory bytes. */
export function downloadBytes(data: Uint8Array | string, fileName: string, mime = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'mobios';

/** Opens the native file picker. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}
