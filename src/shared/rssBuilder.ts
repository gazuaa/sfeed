export interface BuilderArticle {
  title: string;
  url: string;
  summary: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
  dateSource: 'feed' | 'collected';
}
export interface BuilderGroup {
  selector: string;
  label: string;
  articles: BuilderArticle[];
}
export interface BuilderAnalysis {
  sourceUrl: string;
  title: string;
  groups: BuilderGroup[];
  rendered: boolean;
}
