import { readFileSync, readdirSync } from 'node:fs';
import { writeStoredZip } from '../music/universe/zip.ts';

export function beaconFiles() {
  const directory = new URL('./fixtures/beacon/', import.meta.url);
  return new Map(readdirSync(directory).map(name => [name, readFileSync(new URL(name, directory))]));
}

export function beaconPackage() {
  return Buffer.from(writeStoredZip(beaconFiles()));
}
