import type { CuratedFeed } from './types';

export const CURATED_FEEDS: CuratedFeed[] = [
  // 국내 테크 & 개발
  {
    id: 'geeknews',
    title: 'GeekNews (긱뉴스)',
    xmlUrl: 'https://news.hada.io/rss/news',
    htmlUrl: 'https://news.hada.io',
    description: '개발자, 스타트업, AI 및 기술 트렌드 뉴스를 한국어로 요약·공유하는 커뮤니티',
    category: '국내 테크 & 개발',
    folderSuggest: '국내 테크',
    language: 'KO',
    tags: ['개발', '스타트업', 'AI', '트렌드'],
  },
  {
    id: 'toss-tech',
    title: '토스 테크 (Toss Tech)',
    xmlUrl: 'https://toss.tech/rss.xml',
    htmlUrl: 'https://toss.tech',
    description: '토스팀이 만드는 금융 혁신과 프론트엔드·백엔드·디자인 기술 블로그',
    category: '국내 테크 & 개발',
    folderSuggest: '국내 테크',
    language: 'KO',
    tags: ['프론트엔드', '백엔드', '디자인', '핀테크'],
  },
  {
    id: 'woowahan-tech',
    title: '우아한형제들 기술블로그',
    xmlUrl: 'https://techblog.woowahan.com/feed/',
    htmlUrl: 'https://techblog.woowahan.com',
    description: '배달의민족 서비스를 지탱하는 대규모 아키텍처와 개발 문화 이야기',
    category: '국내 테크 & 개발',
    folderSuggest: '국내 테크',
    language: 'KO',
    tags: ['아키텍처', '서버', '데이터', '문화'],
  },
  {
    id: 'kakao-tech',
    title: '카카오테크 (Kakao Tech)',
    xmlUrl: 'https://tech.kakao.com/feed/',
    htmlUrl: 'https://tech.kakao.com',
    description: '카카오의 AI, 클라우드, 플랫폼 엔지니어링 기술과 인사이트',
    category: '국내 테크 & 개발',
    folderSuggest: '국내 테크',
    language: 'KO',
    tags: ['AI', '클라우드', '플랫폼'],
  },
  {
    id: 'daangn-tech',
    title: '당근 테크 블로그',
    xmlUrl: 'https://medium.com/feed/daangn',
    htmlUrl: 'https://medium.com/daangn',
    description: '당근마켓 엔지니어들이 공유하는 머신러닝, 인프라, 모바일 개발 경험',
    category: '국내 테크 & 개발',
    folderSuggest: '국내 테크',
    language: 'KO',
    tags: ['모바일', 'ML', '인프라'],
  },
  {
    id: '44bits',
    title: '44BITS 클라우드 & 인프라',
    xmlUrl: 'https://www.44bits.io/ko/feed/all',
    htmlUrl: 'https://www.44bits.io',
    description: '클라우드, 컨테이너, 쿠버네티스, 데브옵스 중심의 한국어 기술 미디어',
    category: '국내 테크 & 개발',
    folderSuggest: '국내 테크',
    language: 'KO',
    tags: ['DevOps', 'Cloud', 'Docker'],
  },

  // 글로벌 테크 & AI
  {
    id: 'hacker-news',
    title: 'Hacker News (Frontpage)',
    xmlUrl: 'https://hnrss.org/frontpage',
    htmlUrl: 'https://news.ycombinator.com',
    description: '실리콘밸리와 전 세계 엔지니어들이 가장 주목하는 실시간 테크 뉴스',
    category: 'Global Tech & AI',
    folderSuggest: 'Global Tech & AI',
    language: 'EN',
    tags: ['Silicon Valley', 'Engineering', 'Startups'],
  },
  {
    id: 'cloudflare-blog',
    title: 'The Cloudflare Blog',
    xmlUrl: 'https://blog.cloudflare.com/rss/',
    htmlUrl: 'https://blog.cloudflare.com',
    description: 'Edge 컴퓨팅, Workers, D1, 네트워크 보안 및 글로벌 인터넷 인프라 심층 아티클',
    category: 'Global Tech & AI',
    folderSuggest: 'Global Tech & AI',
    language: 'EN',
    tags: ['Cloudflare', 'Workers', 'Edge', 'Security'],
  },
  {
    id: 'openai-news',
    title: 'OpenAI News',
    xmlUrl: 'https://openai.com/news/rss.xml',
    htmlUrl: 'https://openai.com/news',
    description: 'OpenAI의 최신 모델 출시, 연구 논문 및 AI 안전성 공식 업데이트',
    category: 'Global Tech & AI',
    folderSuggest: 'Global Tech & AI',
    language: 'EN',
    tags: ['LLM', 'AI', 'Research'],
  },
  {
    id: 'the-verge',
    title: 'The Verge',
    xmlUrl: 'https://www.theverge.com/rss/index.xml',
    htmlUrl: 'https://www.theverge.com',
    description: '글로벌 IT 디바이스, 빅테크 기업, 디지털 문화 및 과학 뉴스',
    category: 'Global Tech & AI',
    folderSuggest: 'Global Tech & AI',
    language: 'EN',
    tags: ['Gadgets', 'BigTech', 'Culture'],
  },
  {
    id: 'techcrunch',
    title: 'TechCrunch',
    xmlUrl: 'https://techcrunch.com/feed/',
    htmlUrl: 'https://techcrunch.com',
    description: '글로벌 스타트업 투자, 벤처캐피탈, AI 프로덕트 및 빅테크 브레이킹 뉴스',
    category: 'Global Tech & AI',
    folderSuggest: 'Global Tech & AI',
    language: 'EN',
    tags: ['Startups', 'VC', 'Tech News'],
  },
  {
    id: 'mit-tech-review',
    title: 'MIT Technology Review',
    xmlUrl: 'https://www.technologyreview.com/feed/',
    htmlUrl: 'https://www.technologyreview.com',
    description: 'MIT가 분석하는 미래 기술, 인공지능, 바이오테크, 기후 기술 인사이트',
    category: 'Global Tech & AI',
    folderSuggest: 'Global Tech & AI',
    language: 'EN',
    tags: ['Future Tech', 'DeepTech', 'Science'],
  },

  // 디자인 & 프로덕트
  {
    id: 'smashing-magazine',
    title: 'Smashing Magazine',
    xmlUrl: 'https://www.smashingmagazine.com/feed/',
    htmlUrl: 'https://www.smashingmagazine.com',
    description: '웹 디자이너와 프론트엔드 엔지니어를 위한 UX/UI, CSS, 접근성 심층 가이드',
    category: '디자인 & 프로덕트',
    folderSuggest: '디자인 & 프로덕트',
    language: 'EN',
    tags: ['UX/UI', 'CSS', 'Frontend'],
  },
  {
    id: 'css-tricks',
    title: 'CSS-Tricks',
    xmlUrl: 'https://css-tricks.com/feed/',
    htmlUrl: 'https://css-tricks.com',
    description: '모던 웹 디자인, CSS 레이아웃, 인터랙티브 UI 기법과 프론트엔드 팁',
    category: '디자인 & 프로덕트',
    folderSuggest: '디자인 & 프로덕트',
    language: 'EN',
    tags: ['CSS', 'Web Design', 'UI'],
  },
];

