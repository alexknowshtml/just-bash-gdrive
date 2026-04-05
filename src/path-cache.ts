/**
 * Path-to-ID cache for Google Drive.
 *
 * Drive uses opaque file IDs, not paths. This cache maintains a
 * bidirectional map between POSIX paths and Drive file IDs so that
 * all filesystem operations can resolve paths without extra API calls
 * after an initial prefetch.
 */

export interface CacheEntry {
  id: string;
  isFolder: boolean;
  mimeType: string;
  size?: number;
  modifiedTime?: Date;
  createdTime?: Date;
  parentId?: string;
}

export class PathCache {
  private pathToEntry = new Map<string, CacheEntry>();
  private idToPath = new Map<string, string>();

  set(path: string, entry: CacheEntry): void {
    const normalized = normalizePath(path);
    this.pathToEntry.set(normalized, entry);
    this.idToPath.set(entry.id, normalized);
  }

  get(path: string): CacheEntry | undefined {
    return this.pathToEntry.get(normalizePath(path));
  }

  getById(id: string): string | undefined {
    return this.idToPath.get(id);
  }

  delete(path: string): void {
    const normalized = normalizePath(path);
    const entry = this.pathToEntry.get(normalized);
    if (entry) {
      this.idToPath.delete(entry.id);
      this.pathToEntry.delete(normalized);
    }
  }

  /** Move: update path mapping when a file is renamed/moved */
  move(oldPath: string, newPath: string): void {
    const entry = this.pathToEntry.get(normalizePath(oldPath));
    if (entry) {
      this.delete(oldPath);
      this.set(newPath, entry);
    }
  }

  children(parentPath: string): Array<[string, CacheEntry]> {
    const normalized = normalizePath(parentPath);
    const prefix = normalized === "/" ? "/" : normalized + "/";
    const result: Array<[string, CacheEntry]> = [];
    for (const [path, entry] of this.pathToEntry) {
      if (path === normalized) continue;
      if (!path.startsWith(prefix)) continue;
      // Only direct children (no additional slashes after prefix)
      const rest = path.slice(prefix.length);
      if (!rest.includes("/")) result.push([path, entry]);
    }
    return result;
  }

  getAllPaths(): string[] {
    return Array.from(this.pathToEntry.keys());
  }

  has(path: string): boolean {
    return this.pathToEntry.has(normalizePath(path));
  }

  clear(): void {
    this.pathToEntry.clear();
    this.idToPath.clear();
  }
}

export function normalizePath(p: string): string {
  // Collapse double slashes, ensure leading slash, strip trailing slash
  let normalized = p.replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  if (normalized !== "/" && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function dirname(p: string): string {
  const normalized = normalizePath(p);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "/";
  return normalized.slice(0, idx);
}

export function basename(p: string): string {
  const normalized = normalizePath(p);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join("/"));
}
