export interface FileIndexEntry {
  id: number;
  path: string;
  file_date: number;
  date: number;
  metadata: Buffer | null;
  exists: number;
  processed: number;
}