import { globby } from 'globby';
import { normalize } from 'node:path';
import { lstat, stat } from 'node:fs/promises';

export interface FindFilesOptions {
  include?: string[];
  exclude?: string[];
}

export async function findFiles(
    directory: string,
    {
      include = ['**/*'],
      exclude = [],
    }: FindFilesOptions = {}
  ): Promise<string[]> {
    const globbyOptions = {
      nocase: true,
      cwd: directory, 
      absolute: true,
      ignore: [
        ...exclude
      ],
    };

    return globby(include, globbyOptions).then(files => files.map(file => normalize(file)));
  }

export async function fileExists(filePath: string, { followSymlink = false }: { followSymlink?: boolean } = {}): Promise<boolean> {
  try {
    if (followSymlink) {
      await Promise.all([
        await lstat(filePath),
        await stat(filePath),
      ]);
    } else {
      await lstat(filePath);
    }
    return true;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}