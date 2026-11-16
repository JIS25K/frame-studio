// ZIP STORE: no compression, UTF-8 filenames, CRC32 integrity.
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name), crc = crc32(file.data);
    const h = new Uint8Array(30 + name.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true); v.setUint32(18, file.data.length, true); v.setUint32(22, file.data.length, true); v.setUint16(26, name.length, true); h.set(name, 30);
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, file.data.length, true); cv.setUint32(24, file.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); c.set(name, 46);
    local.push(h, file.data); central.push(c); offset += h.length + file.data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22); let i = 0;
  for (const part of [...local, ...central, end]) { result.set(part, i); i += part.length; } return result;
}
