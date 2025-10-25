import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { ExifData } from "./exif-extractor.js";

const CONVERT_FILE_IMG_TYPES = ['.heic'];
const CONVERT_FILE_VIDEO_TYPES = ['.mov'];

const CONVERTED_EXTENSION_IMG = '.jpg';
const CONVERTED_EXTENSION_VIDEO = '.mp4';
const VIDEO_PREVIEW_EXTENSION_COMPRESSED = '.jpg';
const VIDEO_PREVIEW_EXTENSION = '.png';

export const DEFAULT_SIZES: FileResizeSize[] = [
  { 
    name: 'large',
    image: { height: 1440 },
    videoPreview: false,
  },
  {
    name: 'small',
    image: { height: 220 },
  },
  {
    name: 'thumb',
    image: { height: 120 },
  }
]

export type FileResizeSize = {
  name: string,
  image?: { height: number },
  video?: { height: number },
  videoPreview?: boolean,
}

export class File {
  path: string;
  input: string;
  output: string;
  indexId: number;
  metadata: FileMetadata | null;
  sizes: FileResizeSize[];

  constructor({ path, input, output, indexId, sizes, metadata }: { path: string, input: string, output: string, indexId: number, sizes?: FileResizeSize[], metadata: FileMetadata | null }) {
    this.path = path;
    this.input = input;
    this.output = output;
    this.indexId = indexId;
    this.metadata = metadata || null;
    this.sizes = sizes || DEFAULT_SIZES;
  }

  get relpath() {
    return this.path.slice(this.input.length);
  }

  get destRelPath() {
    return this.needsConversion ? this.relpath + '__' + this.convertedFileExt : this.relpath;
  }

  get isVideo() {
    return ['.mov', '.mp4'].includes(extname(this.path).toLowerCase());
  }

  get isImage() {
    return ['.jpg', '.png', '.heic'].includes(extname(this.path).toLowerCase());
  }

  get needsConversion() {
    if (this.isVideo) {
      return CONVERT_FILE_VIDEO_TYPES.includes(extname(this.path).toLowerCase());
    }
    if (this.isImage) {
      return CONVERT_FILE_IMG_TYPES.includes(extname(this.path).toLowerCase());
    }
    return false;
  }

  get conversionDest() {
    const newPath = this.relpath + '__' + this.convertedFileExt;
    return join(this.output, 'media', 'converted', newPath);
  }

  get convertedFileExt() {
    if (this.isVideo) {
      return CONVERTED_EXTENSION_VIDEO;
    }
    if (this.isImage) {
      return CONVERTED_EXTENSION_IMG;
    }
    return extname(this.path);
  }

  get isConverted() {
    return existsSync(this.conversionDest);
  }

  get originalDest() {
    return join(this.output, 'media', 'original', this.relpath);
  }

  get isOriginalLinked() {
    return existsSync(this.originalDest);
  }

  get isValidToProcess() {
    if (this.isVideo) {
      if (this.metadata?.QuickTime.LivePhotoAuto) {
        return false;
      }
      return true;
    }
    if (this.isImage) {
      return true;
    }
    return false;
  }

  isResizedTo(size: string) {
    return existsSync(join(this.output, 'media', size, this.destRelPath));
  }

  getResizeDest(size: string) {
    return join(this.output, 'media', size, this.destRelPath);
  }

  canResizeTo(size: string) {
    return this.sizes.some(s => s.name === size && (this.isVideo ? !!s.video : this.isImage ? !!s.image : false));
  }

  isVideoPreviewGenerated(size: string) {
    return existsSync(this.getVideoPreviewDest(size));
  }

  getVideoPreviewDest(size: string) {
    if (this.metadata?.WebImg?.HDR === undefined) {
      throw new Error('Unable to determine video preview destination due to missing HDR flag');
    }
    return join(this.output, 'media', size, this.relpath + '__' + (this.metadata.WebImg.HDR ? VIDEO_PREVIEW_EXTENSION : VIDEO_PREVIEW_EXTENSION_COMPRESSED));
  }
}

export class FileMetadata {
  File: {
    MIMEType?: string | undefined;
    FileSize?: string | undefined;
    FileName?: string | undefined;
  } = {};
  QuickTime: {
    Duration?: number | undefined;
    LivePhotoAuto?: boolean | undefined;
  } = {};
  EXIF: {
    GPSAltitude?: number | undefined;
    GPSAltitudeRef?: string | undefined;
    GPSLatitude?: string | number | undefined;
    GPSLongitude?: string | number | undefined;
    GPSLatitudeRef?: string | undefined;
    GPSLongitudeRef?: string | undefined;

    HostComputer?: string | undefined;
    Model?: string | undefined;

    Orientation?: number | undefined;
  } = {};
  Composite: {
    ImageSize?: string | number | undefined;
    Rotation?: number | undefined;
  } = {};
  WebImg: {
    HDR?: boolean;
  } = {};

  constructor(data?: any) {
    if (data) {
      this.File = data.File || {};
      this.QuickTime = data.QuickTime || {};
      this.EXIF = data.EXIF || {};
      this.Composite = data.Composite || {};
      this.WebImg = data.WebImg || {};
    }
  }

  setFromExif(exif: ExifData) {
    this.File = {
      MIMEType: exif.MIMEType,
      FileSize: exif.FileSize,
      FileName: exif.FileName,
    };
    this.QuickTime = {
      Duration: exif.Duration,
      LivePhotoAuto: exif.LivePhotoAuto,
    };
    this.EXIF = {
      GPSAltitude: exif.GPSAltitude,
      GPSAltitudeRef: exif.GPSAltitudeRef,
      GPSLatitude: exif.GPSLatitude,
      GPSLongitude: exif.GPSLongitude,
      GPSLatitudeRef: exif.GPSLatitudeRef,
      GPSLongitudeRef: exif.GPSLongitudeRef,

      HostComputer: exif.HostComputer,
      Model: exif.Model,

      Orientation: exif.Orientation,
    };
    this.Composite = {
      ImageSize: exif.ImageSize,
      Rotation: exif.Rotation,
    };
  }
}