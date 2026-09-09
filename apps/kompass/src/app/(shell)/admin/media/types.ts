export interface Item {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: string | null;
  folder: string | null;
  references: string[];
}

export interface Folder {
  path: string;
  assetCount: number;
}

export const kb = (b: number) => `${Math.max(1, Math.round(b / 1024))} KB`;
