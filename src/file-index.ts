import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import Database from "better-sqlite3";
import { findFiles } from "./util.js";
import { File, ALLOWED_IMG_TYPES, ALLOWED_VIDEO_TYPES } from "./file.js";
import { dirname, normalize, join } from "node:path";
import { fileURLToPath } from 'node:url';
import { ExifData } from "./exif-extractor.js";
import { ExifDateTime } from "exiftool-vendored/dist/ExifDateTime.js";
import { Logger } from "./logger.js";
import { FileIndexEntry } from "./types.js";
import { Worker } from "node:worker_threads";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALLOWED_FILE_TYPES = [...ALLOWED_IMG_TYPES, ...ALLOWED_VIDEO_TYPES];

const dbFileName = 'index.db';

export class FileIndex {
  public path: string;
  private db: Database.Database;
  private logger: Logger;

  constructor(path: string, logger: Logger, dryRun: boolean = false) {
    this.logger = logger;
    this.path = normalize(`${path}/${dbFileName}`);
    mkdirSync(path, { recursive: true });

    if (dryRun) {
      const dryRunDbPath = normalize(`${path}/index-dry.db`);
      if (existsSync(this.path)) {
        copyFileSync(this.path, dryRunDbPath);
      }
      this.path = dryRunDbPath;
    }

    this.db = new Database(this.path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        file_mtime INTEGER NOT NULL, 
        date INTEGER,
        metadata BLOB, 
        "exists" INTEGER NOT NULL DEFAULT 1,
        processed INTEGER
      );
    `);

    try {
      // Handle old indexes that don't have "exists" column.
      this.db.prepare('ALTER TABLE files ADD COLUMN "exists" INTEGER NOT NULL DEFAULT 1').run();
    } catch (e) {}
    try {
      // Handle old indexes that don't have "file_mtime" column.
      this.db.prepare('ALTER TABLE files ADD COLUMN file_mtime INTEGER NOT NULL DEFAULT 0').run();
    } catch (e) {}
  }

  async update(input: string, exclude?: string[]): Promise<void> {
    const filePaths = await findFiles(input, {
      include: ALLOWED_FILE_TYPES.map(type => `**/*${type}`),
      exclude,
    });

    const entries = this.getIndexedFiles();

    // Convert to an array of [key, value] pairs to pass to the worker
    const entriesMapArray = Array.from(new Map(entries.map(entry => [entry.path, entry])).entries());

    return new Promise((resolve, reject) => {
      const worker = new Worker(join(__dirname, 'file-index-worker.js'), {
        workerData: {
          dbPath: this.path,
          input,
          filePaths,
          entriesMapArray,
        }
      });

      worker.on('message', (result) => {
        switch (result.type) {
          case 'log':
            this.logger.log(result.message);
            break;
            
          case 'complete':
            resolve();
            break;
            
          case 'error':
            this.logger.error(`Worker failed with error: ${result.message}`);
            reject(new Error(result.message));
            break;
            
          default:
            this.logger.log(`Received unknown message type from worker: ${result.type}`);
        }
      });

      worker.on('error', (err) => {
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}.`));
        }
      });
    });
  }

  getIndexedFiles(): FileIndexEntry[] {
    return this.db.prepare('SELECT * FROM files').all() as FileIndexEntry[];
  }

  updateMetadataField(file: File) {
    this.db.prepare('UPDATE files SET metadata = ? WHERE id = ?').run(JSON.stringify(file.metadata), file.indexId);
  }

  updateDateField(file: File, exif: ExifData) {
    const date = (exif.DateTimeOriginal || exif.ModifyDate || exif.CreationDate || exif.CreateDate || exif.DateCreated) as ExifDateTime;
    
    this.db.prepare('UPDATE files SET date = ? WHERE id = ?').run(date?.toMillis() || 0, file.indexId);
  }

  updateAsProcessed(ids: number[]) {
    this.db.prepare(`UPDATE files SET processed = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }

  removeProcessed(ids: number[]) {
    this.db.prepare(`UPDATE files SET processed = 0 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
}
