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
   - RSS가 없는 사이트는 **RSS 빌더로 만들기**에서 글 목록을 미리보고 선택해 구독합니다. 생성된 RSS 주소는 OPML로 내보낼 수 있고, 수동 새로고침과 15분 주기 갱신으로 새 글을 수집합니다.
   - 동적 페이지에는 Cloudflare Browser Rendering 바인딩(`BROWSER`)을 사용합니다. 로그인·보안 확인이 필요한 페이지는 수집하지 못할 수 있습니다. 발행일이 없는 글에는 임의의 발행일을 표시하지 않습니다.
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
   - 실패 항목의 주소·폴더·오류·시도 횟수를 계정별 D1에 저장하며, 다시 로그인해도 확인 가능. 주소 수정·연결 확인·재시도를 지원하고 성공한 항목은 실패 목록에서 제거
   - 확인된 대체 피드는 직접 선택해 적용하며, 발행 범위가 다른 뉴스레터로 자동 변경하지 않음
7. **Feedly 과거 기록 가져오기 (1회성 스크립트)**
   - RSS는 최신 글 일부만 담으므로, Feedly 공개 스트림에서 구독 피드의 전체 기록(제목·요약·링크·썸네일·날짜)을 받아 저장합니다. 기존 글과는 원래 글 ID로 맞춰 중복 없이 합칩니다.
   - `npm run import:feedly -- download --db remote --user <userId>` 로 `.local/feedly-import/`에 내려받고(이어받기 지원), `npm run import:feedly -- write --db remote --user <userId>` 로 D1에 기록합니다.
   - `npm run import:feedly:sync -- --db remote --user <userId>` 는 다운로드와 10분 간격 D1 반영을 함께 실행합니다. 다운로드 중이거나 요청 제한으로 대기 중이어도 이미 받은 글을 반영하며, 다운로드 진행과 DB 반영 위치는 별도 파일에 저장합니다.
   - 요청 간격은 최소 5초이며, 429 응답의 `Retry-After`·`X-Ratelimit-Reset`을 따릅니다. 반복 제한 시 15분부터 최대 6시간까지 대기를 늘리고(서버가 더 긴 시간을 요구하면 해당 시간을 적용), 재시작해도 대기 시각을 유지합니다.
   - 정상 요청은 **5초 간격**으로 받고, 기본 실행에는 자체 일일 한도를 두지 않습니다. Feedly가 실제로 한도 도달 또는 429를 알리면 해당 대기 시간을 지킵니다. 필요하면 `--requests-per-day <횟수>`로 최근 24시간 자체 예산을 설정할 수 있고, `0`은 자체 한도 해제입니다. 실패·재시도도 요청 이력에 포함하고 서버의 한도·초기화 헤더를 저장합니다.
   - 미완료 피드들은 한 페이지씩 번갈아 받으므로 큰 피드 때문에 다른 피드가 계속 대기하지 않습니다. 이미 서버에 반영한 분량뿐이라면 불필요한 DB 조회도 생략합니다.
   - Feedly처럼 30일이 지난 글은 따로 표시하지 않아도 읽은 글로 취급하며, 안읽음 수·안읽음 필터·모두 읽음은 최근 30일 글만 대상으로 합니다.
8. **기기 캐시와 빠른 재실행**
   - 서버에서 로그인 계정을 확인한 뒤, 최근 폴더·숫자·글 목록을 계정별 IndexedDB에서 먼저 표시하고 서버 응답으로 갱신합니다. 캐시는 최대 12개 화면 데이터·8MB·24시간으로 제한하며, 로그아웃 후에도 기기에 보관하고 같은 계정으로 다시 로그인하면 재사용합니다. 다른 계정의 캐시는 표시하지 않습니다. 저장소를 사용할 수 없으면 메모리와 일반 네트워크 로딩으로 동작합니다.
   - 읽음·저장은 즉시 숫자에 반영하고, 전체 라이브러리 재조회는 10초 단위로 합칩니다. 검색 입력은 200ms 대기 후 조회하며 이전 화면·이전 계정의 늦은 응답은 적용하지 않습니다.
   - 내용 해시가 포함된 JS/CSS는 브라우저에서 장기 캐시합니다. HTML·서비스 워커·manifest는 계속 최신 버전을 확인하고, 서비스 워커는 로그인/API 응답을 저장하지 않습니다.

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
