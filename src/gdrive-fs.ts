import type { IFileSystem } from "just-bash";
import { GDriveClient } from "./gdrive-client.js";
import { PathCache, normalizePath, dirname, basename, joinPath } from "./path-cache.js";
import { enoent, eisdir, enotdir, eexist, enosys, mapDriveError, DriveApiError } from "./errors.js";
import { FOLDER_MIME } from "./types.js";
import type { GDriveFsOptions, DriveFileMetadata } from "./types.js";

export class GDriveFs implements IFileSystem {
  private client: GDriveClient;
  private cache: PathCache;
  private rootFolderId: string;
  private prefetched = false;

  constructor(options: GDriveFsOptions) {
    this.client = new GDriveClient(options.accessToken);
    this.cache = new PathCache();
    this.rootFolderId = options.rootFolderId ?? "root";
    // Seed root
    this.cache.set("/", {
      id: this.rootFolderId,
      isFolder: true,
      mimeType: FOLDER_MIME,
    });
  }

  // ── Path resolution ──────────────────────────────────────────────────────

  resolvePath(base: string, target: string): string {
    if (target.startsWith("/")) return normalizePath(target);
    return normalizePath(base + "/" + target);
  }

  /** Resolve a path to a Drive file ID, fetching parent chain if needed */
  private async resolveId(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const cached = this.cache.get(normalized);
    if (cached) return cached.id;

    // Walk the path components to build the cache entry
    const parts = normalized.split("/").filter(Boolean);
    let parentId = this.rootFolderId;
    let currentPath = "/";

    for (const part of parts) {
      currentPath = joinPath(currentPath, part);
      const existing = this.cache.get(currentPath);
      if (existing) {
        parentId = existing.id;
        continue;
      }
      try {
        const file = await this.client.findFile(part, parentId);
        if (!file) throw enoent(currentPath);
        this.cache.set(currentPath, this.metaToEntry(file));
        parentId = file.id;
      } catch (err) {
        if (err instanceof DriveApiError) throw mapDriveError(err, currentPath);
        throw err;
      }
    }

    return this.cache.get(normalized)!.id;
  }

  private metaToEntry(file: DriveFileMetadata) {
    return {
      id: file.id,
      isFolder: file.mimeType === FOLDER_MIME,
      mimeType: file.mimeType,
      size: file.size ? parseInt(file.size, 10) : undefined,
      modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
      createdTime: file.createdTime ? new Date(file.createdTime) : undefined,
      parentId: file.parents?.[0],
    };
  }

  // ── Prefetch (enables glob support) ─────────────────────────────────────

  async prefetchAllPaths(folderId?: string, basePath = "/"): Promise<void> {
    const id = folderId ?? this.rootFolderId;
    const files = await this.client.listFolder(id);
    for (const file of files) {
      const filePath = joinPath(basePath, file.name);
      this.cache.set(filePath, this.metaToEntry(file));
      if (file.mimeType === FOLDER_MIME) {
        await this.prefetchAllPaths(file.id, filePath);
      }
    }
    if (!folderId) this.prefetched = true;
  }

  getAllPaths(): string[] {
    return this.prefetched ? this.cache.getAllPaths() : [];
  }

  // ── Stat / exists ────────────────────────────────────────────────────────

  async stat(path: string) {
    const normalized = normalizePath(path);
    const cached = this.cache.get(normalized);
    if (cached) return this.entryToStat(normalized, cached);
    const id = await this.resolveId(normalized);
    const entry = this.cache.get(normalized)!;
    return this.entryToStat(normalized, entry);
  }

  async lstat(path: string) {
    return this.stat(path); // Drive has no symlinks
  }

  private entryToStat(_path: string, entry: ReturnType<PathCache["get"]> & {}) {
    return {
      isFile: !entry.isFolder,
      isDirectory: entry.isFolder,
      isSymbolicLink: false,
      size: entry.size ?? 0,
      mtime: entry.modifiedTime ?? new Date(0),
      mode: entry.isFolder ? 0o755 : 0o644,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.resolveId(path);
      return true;
    } catch {
      return false;
    }
  }

