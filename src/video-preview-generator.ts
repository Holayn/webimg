import { exec } from "node:child_process";
import { promisify } from 'node:util';
import { File, FileResizeSize } from "./file.js";

const execPromise = promisify(exec);

export class VideoPreviewGeneratorError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'VideoPreviewGeneratorError';
    this.cause = cause;
  }
}

export async function generateVideoPreview({ file, size }: { file: File, size: FileResizeSize }) {
    const isHDR = file.metadata?.WebImg.HDR || false;

    try {
      const resizeVf = `scale=-1:${size.image?.height}`;
      await execPromise(`ffmpeg -i "${file.path}" -vf "${isHDR ? `zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,${resizeVf}` : resizeVf}" -vframes 1 "${file.getVideoPreviewDest(size.name)}"`);
    } catch (e) {
      throw new VideoPreviewGeneratorError('Failed to generate video preview', e);
    }
}
