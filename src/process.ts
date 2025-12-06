import { Listr, ListrTaskWrapper, DefaultRenderer, SimpleRenderer } from 'listr2';
import { FileIndex } from './file-index.js';
import { convertImg, convertVideo, getConvertedRelocatedPath } from './converter.js';
import { unlink } from 'node:fs/promises';
import { File, FileMetadata } from './file.js';
import { resizeImg, resizeVideo } from './resizer.js';
import { generateVideoPreview } from './video-preview-generator.js';
import { extractExif, done as doneExtractExif } from './exif-extractor.js';
import { findFiles } from './util.js';
import { Logger } from './logger.js';
import { determineHDR } from './determine-hdr.js';
import path from 'node:path';
import { createOriginalSymlink } from './original-symlinker.js';

interface RunContext {
  fileIndex: FileIndex;
  files: File[];
  problemFiles: {
    file: File;
    task: string;
  }[];
  resizedFiles: File[];
  convertedFiles: File[];
  symlinkedFiles: File[];
  deletedPaths: string[];
  timeStart: number;
}

const commonRendererOptions = {
  exitOnError: false,
};

// TODO: sizes is not used
export async function run({
  input,
  output,
  exclude = [],
  sizes,
  convertedPath,
  logger,
  dryRun = false
}: {
  input: string,
  output: string,
  exclude?: string[],
  sizes?: { name: string, height: number }[],
  convertedPath?: string,
  logger: Logger,
  dryRun?: boolean
}) {
  if (dryRun) {
    logger.log('=== DRY RUN MODE ===');
  }
  const tasks = new Listr<RunContext>([
    {
      title: 'Initializing',
      task: async (ctx, task) => {
        ctx.files = [];
        ctx.problemFiles = [];
        ctx.resizedFiles = [];
        ctx.convertedFiles = [];
        ctx.symlinkedFiles = [];
        ctx.timeStart = Date.now();
      }
    },
    {
      title: 'Indexing files',
      task: async (ctx, task) => {
        const fileIndex = new FileIndex(output, logger, dryRun);
        await fileIndex.update(input, exclude);
        ctx.fileIndex = fileIndex;
        ctx.files = ctx.fileIndex.getIndexedFiles()
          .filter(file => file.exists)
          .map(file => new File({ path: path.join(input, file.path), input, output, indexId: file.id, metadata: file.metadata ? new FileMetadata(JSON.parse(file.metadata.toString())) : null, processed: !!file.processed }))
      },
    },
    {
      title: 'Extracting EXIF data',
      task: async (ctx, task) => {
        const filesToExtract = ctx.files.filter(file => !file.metadata);
        const totalFiles = filesToExtract.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalFiles}`;

        for (let i = 0; i < totalFiles; i++) {
          const file = filesToExtract[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalFiles} - Processing ${file.path}`;

          try {
            const exif = await extractExif({ file });
            const metadata = new FileMetadata();
            metadata.setFromExif(exif);
            file.metadata = metadata;
            ctx.fileIndex.updateMetadataField(file);
            ctx.fileIndex.updateDateField(file, exif);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: 'EXIF data extraction' });
          }
        }

        task.title = `${originalTitle} (${totalFiles} files)`;
      }
    },
    {
      title: 'Cleaning up EXIF extractor',
      task: async (ctx, task) => {
        doneExtractExif();
      },
    },
    {
      title: 'Filtering files',
      task: async (ctx, task) => {
        ctx.files = ctx.files.filter(file => file.isValidToProcess);
        const invalidFiles = ctx.files.filter(file => !file.isValidToProcess);
        ctx.fileIndex.removeProcessed(invalidFiles.map(file => file.indexId));
      }
    },
    {
      title: 'Setting HDR flag on video files',
      task: async (ctx, task) => {
        const filesToProcess = ctx.files.filter(file => file.isVideo && file.metadata?.WebImg?.HDR === undefined);
        const totalFiles = filesToProcess.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalFiles}`;

        for (let i = 0; i < totalFiles; i++) {
          const file = filesToProcess[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalFiles} - Processing ${file.path}`;

          try {
            const hdr = await determineHDR(file);
            if (!file.metadata) {
              file.metadata = new FileMetadata();
            }
            file.metadata.WebImg.HDR = hdr;
            ctx.fileIndex.updateMetadataField(file);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: 'HDR flag setting' });
          }
        }

        task.title = `${originalTitle} (${totalFiles} files)`;
      }
    },
    {
      title: 'Converting photos',
      task: async (ctx, task) => {
        // First filter files that need conversion
        const filesToConvert = [];
        for (const file of ctx.files) {
          if (file.isImage && file.needsConversion) {
            const isConverted = await file.isConverted;
            if (!isConverted || !file.processed) {
              filesToConvert.push(file);
            }
          }
        }

        const totalFiles = filesToConvert.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalFiles}`;

        for (let i = 0; i < totalFiles; i++) {
          const file = filesToConvert[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalFiles} - Converting ${file.path}`;

          try {
            if (!dryRun) {
              await convertImg({ file, relocatePath: convertedPath });
            }
            logger.log(`Converted ${file.path} to ${file.conversionDest}`);
            ctx.convertedFiles.push(file);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: 'Image conversion' });
          }
        }

        task.title = `${originalTitle} (${totalFiles} files)`;
      },
    },
    {
      title: 'Converting videos',
      task: async (ctx, task) => {
        // First filter files that need conversion
        const filesToConvert = [];
        for (const file of ctx.files) {
          if (file.isVideo && file.needsConversion) {
            const isConverted = await file.isConverted;
            if (!isConverted || !file.processed) {
              filesToConvert.push(file);
            }
          }
        }

        const totalFiles = filesToConvert.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalFiles}`;

        for (let i = 0; i < totalFiles; i++) {
          const file = filesToConvert[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalFiles} - Converting ${file.path}`;

          try {
            if (!dryRun) {
              await convertVideo({ file, relocatePath: convertedPath });
            }
            logger.log(`Converted ${file.path} to ${file.conversionDest}`);
            ctx.convertedFiles.push(file);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: 'Video conversion' });
          }
        }

        task.title = `${originalTitle} (${totalFiles} files)`;
      },
    },
    {
      title: 'Resizing images',
      task: async (ctx, task) => {
        const resizeTasks = [];
        for (const file of ctx.files.filter(file => file.isImage)) {
          for (const size of file.sizes) {
            if (size.image) {
              const isResized = await file.isResizedTo(size.name);
              if (!isResized || !file.processed) {
                resizeTasks.push({ file, size });
              }
            }
          }
        }

        const totalTasks = resizeTasks.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalTasks}`;

        for (let i = 0; i < totalTasks; i++) {
          const { file, size } = resizeTasks[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalTasks} - Resizing ${file.path} to ${size.name}`;

          try {
            if (!dryRun) {
              await resizeImg(file, size);
            }
            ctx.resizedFiles.push(file);
            logger.log(`Resized ${file.path} to ${file.getResizeDest(size.name)}`);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: `Image resizing to ${size.name}` });
          }
        }

        task.title = `${originalTitle} (${totalTasks} tasks)`;
      }
    },
    {
      title: 'Resizing videos',
      task: async (ctx, task) => {
        const videoResizeTasks = [];
        for (const file of ctx.files.filter(file => file.isVideo)) {
          for (const size of file.sizes) {
            if (size.video) {
              const isResized = await file.isResizedTo(size.name);
              if (!isResized || !file.processed) {
                videoResizeTasks.push({ file, size });
              }
            }
          }
        }

        const totalTasks = videoResizeTasks.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalTasks}`;

        for (let i = 0; i < totalTasks; i++) {
          const { file, size } = videoResizeTasks[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalTasks} - Resizing ${file.path} to ${size.name}`;

          try {
            if (!dryRun) {
              await resizeVideo(file, size);
            }
            ctx.resizedFiles.push(file);
            logger.log(`Resized ${file.path} to ${file.getResizeDest(size.name)}`);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: `Video resizing to ${size.name}` });
          }
        }

        task.title = `${originalTitle} (${totalTasks} tasks)`;
      }
    },
    {
      title: 'Generating video previews',
      task: async (ctx, task) => {
        const videoPreviewTasks = [];
        for (const file of ctx.files.filter(file => file.isVideo)) {
          for (const size of file.sizes) {
            if (size.image && size.videoPreview !== false) {
              const isPreviewGenerated = await file.isVideoPreviewGenerated(size.name);
              if (!isPreviewGenerated || !file.processed) {
                videoPreviewTasks.push({ file, size });
              }
            }
          }
        }

        const totalTasks = videoPreviewTasks.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalTasks}`;

        for (let i = 0; i < totalTasks; i++) {
          const { file, size } = videoPreviewTasks[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalTasks} - Generating preview for ${file.path} to ${size.name}`;

          try {
            if (!dryRun) {
              await generateVideoPreview({ file, size });
            }
            ctx.resizedFiles.push(file);
            logger.log(`Generated video preview for ${file.path} to ${file.getVideoPreviewDest(size.name)}`);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: `Video preview generation to ${size.name}` });
          }
        }

        task.title = `${originalTitle} (${totalTasks} tasks)`;
      }
    },
    {
      title: 'Creating symlinks to originals',
      task: async (ctx, task) => {
        const filesToLink = [];
        for (const file of ctx.files) {
          const isLinked = await file.isOriginalLinked;
          if (!isLinked) {
            filesToLink.push(file);
          }
        }

        const totalFiles = filesToLink.length;
        const originalTitle = task.title;

        task.title = `${originalTitle}: 0/${totalFiles}`;

        for (let i = 0; i < totalFiles; i++) {
          const file = filesToLink[i];
          const current = i + 1;

          task.title = `${originalTitle}: ${current}/${totalFiles} - Linking ${file.path}`;

          try {
            if (!dryRun) {
              await createOriginalSymlink(file);
            }
            ctx.symlinkedFiles.push(file);
            logger.log(`Linked ${file.path} to ${file.originalDest}`);
          } catch (e) {
            logger.error(e);
            ctx.problemFiles.push({ file, task: 'Original symlink creation' });
          }
        }

        task.title = `${originalTitle} (${totalFiles} files)`;
      }
    },
    {
      title: 'Updating processed files in index',
      task: async (ctx, task) => {
        ctx.fileIndex.updateAsProcessed(ctx.files.map(file => file.indexId));
        ctx.files.forEach(file => file.processed = true);
      }
    },
    {
      title: 'Cleaning up output files',
      task: async (ctx, task) => {
        const outputFiles = await findFiles(path.join(output, 'media'));
        const filesToKeep = new Set([
          ...ctx.files.flatMap(file => [
            file.conversionDest,
            ...file.sizes.filter(s => file.canResizeTo(s.name)).map(size => file.getResizeDest(size.name)),
            ...(file.isVideo ? file.sizes.filter(s => s.videoPreview !== false).map(size => file.getVideoPreviewDest(size.name)) : []),
            file.originalDest,
          ].filter(file => file !== null))
        ]);

        const filePathsToDelete = outputFiles.filter(file => !filesToKeep.has(file));
        ctx.deletedPaths = filePathsToDelete;

        await Promise.all(filePathsToDelete.map(async filePath => {
          if (!dryRun) {
            await unlink(filePath);
          }
          logger.log(`Deleted ${filePath}`);
        }));

        if (convertedPath) {
          const relocatedFilePaths = await findFiles(convertedPath);
          const relocatedFilePathsToKeep = new Set(ctx.files.map(file => getConvertedRelocatedPath({ file, relocatePath: convertedPath })));
          const relocatedFilePathsToDelete = relocatedFilePaths.filter(file => !relocatedFilePathsToKeep.has(file));
          await Promise.all(relocatedFilePathsToDelete.map(async filePath => {
            if (!dryRun) {
              await unlink(filePath);
            }
            logger.log(`Deleted ${filePath}`);
          }));
        }
      }
    },
  ], commonRendererOptions);

  const { problemFiles, files, convertedFiles, resizedFiles, deletedPaths, timeStart } = await tasks.run();
  
  // Prepare summary
  const summary = [
    `✅ Processed ${files.length} files${dryRun ? ' (DRY RUN)' : ''}`,
    `  - Converted: ${convertedFiles.length} files`,
    `  - Resized: ${resizedFiles.length} files`,
    `  - Deleted: ${deletedPaths.length} files`,
    `  - Time: ${((Date.now() - timeStart) / 1000).toFixed(2)} seconds`,
  ];

  // Add problem files if any
  if (problemFiles.length > 0) {
    summary.push(
      `\n❌ Encountered issues with ${problemFiles.length} files:`,
      ...problemFiles.map(f => `  - ${f.file.path} (${f.task})`)
    );
  }

  logger.log(`\n${summary.join('\n')}\n`);
}