  async realpath(path: string): Promise<string> {
    await this.resolveId(path); // throws if not found
    return normalizePath(path);
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path);
    const entry = this.cache.get(normalized);
    if (entry?.isFolder) throw eisdir(normalized);
    try {
      const id = await this.resolveId(normalized);
      const cached = this.cache.get(normalized)!;
      if (cached.isFolder) throw eisdir(normalized);
      return await this.client.downloadFile(id);
    } catch (err) {
      if (err instanceof DriveApiError) throw mapDriveError(err, normalized);
      throw err;
    }
  }

  async readFile(path: string): Promise<string> {
    const buf = await this.readFileBuffer(path);
    return new TextDecoder().decode(buf);
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirWithFileTypes(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean; isSymbolicLink: boolean }>> {
    const normalized = normalizePath(path);
    const id = await this.resolveId(normalized);
    const entry = this.cache.get(normalized)!;
    if (!entry.isFolder) throw enotdir(normalized);

    try {
      const files = await this.client.listFolder(id);
      return files.map((file) => {
        const filePath = joinPath(normalized, file.name);
        this.cache.set(filePath, this.metaToEntry(file));
        const isDir = file.mimeType === FOLDER_MIME;
        return {
          name: file.name,
          isDirectory: isDir,
          isFile: !isDir,
          isSymbolicLink: false,
        };
      });
    } catch (err) {
      if (err instanceof DriveApiError) throw mapDriveError(err, normalized);
      throw err;
    }
  }

  // ── Write ────────────────────────────────────────────────────────────────

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const normalized = normalizePath(path);
    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const parentPath = dirname(normalized);
    const name = basename(normalized);

    try {
      const parentId = await this.resolveId(parentPath);
      const existing = this.cache.get(normalized);

      if (existing) {
        if (existing.isFolder) throw eisdir(normalized);
        await this.client.updateFile(existing.id, data);
        this.cache.set(normalized, { ...existing, size: data.byteLength, modifiedTime: new Date() });
      } else {
        const file = await this.client.createFile(name, parentId, data);
        this.cache.set(normalized, this.metaToEntry(file));
      }
    } catch (err) {
      if (err instanceof DriveApiError) throw mapDriveError(err, normalized);
      throw err;
    }
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const normalized = normalizePath(path);
    let existing: Uint8Array = new Uint8Array(0);
    if (await this.exists(normalized)) {
      existing = await this.readFileBuffer(normalized);
    }
    const append = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const combined = new Uint8Array(existing.byteLength + append.byteLength);
    combined.set(existing, 0);
    combined.set(append, existing.byteLength);
    await this.writeFile(normalized, combined);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    if (await this.exists(normalized)) {
      if (!options?.recursive) throw eexist(normalized);
      return;
    }

    if (options?.recursive) {
      const parent = dirname(normalized);
      if (parent !== normalized) await this.mkdir(parent, { recursive: true });
    }

    const parentPath = dirname(normalized);
    const name = basename(normalized);
    try {
      const parentId = await this.resolveId(parentPath);
      const folder = await this.client.createFolder(name, parentId);
      this.cache.set(normalized, this.metaToEntry(folder));
    } catch (err) {
      if (err instanceof DriveApiError) throw mapDriveError(err, normalized);
      throw err;
    }
  }

  // ── Delete / move / copy ─────────────────────────────────────────────────

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const normalized = normalizePath(path);
    try {
      const id = await this.resolveId(normalized);
      const entry = this.cache.get(normalized)!;
      if (entry.isFolder && !options?.recursive) {
        throw new (await import("./errors.js")).FsError("EISDIR", `is a directory: ${normalized}`);
      }
      await this.client.delete(id);
      // Purge from cache (including children)
      for (const p of this.cache.getAllPaths()) {
        if (p === normalized || p.startsWith(normalized + "/")) this.cache.delete(p);
      }
    } catch (err) {
      if (options?.force) return;
      if (err instanceof DriveApiError) throw mapDriveError(err, normalized);
      throw err;
    }
  }

  async cp(src: string, dest: string): Promise<void> {
    const srcNorm = normalizePath(src);
    const destNorm = normalizePath(dest);
    try {
      const srcId = await this.resolveId(srcNorm);
      const destParentId = await this.resolveId(dirname(destNorm));
      const file = await this.client.copy(srcId, basename(destNorm), destParentId);
      this.cache.set(destNorm, this.metaToEntry(file));
    } catch (err) {
      if (err instanceof DriveApiError) throw mapDriveError(err, srcNorm);
      throw err;
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    const srcNorm = normalizePath(src);
    const destNorm = normalizePath(dest);
    try {
      const srcId = await this.resolveId(srcNorm);
      const srcEntry = this.cache.get(srcNorm)!;
      const newParentId = await this.resolveId(dirname(destNorm));
      const oldParentId = srcEntry.parentId ?? this.rootFolderId;
      const file = await this.client.move(srcId, basename(destNorm), newParentId, oldParentId);
      this.cache.delete(srcNorm);
      this.cache.set(destNorm, this.metaToEntry(file));
    } catch (err) {
      if (err instanceof DriveApiError) throw mapDriveError(err, srcNorm);
      throw err;
    }
  }

  // ── Unsupported POSIX ops ────────────────────────────────────────────────

  async chmod(_path: string, _mode: number): Promise<void> {
    throw enosys("chmod");
  }
  async symlink(_target: string, _path: string): Promise<void> {
    throw enosys("symlink");
  }
  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw enosys("link");
  }
  async readlink(path: string): Promise<string> {
    throw enosys("readlink");
  }
  async utimes(_path: string, _atime: Date, _mtime: Date): Promise<void> {
    throw enosys("utimes");
  }
}
