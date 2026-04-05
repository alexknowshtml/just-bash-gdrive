import { describe, it, expect, beforeEach, vi } from "vitest";
import { GDriveFs } from "./gdrive-fs.js";
import { FOLDER_MIME } from "./types.js";

// ── Minimal Drive API mock ────────────────────────────────────────────────

const mockFiles: Record<string, { id: string; name: string; mimeType: string; size?: string; parents?: string[] }> = {
  "file-1": { id: "file-1", name: "hello.txt", mimeType: "text/plain", size: "13", parents: ["root"] },
  "folder-1": { id: "folder-1", name: "docs", mimeType: FOLDER_MIME, parents: ["root"] },
  "file-2": { id: "file-2", name: "readme.md", mimeType: "text/markdown", size: "42", parents: ["folder-1"] },
};

const mockContents: Record<string, Uint8Array> = {
  "file-1": new TextEncoder().encode("hello, world!"),
  "file-2": new TextEncoder().encode("# Readme\n\nThis is a readme."),
};

function makeMockFs(): GDriveFs {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const urlStr = url.toString();

    // Token refresh
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
    }

    // Search by name (must check before list-folder since both have "parents")
    // URLSearchParams encodes "name =" as "name+%3D+" or "name%20%3D%20"
    const decoded = decodeURIComponent(urlStr.replace(/\+/g, " "));
    if (decoded.includes("name =")) {
      const nameMatch = decoded.match(/name = '([^']+)'/);
      const name = nameMatch?.[1];
      const parentMatch = decoded.match(/'([^']+)' in parents/);
      const parentId = parentMatch?.[1];
      const found = Object.values(mockFiles).filter(
        (f) => f.name === name && (!parentId || f.parents?.includes(parentId))
      );
      return new Response(JSON.stringify({ files: found }), { status: 200 });
    }

    // List folder
    if (urlStr.includes("/drive/v3/files") && urlStr.includes("parents") && !urlStr.includes("alt=media")) {
      const parentMatch = urlStr.match(/'([^']+)'\s+in\s+parents/);
      const parentId = parentMatch?.[1] ?? "root";
      const children = Object.values(mockFiles).filter((f) => f.parents?.includes(parentId));
      return new Response(JSON.stringify({ files: children }), { status: 200 });
    }

    // Download file content
    if (urlStr.includes("alt=media")) {
      const idMatch = urlStr.match(/\/files\/([^?]+)\?/);
      const fileId = idMatch?.[1];
      const content = fileId ? mockContents[fileId] : null;
      if (!content) return new Response("Not found", { status: 404 });
      return new Response(content.buffer as ArrayBuffer, { status: 200 });
    }

    // Get file metadata by ID
    if (urlStr.match(/\/drive\/v3\/files\/[^/?]+\?fields/)) {
      const idMatch = urlStr.match(/\/files\/([^?]+)\?/);
      const fileId = idMatch?.[1];
      const file = fileId ? mockFiles[fileId] : null;
      if (!file) return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 });
      return new Response(JSON.stringify(file), { status: 200 });
    }


    // Create file (multipart upload)
    if (urlStr.includes("uploadType=multipart")) {
      const newId = `new-${Date.now()}`;
      return new Response(JSON.stringify({ id: newId, name: "new-file", mimeType: "application/octet-stream", parents: ["root"] }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: { message: "Unmatched mock: " + urlStr } }), { status: 500 });
  });

  vi.stubGlobal("fetch", fetchMock);

  return new GDriveFs({ accessToken: "test-token", rootFolderId: "root" });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GDriveFs", () => {
  let fs: GDriveFs;

  beforeEach(() => {
    vi.restoreAllMocks();
    fs = makeMockFs();
  });

  describe("readdir", () => {
    it("lists root folder contents", async () => {
      const entries = await fs.readdir("/");
      expect(entries).toContain("hello.txt");
      expect(entries).toContain("docs");
    });
  });

  describe("readdirWithFileTypes", () => {
    it("returns correct isFile/isDirectory flags", async () => {
      const entries = await fs.readdirWithFileTypes("/");
      const file = entries.find((e) => e.name === "hello.txt");
      const folder = entries.find((e) => e.name === "docs");
      expect(file?.isFile).toBe(true);
      expect(file?.isDirectory).toBe(false);
      expect(folder?.isDirectory).toBe(true);
      expect(folder?.isFile).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      expect(await fs.exists("/hello.txt")).toBe(true);
    });
    it("returns false for non-existent file", async () => {
      expect(await fs.exists("/nonexistent.txt")).toBe(false);
    });
  });

  describe("stat", () => {
    it("returns correct stat for a file", async () => {
      const stat = await fs.stat("/hello.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(13);
    });
    it("returns correct stat for a folder", async () => {
      const stat = await fs.stat("/docs");
      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });
  });

  describe("readFile", () => {
    it("reads file content as string", async () => {
      const content = await fs.readFile("/hello.txt");
      expect(content).toBe("hello, world!");
    });
  });

  describe("readFileBuffer", () => {
    it("reads file content as Uint8Array", async () => {
      const buf = await fs.readFileBuffer("/hello.txt");
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(buf)).toBe("hello, world!");
    });
  });

  describe("POSIX stubs", () => {
    it("chmod throws ENOSYS", async () => {
      await expect(fs.chmod("/hello.txt", 0o644)).rejects.toMatchObject({ code: "ENOSYS" });
    });
    it("symlink throws ENOSYS", async () => {
      await expect(fs.symlink("/target", "/link")).rejects.toMatchObject({ code: "ENOSYS" });
    });
  });

  describe("resolvePath", () => {
    it("resolves relative paths", () => {
      expect(fs.resolvePath("/docs", "readme.md")).toBe("/docs/readme.md");
    });
    it("absolute paths are returned as-is", () => {
      expect(fs.resolvePath("/docs", "/hello.txt")).toBe("/hello.txt");
    });
  });

  describe("getAllPaths", () => {
    it("returns empty array before prefetch (glob not supported until prefetchAllPaths)", () => {
      // By design: returns [] until prefetchAllPaths() is called
      // This signals to just-bash that glob operations aren't supported yet
      const paths = fs.getAllPaths();
      expect(paths).toEqual([]);
    });
  });
});
