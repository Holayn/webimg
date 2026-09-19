import { FileIndex } from './file-index.js';
import { File, FileMetadata } from './file.js';
import { convertImg, convertVideo } from './converter.js';
import { resizeVideo } from './resizer.js';
import { join } from 'node:path';
import { Logger } from './logger.js';

export class ConvertFileError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConvertFileError';
    this.cause = cause;
  }
}

// Forces conversion of a single already-indexed file by id. Unlike the main run(), this doesn't touch other files,
// resizes, or previews.
export async function convertFile({
  id,
  input,
  output,
  convertedPath,
  logger,
}: {
  id: number,
  input: string,
  output: string,
  convertedPath?: string,
  logger: Logger,
}) {
  const fileIndex = new FileIndex(output, logger);

  try {
    const entry = fileIndex.getFileById(id);
    if (!entry) {
      throw new ConvertFileError(`No file with id ${id} found in index.`);
    }

    const file = new File({
      path: join(input, entry.path),
      input,
      output,
      indexId: entry.id,
      metadata: entry.metadata && entry.metadata.toString().length ? new FileMetadata(JSON.parse(entry.metadata.toString())) : null,
      processed: !!entry.processed,
      previewOnly: !!entry.preview_only,
    });

    if (!file.needsConversion) {
      throw new ConvertFileError(`File ${file.path} does not need conversion.`);
    }

    logger.log(`Converting ${file.path}...`);

    if (file.isVideo) {
      await convertVideo({ file, relocatePath: convertedPath });

      for (const size of file.sizes) {
        if (size.video?.symlink) {
          await resizeVideo(file, size);
          logger.debug(`Resized ${file.path} to ${file.getResizeDest(size.name)}`);
        }
      }
    } else if (file.isImage) {
      await convertImg({ file, relocatePath: convertedPath });
    }

    fileIndex.setPreviewOnly(file, false);

    logger.log(`✅ Converted ${file.path} to ${file.conversionDest}`);
  } finally {
    fileIndex.close();
  }
}
