import { exiftool, Tags } from 'exiftool-vendored';
import { File } from './file.js';

export interface ExifData extends Tags {
  LivePhoto: boolean;
}

export async function extractExif({ file }: { file: File }) {
  const tags = await exiftool.read(file.path);
  Object.assign(tags, { 
    LivePhoto: tags['LivePhotoAuto' as keyof typeof tags] === 1 || tags['Live-photoAuto' as keyof typeof tags] === 1 || tags['LivePhotoVitalityScore' as keyof typeof tags] != null,
  });
  return tags as ExifData;
}

export function done() {
  exiftool.end();
}