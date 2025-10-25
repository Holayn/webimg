import { mkdir, symlink } from "node:fs/promises";
import { File } from "./file.js";
import path from "node:path";

export async function createOriginalSymlink(file: File) {
  await mkdir(path.dirname(file.originalDest), { recursive: true });
  await symlink(file.path, file.originalDest);
}