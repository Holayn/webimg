import { parentPort, workerData } from 'node:worker_threads';
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import Database from 'better-sqlite3';
import { FileIndexEntry } from './types.js';

const sendLog = (message: string) => {
  parentPort?.postMessage({ type: 'log', message });
};

const { dbPath, input, filePaths, entriesMapArray } = workerData as { dbPath: string; input: string; filePaths: string[]; entriesMapArray: [string, FileIndexEntry][]; };

const filesToAddToIndex = await Promise.all(filePaths
  .map(async filePath => {
    const stats = await stat(filePath);
    return { path: filePath, relpath: relative(input, filePath), indexPath: relative(input, filePath).replaceAll('\\', '/'), mtime: stats.mtime.getTime() };
  })
);

const entriesMap: Map<string, FileIndexEntry> = new Map(entriesMapArray as [string, FileIndexEntry][]);

try {
  const db = new Database(dbPath);
  
  const updateStmt = {
    fileMtime: db.prepare('UPDATE files SET file_mtime = ? WHERE id = ?'),
    fileMtimeAndProcessed: db.prepare('UPDATE files SET file_mtime = ?, processed = 0 WHERE id = ?'),
    setExists: db.prepare('UPDATE files SET "exists" = ? WHERE id = ?'),
    insert: db.prepare('INSERT INTO files (path, file_mtime, date, metadata, "exists", processed) VALUES (?, ?, ?, ?, ?, ?)'),
    setExistsAndProcessed: db.prepare('UPDATE files SET "exists" = 0, processed = 0 WHERE id = ?')
  };

  const transaction = db.transaction(() => {
    // 1. Update existing files and insert new ones
    filesToAddToIndex.forEach(file => {
      const entry = entriesMap.get(file.indexPath);
      
      if (entry) {
        // Handle deprecated file_date field logic
        if (entry.file_date && !entry.file_mtime) {
          entry.file_mtime = entry.file_date;
          updateStmt.fileMtime.run(entry.file_date, entry.id);
          sendLog(`Updated ${file.indexPath} in index: entry missing file_mtime, setting it...`);
        }

        if (entry.file_mtime !== file.mtime) {
          updateStmt.fileMtimeAndProcessed.run(file.mtime, entry.id);
          sendLog(`Updated ${file.indexPath} in index: file mtime updated, setting processed to false.`);
        } else if (!entry.exists) {
          updateStmt.setExists.run(1, entry.id);
          sendLog(`Updated ${file.indexPath} in index: file added back, setting exists to true.`);
        }
        // Remove from map to track which entries are left (files that no longer exist)
        entriesMap.delete(file.indexPath); 
      } else {
        updateStmt.insert.run(file.indexPath, file.mtime, null, null, 1, 0);
        sendLog(`Added ${file.indexPath} to index.`);
      }
    });

    // 2. Update files that no longer exist (Remaining entries in entriesMap)
    entriesMap.forEach(entry => {
      if (entry.exists) {
        updateStmt.setExistsAndProcessed.run(entry.id);
        sendLog(`Removed ${entry.path} from index.`);
      }
    });
  });

  transaction();
  db.close();

  parentPort?.postMessage({ type: 'complete' });
} catch (error: any) {
  parentPort?.postMessage({ type: 'error', message: error.message });
}