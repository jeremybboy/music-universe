import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readUniverse } from '../music/universe/model.ts';
import { isJsonPath, maxEntries, maxEntryBytes, maxPackageBytes, writeStoredZip } from '../music/universe/zip.ts';

const args = process.argv.slice(2);
const check = args[0] === '--check';
if (check) args.shift();
if (args.length !== 0 && args.length !== 2) {
  throw new Error('Usage: npm run pack:muv -- [--check] [source-directory output.muv]');
}
const [source = 'songs/afterimage', destination = 'songs/Afterimage.muv'] = args;
const files = new Map();
let total = 0;

function collect(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path.length > 110) throw new Error('Directory path is too long: ' + path);
      collect(file, path + '/');
      continue;
    }
    if (!entry.isFile() || !isJsonPath(path)) throw new Error('Expected an ordinary JSON file: ' + path);
    const size = statSync(file).size;
    total += size;
    if (files.size >= maxEntries || size > maxEntryBytes || total > maxPackageBytes) {
      throw new Error('JSON source exceeds .muv file-count or size limits.');
    }
    files.set(path, readFileSync(file));
  }
}

collect(resolve(source));
const bytes = writeStoredZip(files);
readUniverse(bytes);
if (check) {
  if (!readFileSync(destination).equals(bytes)) throw new Error(destination + ' is stale. Run npm run pack:muv.');
} else {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}
console.log((check ? 'Verified ' : 'Packed ') + destination + ' (' + bytes.length + ' bytes)');
