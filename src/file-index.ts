import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { findFiles } from "./util.js";
import { File, ALLOWED_IMG_TYPES, ALLOWED_VIDEO_TYPES } from "./file.js";
import { relative, normalize } from "node:path";
import { ExifData } from "./exif-extractor.js";
import { ExifDateTime } from "exiftool-vendored/dist/ExifDateTime.js";
import { Logger } from "./logger.js";

const ALLOWED_FILE_TYPES = [...ALLOWED_IMG_TYPES, ...ALLOWED_VIDEO_TYPES];

const dbFileName = 'index.db';

interface FileIndexEntry {
  id: number;
  path: string;
  file_mtime: number;
  date: number;
  metadata: Buffer | null;
  exists: number;
  processed: number;

  // Handle deprecated field
  file_date?: number;
}

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

    const filesToAddToIndex = await Promise.all(filePaths
      .map(async filePath => {
        const stats = await stat(filePath);
        return { path: filePath, relpath: relative(input, filePath), indexPath: relative(input, filePath).replaceAll('\\', '/'), mtime: stats.mtime.getTime() };
      })
    );

    const entries = this.getIndexedFiles();
    const entriesMap = new Map(entries.map(entry => [entry.path, entry]));

    // Return a promise that resolves when the transaction is complete
    return new Promise((resolve, reject) => {
      // Use setImmediate to run the transaction in the next tick
      setImmediate(() => {
        try {
          const transaction = this.db.transaction(() => {
            const updateStmt = {
              fileMtime: this.db.prepare('UPDATE files SET file_mtime = ? WHERE id = ?'),
              fileMtimeAndProcessed: this.db.prepare('UPDATE files SET file_mtime = ?, processed = 0 WHERE id = ?'),
              setExists: this.db.prepare('UPDATE files SET "exists" = ? WHERE id = ?'),
              insert: this.db.prepare('INSERT INTO files (path, file_mtime, date, metadata, "exists", processed) VALUES (?, ?, ?, ?, ?, ?)'),
              setExistsAndProcessed: this.db.prepare('UPDATE files SET "exists" = 0, processed = 0 WHERE id = ?')
            };

            // Update existing files
            filesToAddToIndex.forEach(file => {
              const entry = entriesMap.get(file.indexPath);
              if (entry) {
                if (entry.file_date && !entry.file_mtime) {
                  entry.file_mtime = entry.file_date;
                  updateStmt.fileMtime.run(entry.file_date, entry.id);
                  this.logger.log(`Updated ${file.indexPath} in index: entry missing file_mtime, setting it...`);
                }

                if (entry.file_mtime !== file.mtime) {
                  updateStmt.fileMtimeAndProcessed.run(file.mtime, entry.id);
                  this.logger.log(`Updated ${file.indexPath} in index: file mtime updated, setting processed to false.`);
                } else if (!entry.exists) {
                  updateStmt.setExists.run(1, entry.id);
                  this.logger.log(`Updated ${file.indexPath} in index: file added back, setting exists to true.`);
                }
              } else {
                updateStmt.insert.run(file.indexPath, file.mtime, null, null, 1, 0);
                this.logger.log(`Added ${file.indexPath} to index.`);
              }
            });

            // Update files that no longer exist
            entriesMap.forEach(entry => {
              if (!filesToAddToIndex.find(file => file.indexPath === entry.path)) {
                updateStmt.setExistsAndProcessed.run(entry.id);
                this.logger.log(`Removed ${entry.path} from index.`);
              }
            });
          });

          // Execute the transaction
          transaction();
          resolve();
        } catch (error) {
          reject(error);
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
