import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { run } from './src/process.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'source-map-support/register.js';
import { normalize } from 'node:path';
import { Logger } from './src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Arguments {
  input: string;
  output: string;
  config?: string;
  relocateConverted?: string;
  exclude?: string[];
  sizes?: {
    name: string;
    height: number;
  }[];
}

const argv = yargs(hideBin(process.argv))
  .scriptName('cli.js')
  .usage('Usage: $0 --input <file> --output <file> [or] $0 --config <file>')
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
  .option('exclude', {
    describe: 'Relative paths of files to exclude',
    type: 'array',
  })
  .option('relocateConverted', {
    describe: 'Path to the directory holding converted files',
    type: 'string',
  })
  .option('sizes', {
    describe: 'Sizes to resize images to',
    type: 'array',
  })
  .config()
  .check((argv) => {
    if (!argv.input) {
      throw new Error('Missing required argument: input. Provide --input or use a config file.');
    }
    if (!argv.output) {
      throw new Error('Missing required argument: output. Provide --output or use a config file.');
    }
    
    return true;
  })
  
  .help()
  .alias('help', 'h')
  .parseSync() as Arguments;

const input = normalize(path.resolve(__dirname, argv.input));
const output = normalize(path.resolve(__dirname, argv.output));

const logger = new Logger(output);

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

await run({
  input,
  output,
  exclude: argv.exclude,
  convertedPath: argv.relocateConverted ? normalize(path.resolve(__dirname, argv.relocateConverted)) : undefined,
  sizes: argv.sizes,
  logger,
});

await logger.done();
