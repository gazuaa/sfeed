export interface OpmlFeed {
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  folderName: string | null;
}

export interface OpmlImportResult {
  status: 'imported' | 'existing' | 'failed';
  foldersCreated: number;
  error?: string;
}
