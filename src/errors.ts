export class FsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FsError";
  }
}

export const enoent = (path: string) =>
  new FsError("ENOENT", `no such file or directory: ${path}`);
export const enotdir = (path: string) =>
  new FsError("ENOTDIR", `not a directory: ${path}`);
export const eisdir = (path: string) =>
  new FsError("EISDIR", `illegal operation on a directory: ${path}`);
export const eexist = (path: string) =>
  new FsError("EEXIST", `file already exists: ${path}`);
export const enosys = (op: string) =>
  new FsError("ENOSYS", `${op} not supported`);
export const enospc = () =>
  new FsError("ENOSPC", `no space left on device`);

export class DriveApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error: { message: string } }).error.message
        : String(body);
    super(msg);
    this.status = status;
    this.body = body;
    this.name = "DriveApiError";
  }
}

export function mapDriveError(err: DriveApiError, path: string): FsError {
  switch (err.status) {
    case 404:
      return enoent(path);
    case 403:
      return new FsError("EACCES", `permission denied: ${path}`);
    case 507:
      return enospc();
    default:
      return new FsError("EIO", `drive api error ${err.status}: ${err.message}`);
  }
}
