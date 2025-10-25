import { globby } from 'globby';
import { normalize } from 'node:path';

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