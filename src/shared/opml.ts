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
  failureSaved?: boolean;
}

export interface OpmlImportFailure {
  item: OpmlFeed;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  suggestedUrl: string | null;
}
