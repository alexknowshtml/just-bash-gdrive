import { DriveApiError } from "./errors.js";
import type { DriveFileList, DriveFileMetadata, DriveAbout } from "./types.js";
import { FOLDER_MIME } from "./types.js";

const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

export class GDriveClient {
  private getToken: () => Promise<string>;

  constructor(accessToken: string | (() => Promise<string>)) {
    this.getToken =
      typeof accessToken === "string" ? () => Promise.resolve(accessToken) : accessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  private async request<T>(url: string, init: RequestInit = {}, retries = 3): Promise<T> {
    const headers = await this.headers();
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
    });
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request<T>(url, init, retries - 1);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => res.statusText);
      throw new DriveApiError(res.status, body);
    }
    return res.json() as Promise<T>;
  }

  /** List files in a folder. Paginates automatically. */
  async listFolder(folderId: string): Promise<DriveFileMetadata[]> {
    const files: DriveFileMetadata[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents)",
        pageSize: "1000",
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await this.request<DriveFileList>(`${API_BASE}/files?${params}`);
      files.push(...res.files);
      pageToken = res.nextPageToken;
    } while (pageToken);
    return files;
  }

  /** Get file metadata by ID */
  async getFile(fileId: string): Promise<DriveFileMetadata> {
    const params = new URLSearchParams({
      fields: "id,name,mimeType,size,modifiedTime,createdTime,parents",
    });
    return this.request<DriveFileMetadata>(`${API_BASE}/files/${fileId}?${params}`);
  }

  /** Get file metadata by name within a parent folder */
  async findFile(name: string, parentId: string): Promise<DriveFileMetadata | null> {
    const params = new URLSearchParams({
      q: `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,size,modifiedTime,createdTime,parents)",
      pageSize: "1",
    });
    const res = await this.request<DriveFileList>(`${API_BASE}/files?${params}`);
    return res.files[0] ?? null;
  }

  /** Download file content */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const token = await this.getToken();
    const res = await fetch(`${API_BASE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => res.statusText);
      throw new DriveApiError(res.status, body);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Create a new file with content */
  async createFile(
    name: string,
    parentId: string,
    content: Uint8Array,
    mimeType = "application/octet-stream"
  ): Promise<DriveFileMetadata> {
    const metadata = { name, parents: [parentId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([content.buffer as ArrayBuffer], { type: mimeType }));
    const token = await this.getToken();
    const res = await fetch(`${UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,createdTime,parents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => res.statusText);
      throw new DriveApiError(res.status, body);
    }
    return res.json();
  }

  /** Update existing file content */
  async updateFile(fileId: string, content: Uint8Array): Promise<DriveFileMetadata> {
    const token = await this.getToken();
    const res = await fetch(`${UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,name,mimeType,size,modifiedTime`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: content.buffer as ArrayBuffer,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => res.statusText);
      throw new DriveApiError(res.status, body);
    }
    return res.json();
  }

  /** Create a folder */
  async createFolder(name: string, parentId: string): Promise<DriveFileMetadata> {
    return this.request<DriveFileMetadata>(`${API_BASE}/files`, {
      method: "POST",
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
  }

  /** Delete a file or folder (moves to trash) */
  async delete(fileId: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${API_BASE}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => res.statusText);
      throw new DriveApiError(res.status, body);
    }
  }

  /** Copy a file to a new parent/name */
  async copy(fileId: string, name: string, parentId: string): Promise<DriveFileMetadata> {
    return this.request<DriveFileMetadata>(`${API_BASE}/files/${fileId}/copy`, {
      method: "POST",
      body: JSON.stringify({ name, parents: [parentId] }),
    });
  }

  /** Move a file by updating its parent */
  async move(fileId: string, name: string, newParentId: string, oldParentId: string): Promise<DriveFileMetadata> {
    const params = new URLSearchParams({
      addParents: newParentId,
      removeParents: oldParentId,
      fields: "id,name,mimeType,size,modifiedTime,parents",
    });
    return this.request<DriveFileMetadata>(`${API_BASE}/files/${fileId}?${params}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  /** Get storage quota info */
  async getAbout(): Promise<DriveAbout> {
    return this.request<DriveAbout>(`${API_BASE}/about?fields=storageQuota`);
  }
}
