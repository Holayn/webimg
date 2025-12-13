import { execa } from 'execa';
import { File, FileResizeSize } from "./file.js";

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
      await execa('ffmpeg', ['-i', file.path, '-vf', isHDR ? `zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,${resizeVf}` : resizeVf, '-vframes', '1', file.getVideoPreviewDest(size.name)]);
    } catch (e) {
      throw new VideoPreviewGeneratorError('Failed to generate video preview', e);
    }
}
