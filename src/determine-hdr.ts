import { execa } from 'execa'
import { File } from "./file.js";

export async function determineHDR(file: File) {
  const { stdout } = await execa('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_transfer,color_primaries', '-of', 'default=noprint_wrappers=1', file.path]);

  const colorSpace = stdout.split('\n')[0].split('=')[1];
  if (colorSpace.toLowerCase().includes('bt2020')) {
    return true;
  }

  return false;
}