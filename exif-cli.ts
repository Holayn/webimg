import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'source-map-support/register.js';
import { normalize } from 'node:path';
import exiftool from 'exiftool-vendored';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExifArguments {
  file: string;
}

async function runExifCommand(filePath: string) {
  try {
    const fullPath = normalize(path.resolve(__dirname, filePath));
    const exifTool = new exiftool.ExifTool();
    const tags = await exifTool.read(fullPath);
    console.log(JSON.stringify(tags, null, 2));
    await exifTool.end();
  } catch (error) {
    console.error('Error reading EXIF data:', error);
    process.exit(1);
  }
}

const argv = yargs(hideBin(process.argv))
  .scriptName('exif-cli.js')
  .usage('Usage: $0 --file <file>')
  .option('file', {
    alias: 'f',
    describe: 'Path to the file to extract EXIF data from',
    type: 'string',
    demandOption: true,
  })
  .help()
  .alias('help', 'h')
  .parseSync() as ExifArguments;

await runExifCommand(argv.file);
