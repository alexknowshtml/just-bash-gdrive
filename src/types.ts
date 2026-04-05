export interface GDriveFsOptions {
  /** OAuth2 access token or async provider for token refresh */
  accessToken: string | (() => Promise<string>);
  /** Constrain agent to a specific folder by Drive folder ID. Defaults to root ("root") */
  rootFolderId?: string;
}

// Google Drive API response shapes

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // string in Drive API
  modifiedTime?: string; // RFC3339
  createdTime?: string;
  parents?: string[];
  md5Checksum?: string;
}

export interface DriveFileList {
  nextPageToken?: string;
  files: DriveFileMetadata[];
}

export interface DriveAbout {
  storageQuota: {
    limit?: string;
    usage: string;
    usageInDrive: string;
  };
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
