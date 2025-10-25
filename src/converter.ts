import { exec } from "node:child_process";
import { promisify } from 'node:util';
import { rename, symlink, mkdir } from "node:fs/promises";
import { File } from "./file.js";
import { FileIndex } from "./file-index.js";
import path from 'node:path';

const execPromise = promisify(exec);

export class ConverterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConverterError';
    this.cause = cause;
  }
}

export async function convertImg({ file, relocatePath }: { file: File, relocatePath?: string, fileIndex: FileIndex }) {
  await mkdir(path.dirname(file.conversionDest), { recursive: true });

  try {
    await execPromise(`magick "${file.path}" "${file.conversionDest}"`);
  } catch (e) {
    throw new ConverterError('Failed to convert image', e);
  }
  
  if (relocatePath) {
    await relocateConverted({ file, relocatePath });
  }
}

export async function convertVideo({ file, relocatePath }: { file: File, relocatePath?: string }) {
  await mkdir(path.dirname(file.conversionDest), { recursive: true });

  try {
    await execPromise(`ffmpeg -i "${file.path}" "${file.conversionDest}"`);
  } catch (e) {
    throw new ConverterError('Failed to convert video', e);
  }
  
  if (relocatePath) {
    await relocateConverted({ file, relocatePath });
  }
}

async function relocateConverted({ file, relocatePath }: { file: File, relocatePath: string }) {
  const convertedRelocatedPath = getConvertedRelocatedPath({ file, relocatePath });
  await mkdir(path.dirname(convertedRelocatedPath), { recursive: true });
  try {
    await rename(file.conversionDest, convertedRelocatedPath);
  } catch (e) {
    throw new ConverterError('Failed to move converted file', e);
  }
  try {
    await symlink(convertedRelocatedPath, file.conversionDest);
  } catch (e) {
    throw new ConverterError('Failed to create symlink to relocated converted file', e);
  }
}

export function getConvertedRelocatedPath({ file, relocatePath }: { file: File, relocatePath: string }) {
  return path.join(relocatePath, file.destRelPath);
}
