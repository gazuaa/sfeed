# Sfeed — Cloudflare Edge & Workers AI 기반 멀티유저 RSS 서비스

**Sfeed**는 Feedly에서 영감을 받아 제작된 모던 멀티유저 RSS 큐레이션 플랫폼입니다. **React (Vite) + Hono + Cloudflare D1 (SQLite) + Cloudflare Workers AI** 스택으로 구축되어 GitHub과 Cloudflare만으로도 서버 비용 걱정 없이 배포할 수 있습니다.

---

## ✨ 주요 기능

1. **Google 로그인 & 멀티유저 격리 (Cloudflare D1)**
   - Google OAuth 2.0 인증 지원 (`GOOGLE_CLIENT_ID` 연동 시 정식 리다이렉트 동작)
   - 이메일만으로 로그인하는 빠른 계정 전환은 **로컬 개발 환경에서만** 동작합니다 (`npm run dev`에서는 기본 활성화, `wrangler dev`에서는 `.dev.vars`에 `ALLOW_QUICK_LOGIN="true"` 설정). 배포 환경에서는 API가 403을 반환하고 UI도 숨겨집니다.
   - 사용자별 폴더, 피드 구독, 읽음/안읽음 상태, 북마크(Read Later), 테마·레이아웃 설정이 D1에 독립 저장
2. **카테고리(폴더) 관리 & 추천 피드 카탈로그**
   - 신규 가입 시 `국내 테크`, `Global Tech & AI`, `디자인 & 프로덕트` 폴더와 대표 피드 자동 세팅
   - 긱뉴스(GeekNews), 토스 테크, 우아한형제들, 카카오테크, Cloudflare Blog, Hacker News, OpenAI News 등 엄선된 카탈로그 원클릭 구독
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

### 2단계: Google OAuth 2.0 설정 (선택사항)
1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 **OAuth 2.0 클라이언트 ID (웹 애플리케이션)**를 생성합니다.
2. **승인된 리디렉션 URI**에 아래 주소를 추가합니다:
   - 로컬: `http://localhost:5173/api/auth/google/callback`
   - 배포: `https://<내-도메인-또는-workers.dev>/api/auth/google/callback`
3. 로컬에서는 `.dev.vars` 파일에, Cloudflare에서는 **Workers & Pages -> sfeed -> Settings -> Variables and Secrets**에 아래 변수를 등록합니다:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

### 3단계: 배포하기 (GitHub 자동 배포 또는 CLI 배포)
- **CLI 직접 배포:**
  ```bash
  npm run cf:deploy
  ```
- **GitHub 연동 자동 배포:**
  1. 이 프로젝트를 GitHub 저장소에 푸시합니다.
  2. Cloudflare 대시보드에서 **Workers & Pages -> Create -> Import a repository**를 선택해 GitHub 저장소를 연결합니다.
  3. Build command: `npm run build` / Deploy command: `npx wrangler deploy`로 설정하면 `git push`마다 자동 배포됩니다.
