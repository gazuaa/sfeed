# Sfeed — Cloudflare Edge & Workers AI 기반 멀티유저 RSS 서비스

**Sfeed**는 Feedly에서 영감을 받아 제작된 모던 멀티유저 RSS 큐레이션 플랫폼입니다. **React (Vite) + Hono + Cloudflare D1 (SQLite) + Cloudflare Workers AI** 스택으로 구축되어 GitHub과 Cloudflare만으로도 서버 비용 걱정 없이 배포할 수 있습니다.

---

## ✨ 주요 기능

1. **Google 로그인 & 멀티유저 격리 (Cloudflare D1)**
   - Google OAuth 2.0 인증 지원 (`GOOGLE_CLIENT_ID` 연동 시 정식 리다이렉트 동작)
   - 이메일만으로 로그인하는 빠른 계정 전환은 **로컬 개발 환경에서만** 동작합니다 (`npm run dev`에서는 기본 활성화, `wrangler dev`에서는 `.dev.vars`에 `ALLOW_QUICK_LOGIN="true"` 설정). 배포 환경에서는 API가 403을 반환하고 UI도 숨겨집니다.
   - 사용자별 폴더, 피드 구독, 읽음/안읽음 상태, 북마크(Read Later), 테마·레이아웃 설정이 D1에 독립 저장
2. **카테고리(폴더) 관리 & 추천 피드 카탈로그**
   - 신규 가입 시 빈 구독 목록으로 시작하며, 추천 피드 카탈로그에서 원하는 피드만 직접 구독 (선택한 피드의 추천 폴더도 함께 생성)
   - 긱뉴스(GeekNews), 토스 테크, 우아한형제들, 카카오테크, Cloudflare Blog, Hacker News, OpenAI News 등 엄선된 카탈로그 원클릭 구독
   - 추천 피드 카드를 누르면 최근 글 최대 10개의 제목·요약을 미리 확인하고, 원하는 피드만 선택해 구독
   - 일반 웹사이트 주소만 입력해도 RSS/Atom 피드 링크 자동 탐색(Auto-discovery)
3. **Feedly 스타일 3종 레이아웃 & 다크/라이트 모드**
   - **매거진 뷰 (Magazine View)**: 썸네일 + 핵심 요약 중심의 기본 레이아웃
   - **카드 뷰 (Cards View)**: 커버 이미지 중심의 반응형 그리드 레이아웃
   - **리스트 뷰 (Title-Only Compact View)**: 한눈에 수십 개의 헤드라인을 스캔하는 고밀도 리스트
   - 키보드 단축키 지원 (`J`/`K` 이동, `M` 읽음 토글, `S` 북마크, `R` 새로고침, `ESC` 닫기)
4. **원문 전체 본문 스크래핑 (Reader View)**
   - 요약만 제공하는 RSS 피드도 아티클 뷰어 내 **원문 전체 불러오기** 버튼으로 웹페이지 본문을 추출·정제하여 광고 없이 열람
5. **Cloudflare Workers AI 한국어 핵심 요약**
   - 아티클 뷰어의 **AI 핵심 요약** 버튼 클릭 시 Cloudflare Workers AI(`@cf/meta/llama-3.1-8b-instruct`)를 호출하여 **한줄 요약 + 주요 포인트 3가지 + 키워드**를 생성하고 D1에 캐싱
6. **OPML 2.0 가져오기 / 내보내기**
   - 기존 Feedly, Inoreader 등의 `.opml` 파일을 업로드해 폴더 구조 그대로 일괄 구독하거나, 내 구독 목록을 `.opml`로 백업
   - 60개 제한 없이 전체 목록을 작은 요청으로 나누어 처리하고, 신규·기존 구독·실패 건수와 진행률을 표시
   - 같은 화면에서 일시 중단 후 이어서 가져오기, 실패한 피드만 재시도 지원. 화면을 닫거나 새로고침했다면 같은 파일을 다시 선택해도 기존 구독은 중복 추가되지 않음

---

## 🚀 로컬 실행 방법

Node.js (v22+ / v26 권장)에 내장된 `node:sqlite`를 통해 별도의 설정 없이도 Cloudflare D1과 100% 동일한 스키마(`.local/sfeed.sqlite`)로 즉시 실행됩니다.

```bash
# 1. 패키지 설치
npm install

# 2. 로컬 개발 서버 실행 (프론트엔드 + Hono API + 로컬 D1 SQLite 통합 실행)
npm run dev
```

---

## ☁️ GitHub + Cloudflare 배포 가이드

### 1단계: Cloudflare D1 데이터베이스 생성 및 스키마 적용
```bash
# Cloudflare 로그인
npx wrangler login

# D1 데이터베이스 생성
npx wrangler d1 create sfeed-db
```
출력된 `database_id` 값을 [wrangler.toml](file:///Users/jongyoon/Documents/Projects/Sfeed/wrangler.toml)의 `database_id` 항목에 붙여넣은 뒤, 원격 DB에 테이블을 생성합니다:

```bash
npm run db:migrate:remote
```

### 2단계: Google 로그인 설정
Sfeed는 Google Identity Services(GIS) 버튼으로 ID 토큰을 받아 서버에서 RS256 서명을 검증합니다. 리디렉션 URI와 클라이언트 보안 비밀번호는 필요하지 않습니다.
1. Google Cloud의 [Google 인증 플랫폼](https://console.cloud.google.com/auth/clients)에서 **OAuth 클라이언트 ID (웹 애플리케이션)**를 생성합니다. (현재: SFeed 프로젝트의 `Sfeed Web` 클라이언트)
2. **승인된 JavaScript 원본**에 아래 주소를 추가합니다:
   - 배포: `https://sfeed.jyk.workers.dev`
   - 로컬: `http://localhost:5173`, `http://localhost`
3. 발급된 클라이언트 ID를 `wrangler.toml`의 `GOOGLE_CLIENT_ID`에 넣습니다. 로컬에서는 `.dev.vars`로 덮어쓸 수 있습니다.
4. 외부 사용자가 로그인하려면 **브랜딩**에 홈페이지, 개인정보처리방침 링크(`https://sfeed.jyk.workers.dev/privacy`), 승인된 도메인(`jyk.workers.dev`)을 입력한 뒤 **대상** 페이지에서 앱을 게시합니다.

### 3단계: 배포하기 (GitHub 자동 배포 또는 CLI 배포)
- **CLI 직접 배포:**
  ```bash
  npm run cf:deploy
  ```
- **GitHub 연동 자동 배포 (Workers Builds):**
  1. 이 프로젝트를 GitHub 저장소에 푸시합니다.
  2. Cloudflare 대시보드에서 **Workers & Pages -> sfeed -> Settings -> Builds -> Connect**로 GitHub 저장소를 연결합니다. (워커가 아직 없다면 **Create -> Import a repository**)
  3. Build command: `npm run build` / Deploy command: `npx wrangler deploy`로 설정하면 `main`에 `git push`할 때마다 자동 배포됩니다.
  4. GitHub의 **Cloudflare Workers and Pages** 앱이 "Only select repositories"로 설치되어 있다면 **GitHub Settings -> Applications -> Cloudflare Workers and Pages -> Configure**에서 이 저장소를 추가해야 합니다. 빠져 있으면 Cloudflare에서 저장소 선택은 되지만 푸시 이벤트를 받지 못해 빌드가 시작되지 않습니다.
