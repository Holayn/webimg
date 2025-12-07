export interface FileIndexEntry {
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