export interface FallbackArticleSeed {
  guid: string;
  title: string;
  url: string;
  author: string;
  summary: string;
  contentHtml: string;
  thumbnailUrl: string;
  publishedAtOffsetMinutes: number;
}

export const FALLBACK_ARTICLES_BY_FEED_URL: Record<string, FallbackArticleSeed[]> = {
  'https://news.hada.io/rss/news': [
    {
      guid: 'gn-cloudflare-d1-workers-2026',
      title: 'Cloudflare Workers와 D1으로 서버리스 풀스택 웹 서비스 구축하기',
      url: 'https://news.hada.io/topic?id=19001',
      author: 'GeekNews Bot',
      summary: '전 세계 엣지 네트워크에서 동작하는 Cloudflare Workers와 SQLite 기반 서버리스 데이터베이스 D1, 그리고 Workers AI를 결합해 지연 시간 없는 모던 웹 애플리케이션을 설계하는 아키텍처 패턴을 소개합니다.',
      contentHtml: `<p>전 세계 엣지 네트워크에서 동작하는 <strong>Cloudflare Workers</strong>와 SQLite 기반 서버리스 데이터베이스 <strong>Cloudflare D1</strong>, 그리고 <strong>Workers AI</strong>를 결합하면 별도의 인프라 관리 없이도 글로벌 스케일의 웹 서비스를 구축할 수 있습니다.</p>
      <h3>핵심 포인트</h3>
      <ul>
        <li><strong>Zero Cold Start:</strong> V8 Isolate 기반으로 밀리초 단위의 즉각적인 응답 속도를 보장합니다.</li>
        <li><strong>D1 Read Replication:</strong> 읽기 중심 워크로드인 RSS 리더나 콘텐츠 플랫폼에서 뛰어난 성능을 발휘합니다.</li>
        <li><strong>Workers AI 내장:</strong> 별도의 외부 LLM API 키 없이도 바인딩 하나로 요약 및 분류 기능을 구현할 수 있습니다.</li>
      </ul>
      <p>특히 GitHub 저장소와 연동하면 커밋 푸시만으로 프론트엔드 정적 에셋과 백엔드 API 워커가 동시에 자동 배포되어 개발 생산성이 크게 향상됩니다.</p>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 25,
    },
    {
      guid: 'gn-local-first-rss-2026',
      title: '정보 과부하 시대에 다시 주목받는 RSS 리더와 큐레이션 워크플로우',
      url: 'https://news.hada.io/topic?id=19002',
      author: 'hada_editor',
      summary: '알고리즘 추천 피드에서 벗어나 내가 직접 선택한 신뢰할 수 있는 기술 블로그와 미디어를 구독하고, AI 요약으로 빠르게 핵심을 파악하는 RSS 워크플로우가 개발자들 사이에서 다시 부상하고 있습니다.',
      contentHtml: `<p>소셜 미디어와 쇼츠 알고리즘이 사용자의 주의를 분산시키는 환경 속에서, 자신이 원하는 정보원만 능동적으로 구독하는 <strong>RSS 프로토콜</strong>의 가치가 재조명받고 있습니다.</p>
      <p>최신 RSS 리더들은 단순한 XML 파서를 넘어 다음과 같은 기능을 결합하고 있습니다:</p>
      <ol>
        <li><strong>원문 스크래핑 (Reader View):</strong> 요약본만 제공하는 피드에서도 광고 없이 본문 전체를 깔끔하게 읽어옵니다.</li>
        <li><strong>LLM 기반 3줄 요약:</strong> 긴 영문 아티클도 읽기 전에 핵심 논지를 한국어로 즉시 파악할 수 있습니다.</li>
        <li><strong>OPML 생태계 호환:</strong> 언제든 구독 목록 전체를 파일 하나로 백업하거나 이전할 수 있습니다.</li>
      </ol>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 110,
    },
  ],
  'https://toss.tech/rss.xml': [
    {
      guid: 'toss-react-19-ux-pattern',
      title: '수백만 건의 피드 데이터를 끊김 없이 렌더링하는 프론트엔드 최적화 기법',
      url: 'https://toss.tech/article/frontend-feed-optimization',
      author: '토스 프론트엔드 챕터',
      summary: '매거진 뷰, 카드 뷰, 리스트 뷰 전환 시 레이아웃 시프트(CLS)를 최소화하고 낙관적 업데이트(Optimistic UI)로 즉각적인 읽음/북마크 인터랙션을 구현한 경험을 공유합니다.',
      contentHtml: `<p>사용자가 수백 개의 아티클을 빠르게 훑어보는 피드 서비스에서는 <strong>반응 속도</strong>가 곧 제품의 품질입니다.</p>
      <h3>1. 낙관적 업데이트 (Optimistic UI)</h3>
      <p>아티클을 읽음 처리하거나 북마크(Read Later)할 때 서버 응답을 기다리지 않고 UI 상태를 즉시 반영하여 0ms의 체감 반응 속도를 구현했습니다.</p>
      <h3>2. 키보드 퍼스트 내비게이션</h3>
      <p>파워 유저들이 마우스 없이 <code>J</code> / <code>K</code> 키로 아티클을 이동하고 <code>M</code>으로 읽음 상태를 토글하며 <code>S</code>로 저장할 수 있도록 단축키 시스템을 설계했습니다.</p>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 45,
    },
  ],
  'https://blog.cloudflare.com/rss/': [
    {
      guid: 'cf-workers-ai-d1-2026',
      title: 'Building AI-Powered Applications on the Edge with Cloudflare D1 and Workers AI',
      url: 'https://blog.cloudflare.com/workers-ai-d1-edge-apps/',
      author: 'Cloudflare Engineering',
      summary: 'How combining serverless SQLite (D1), Workers AI inference at the edge, and Cron Triggers enables full-stack applications with zero infrastructure overhead.',
      contentHtml: `<p>Modern web applications increasingly require three pillars: fast global compute, relational state persistence, and intelligent AI inference. With <strong>Cloudflare Workers</strong>, <strong>D1</strong>, and <strong>Workers AI</strong>, all three run within the same network fabric.</p>
      <h3>Why Edge SQLite + Edge AI Matters</h3>
      <p>When a user requests an article summary in an RSS reader like Sfeed, the Worker reads the article directly from D1, invokes Llama 3.1 on Workers AI, and caches the resulting summary back into D1 so subsequent reads complete in under 10 milliseconds.</p>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 75,
    },
  ],
  'https://hnrss.org/frontpage': [
    {
      guid: 'hn-sqlite-at-scale-2026',
      title: 'Show HN: Sfeed – A Fast, Multi-User RSS Reader Built for Cloudflare Pages & D1',
      url: 'https://news.ycombinator.com/item?id=42991001',
      author: 'sfeed_maker',
      summary: 'A clean, Feedly-inspired RSS reader featuring Magazine/Card/List views, full-text Reader View scraping, OPML import/export, Google OAuth, and Cloudflare Workers AI summaries.',
      contentHtml: `<p>We built <strong>Sfeed</strong> to bring back the speed and clarity of classic RSS readers while running entirely on serverless edge infrastructure.</p>
      <p>Features include:</p>
      <ul>
        <li>Magazine, Cards, and Compact Title-Only views</li>
        <li>Folder organization and curated Korean & Global tech feeds</li>
        <li>Built-in Reader View scraper for truncated RSS feeds</li>
        <li>One-click AI article summarization via Cloudflare Workers AI</li>
      </ul>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 90,
    },
  ],
  'https://www.smashingmagazine.com/feed/': [
    {
      guid: 'smashing-reading-experience-2026',
      title: 'Designing Calm, High-Density Reading Interfaces for Modern Web Apps',
      url: 'https://www.smashingmagazine.com/2026/designing-reading-interfaces/',
      author: 'Vitaly Friedman',
      summary: 'Typography, line length, contrast ratios in dark mode, and scannable card hierarchies that make reading long-form articles on the web effortless.',
      contentHtml: `<p>Great reading interfaces get out of the way. Whether a reader prefers a visual <strong>Magazine layout</strong>, a scannable <strong>Card grid</strong>, or a high-density <strong>Title-only list</strong>, typography and spacing determine cognitive load.</p>
      <p>In dark mode, using carefully calibrated slate and zinc surfaces rather than harsh pure black reduces eye strain during extended reading sessions.</p>`,
      thumbnailUrl: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=900&q=80',
      publishedAtOffsetMinutes: 180,
    },
  ],
};
