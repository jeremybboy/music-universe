// The v0.1 profile uses ordinary single-disk ZIP records with stored JSON entries.
export const maxPackageBytes = 512 * 1024;
export const maxEntryBytes = 256 * 1024;
export const maxEntries = 16;

const localSignature = 0x04034b50;
const centralSignature = 0x02014b50;
const endSignature = 0x06054b50;
const utf8Flag = 0x800;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export function isJsonPath(path: string): boolean {
  return path.length <= 120 && path.endsWith('.json') &&
    path.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/.test(part));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

type Entry = { path: string; flags: number; offset: number; size: number; crc: number };

export function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength > maxPackageBytes) throw new Error('Package exceeds the 512 KiB limit.');
  if (bytes.byteLength < 22) throw new Error('This file is not a complete .muv ZIP package.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const end = bytes.length - 22;
  if (u32(end) !== endSignature || u16(end + 20) !== 0) {
    throw new Error('Expected a complete .muv ZIP with no archive comment.');
  }
  const count = u16(end + 10);
  if (count < 1 || count > maxEntries) throw new Error('A .muv package must contain 1 to 16 entries.');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) {
    throw new Error('Multi-disk ZIP packages are unsupported.');
  }
  const central = u32(end + 16);
  if (central + u32(end + 12) !== end) throw new Error('Invalid ZIP central directory size.');

  let offset = central;
  let totalBytes = 0;
  const records = new Map<string, Entry>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(offset) !== centralSignature) throw new Error('Invalid ZIP directory entry.');
    const flags = u16(offset + 8);
    const nameSize = u16(offset + 28);
    const next = offset + 46 + nameSize + u16(offset + 30) + u16(offset + 32);
    if (next > end) throw new Error('Truncated ZIP directory entry.');
    if (u16(offset + 10) !== 0) throw new Error('Use stored ZIP entries (zip -0); compressed entries are unsupported.');
    if ((flags & ~utf8Flag) || u16(offset + 34)) throw new Error('Encrypted, streamed or multi-disk entries are unsupported.');
    const attributes = u32(offset + 38);
    const fileMode = (attributes >>> 16) & 0xf000;
    if ((attributes & 0x10) || ![0, 0x8000].includes(fileMode)) {
      throw new Error('Only ordinary JSON files can be included in .muv packages.');
    }
    const size = u32(offset + 24);
    totalBytes += size;
    if (size > maxEntryBytes || totalBytes > maxPackageBytes) throw new Error('ZIP entry or total data exceeds the size limit.');
    if (size !== u32(offset + 20)) throw new Error('Stored ZIP entry sizes do not match.');
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    if (!isJsonPath(path)) throw new Error('Invalid ZIP entry path: use relative JSON paths only.');
    if (records.has(path)) throw new Error('Duplicate ZIP entry: ' + path);
    records.set(path, { path, flags, size, offset: u32(offset + 42), crc: u32(offset + 16) });
    offset = next;
  }
  if (offset !== end) throw new Error('Unexpected data in the ZIP central directory.');

  const files = new Map<string, Uint8Array>();
  let nextLocal = 0;
  for (const entry of [...records.values()].sort((a, b) => a.offset - b.offset)) {
    const { path, size, crc, flags, offset: local } = entry;
    if (local !== nextLocal || local + 30 > central || u32(local) !== localSignature) {
      throw new Error('Invalid or overlapping local ZIP entry: ' + path);
    }
    const nameSize = u16(local + 26);
    const start = local + 30 + nameSize + u16(local + 28);
    if (start + size > central || u16(local + 6) !== flags || u16(local + 8) !== 0 ||
        u32(local + 14) !== crc || u32(local + 18) !== size || u32(local + 22) !== size ||
        decoder.decode(bytes.subarray(local + 30, local + 30 + nameSize)) !== path) {
      throw new Error('ZIP headers do not agree for ' + path + '.');
    }
    const body = bytes.subarray(start, start + size);
    if (crc32(body) !== crc) throw new Error('Damaged ZIP entry: ' + path);
    files.set(path, body);
    nextLocal = start + size;
  }
  if (nextLocal !== central) throw new Error('Unexpected data before the ZIP central directory.');
  return files;
}

export function writeStoredZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  if (files.size < 1 || files.size > maxEntries) throw new Error('Expected 1 to 16 JSON files.');
  const entries = [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, body]) => {
      if (!isJsonPath(path)) throw new Error('Invalid relative JSON path: ' + path);
      if (body.length > maxEntryBytes) throw new Error('JSON entry is too large: ' + path);
      return { name: encoder.encode(path), body, crc: crc32(body) };
    });
  const length = entries.reduce((size, entry) => size + 76 + entry.name.length * 2 + entry.body.length, 22);
  if (length > maxPackageBytes) throw new Error('Package exceeds the 512 KiB limit.');

  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  let local = 0;
  let central = entries.reduce((size, entry) => size + 30 + entry.name.length + entry.body.length, 0);
  const directoryStart = central;
  for (const { name, body, crc } of entries) {
    u32(local, localSignature);
    u16(local + 4, 10);
    u16(local + 6, utf8Flag);
    u16(local + 12, 33); // 1980-01-01, stable across builds.
    u32(local + 14, crc);
    u32(local + 18, body.length);
    u32(local + 22, body.length);
    u16(local + 26, name.length);
    bytes.set(name, local + 30);
    bytes.set(body, local + 30 + name.length);

    u32(central, centralSignature);
    u16(central + 4, 10);
    u16(central + 6, 10);
    u16(central + 8, utf8Flag);
    u16(central + 14, 33);
    u32(central + 16, crc);
    u32(central + 20, body.length);
    u32(central + 24, body.length);
    u16(central + 28, name.length);
    u32(central + 42, local);
    bytes.set(name, central + 46);

    local += 30 + name.length + body.length;
    central += 46 + name.length;
  }
  u32(central, endSignature);
  u16(central + 8, entries.length);
  u16(central + 10, entries.length);
  u32(central + 12, central - directoryStart);
  u32(central + 16, directoryStart);
  return bytes;
}
