import sharp from 'sharp';
import { File, FileResizeSize } from './file.js';
import path from 'node:path';
import { mkdir, symlink } from 'node:fs/promises';

export class ResizerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ResizerError';
    this.cause = cause;
  }
}

export async function resizeImg(file: File, size: FileResizeSize) {
  const dest = file.getResizeDest(size.name);

  await mkdir(path.dirname(dest), { recursive: true });

  return new Promise((resolve, reject) => {
    sharp(file.needsConversion ? file.conversionDest : file.path)
      .rotate()
      .resize({
        height: size.image?.height,
      })
      .toFile(dest)
      .then(resolve)
      .catch(err => {
        reject(new ResizerError(`Failed to resize ${file.path}`, err));
      });
  });
}

export async function resizeVideo(file: File, size: FileResizeSize) {
  const dest = file.getResizeDest(size.name);

  await mkdir(path.dirname(dest), { recursive: true });
  
  if (size.video?.symlink) {
    await symlink(file.needsConversion ? file.conversionDest : file.path, dest);
  } else {
    throw new ResizerError(`Currently unable to resize videos.`);
  }
}
