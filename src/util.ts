import { globby } from 'globby';
import { normalize } from 'node:path';
import { stat } from 'node:fs/promises';

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

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}