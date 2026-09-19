import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { run } from './src/process.js';
import { convertFile } from './src/convert-file.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'source-map-support/register.js';
import { normalize } from 'node:path';
import { Logger } from './src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePath(p: string): string {
  return normalize(path.resolve(__dirname, p));
}

function checkInputOutput(argv: { input?: string, output?: string }) {
  if (!argv.input) {
    throw new Error('Missing required argument: input. Provide --input or use a config file.');
  }
  if (!argv.output) {
    throw new Error('Missing required argument: output. Provide --output or use a config file.');
  }

  return true;
}

// Runs fn with a Logger for outputPath, ensuring the logger is always
// flushed (and the process exits with the right code) whether fn resolves,
// rejects, or the process is interrupted.
async function withLogger(outputPath: string, fn: (logger: Logger) => Promise<void>) {
  const logger = new Logger(outputPath);
  let shuttingDown = false;

  const shutdown = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await logger.done();
    } catch (logError) {
      console.error('Error during logger shutdown:', logError);
    }

    process.exit(code);
  };

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', { promise, reason });
    shutdown(1);
  });
  process.on('SIGINT', () => {
    console.log('Received SIGINT. Exiting...');
    process.exit(0);
  });

  try {
    await fn(logger);
  } catch (e) {
    logger.error(e as Error);
    await shutdown(1);
    return;
  }

  // Allow logs to flush.
  await new Promise(resolve => setTimeout(resolve, 1000));
  await shutdown(0);
}

await yargs(hideBin(process.argv))
  .scriptName('cli.js')
  .usage('Usage: $0 --input <file> --output <file> [or] $0 --config <file>\n       $0 convert --id <id> --config <file>')
  .option('input', {
    alias: 'i',
    describe: 'Path to the input file',
    type: 'string',
  })
  .option('output', {
    alias: 'o',
    describe: 'Path to the output file',
    type: 'string',
  })
  .option('relocateConverted', {
    describe: 'Path to the directory holding converted files',
    type: 'string',
  })
  .config()
  .command(
    '$0',
    'Process files (default)',
    (yargs) => yargs
      .option('exclude', {
        describe: 'Relative paths of files to exclude',
        type: 'array',
      })
      .option('dry-run', {
        describe: 'Run without making any changes',
        type: 'boolean',
        default: false,
      })
      .option('reparse-metadata', {
        describe: 'Re-extract EXIF metadata for all indexed files before processing, re-evaluating which files should be processed',
        type: 'boolean',
        default: false,
      })
      .option('skip-large-videos', {
        describe: 'Skip converting videos longer than 1 minute, leaving them "preview only" (previews are still generated) until manually converted',
        type: 'boolean',
        default: false,
      })
      .check(checkInputOutput),
    async (argv) => {
      const input = resolvePath(argv.input as string);
      const output = resolvePath(argv.output as string);

      await withLogger(output, (logger) => run({
        input,
        output,
        exclude: argv.exclude as string[] | undefined,
        convertedPath: argv.relocateConverted ? resolvePath(argv.relocateConverted as string) : undefined,
        logger,
        dryRun: argv.dryRun as boolean,
        reparseMetadata: argv.reparseMetadata as boolean,
        skipLargeVideos: argv.skipLargeVideos as boolean,
      }));
    }
  )
  .command(
    'convert',
    'Force-convert a single already-indexed file by id',
    (yargs) => yargs
      .option('id', {
        describe: 'The id of the file to convert, as stored in the index',
        type: 'number',
        demandOption: true,
      })
      .check(checkInputOutput),
    async (argv) => {
      const input = resolvePath(argv.input as string);
      const output = resolvePath(argv.output as string);

      await withLogger(output, (logger) => convertFile({
        id: argv.id as number,
        input,
        output,
        convertedPath: argv.relocateConverted ? resolvePath(argv.relocateConverted as string) : undefined,
        logger,
      }));
    }
  )
  .help()
  .alias('help', 'h')
  .parseAsync();
