import { execa } from 'execa';
import { rename, symlink, mkdir, unlink } from "node:fs/promises";
import { File } from "./file.js";
import path from 'node:path';
import { fileExists } from './util.js';
import { move } from 'fs-extra';

export class ConverterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConverterError';
    this.cause = cause;
  }
}

export async function convertImg({ file, relocatePath }: { file: File, relocatePath?: string }) {
  await mkdir(path.dirname(file.conversionDest), { recursive: true });

  try {
    if (await fileExists(file.conversionDest)) {
      await unlink(file.conversionDest);  
    }
    
    await execa('magick', [file.path, file.conversionDest]);
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
    if (await fileExists(file.conversionDest)) {
      await unlink(file.conversionDest);  
    }
    await execa('ffmpeg', [
      '-y',
      '-i', file.path, 
      '-c:v', 'libx264', 
      '-c:a', 'aac',
      '-b:a', '192k',
      '-profile:v', 'main', // Forces a highly compatible H.264 version
      '-level', '4.0', // Sets a standard compatibility level
      '-vf', 'scale=iw:-2,format=yuv420p', 
      '-crf', '23', 
      '-preset', 'slow',
      '-movflags', '+faststart',
      file.conversionDest
    ]);
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
    await move(file.conversionDest, convertedRelocatedPath, { overwrite: true });
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
  return path.join(relocatePath, file.conversionDestRel);
}
