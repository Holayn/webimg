import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { findFiles } from "./util.js";
import { File } from "./file.js";
import path, { normalize } from "node:path";
import { ExifData } from "./exif-extractor.js";
import { ExifDateTime } from "exiftool-vendored/dist/ExifDateTime.js";

const ALLOWED_FILE_TYPES = ['.jpg', '.png', '.heic', '.mov', '.mp4', '.JPG', '.PNG', '.HEIC', '.MOV', '.MP4'];

const dbFileName = 'index.db';

interface FileIndexEntry {
  id: number;
  path: string;
  file_mtime: number;
  date: number;
  metadata: Buffer | null;
  exists: number;
  processed: number;
}

export class FileIndex {
  public path: string;
  private db: Database.Database;

  constructor(path: string) {
    this.path = normalize(`${path}/${dbFileName}`);
    mkdirSync(path, { recursive: true });
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
  }

  async update(input: string, exclude?: string[]): Promise<void> {
    const filePaths = await findFiles(input, {
      include: ALLOWED_FILE_TYPES.map(type => `**/*${type}`),
      exclude,
    });

    const filesToAddToIndex = await Promise.all(filePaths
      .map(async filePath => {
        const stats = await stat(filePath);
        return { path: filePath, relpath: path.relative(input, filePath), mtime: stats.mtime.getTime() };
      })
    );

    const entries = this.getIndexedFiles();
    const entriesMap = new Map(entries.map(entry => [entry.path, entry]));

    // Update existing files
    filesToAddToIndex.forEach(file => {
      const entry = entriesMap.get(file.relpath);
      if (entry) {
        if (entry.file_mtime !== file.mtime) {
          this.db.prepare('UPDATE files SET file_mtime = ?, processed = 0 WHERE id = ?').run(file.mtime, entry.id);
        } else if (!entry.exists) {
          this.db.prepare('UPDATE files SET "exists" = 1 WHERE id = ?').run(entry.id);
        }
      } else {
        this.db.prepare('INSERT INTO files (path, file_mtime, date, metadata, "exists", processed) VALUES (?, ?, ?, ?, ?, ?)').run(file.relpath, file.mtime, null, null, 1, 0);
      }
    });

    // Update files that no longer exist
    entriesMap.forEach(entry => {
      if (!filesToAddToIndex.find(file => file.relpath === entry.path)) {
        this.db.prepare('UPDATE files SET "exists" = 0, processed = 0 WHERE id = ?').run(entry.id);
      }
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
