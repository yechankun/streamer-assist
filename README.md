# Streamer Assist

윈도우 방송용 타임라인·하이라이트 기록기와 치지직/유튜브 통합 투표 데스크톱 앱. React + Electron으로 구성한 초기 MVP입니다.

## 다운로드

[GitHub Releases](https://github.com/yechankun/streamer-assist/releases)의 `Streamer-Assist-*-x64-Setup.exe`를 설치하세요. 초기 릴리즈는 코드 서명되지 않았습니다.

## 사용 방법

1. **방송 기록 시작**을 누릅니다. 이미 방송 중이라면 시작 전에 경과 초를 입력합니다. 방송 플랫폼과 자동으로 시작 시간을 동기화하지 않습니다.
2. `Ctrl+Shift+F8`로 어떤 창에서든 마커를 추가하거나 화면에 메모를 입력합니다.
3. **플랫폼 연결**에서 공식 API 토큰을 입력하면 채팅 반응을 분석합니다. 창을 닫아도 시스템 트레이에서 계속 작동합니다.
4. **통합 투표**에서 같은 질문과 2~4개 선택지를 생성합니다. 치지직에는 번호 투표 안내 메시지를 게시하고, 유튜브에는 기본 실시간 투표를 생성합니다.
5. 방송 종료 후 타임라인과 자동 감지 근거를 확인하고 Markdown/JSON으로 내보냅니다. 완전 종료는 트레이 메뉴에서 실행합니다.

### 자동 하이라이트

최근 10초간 채팅이 15개 이상, 참여자가 5명 이상이고 앞선 60초 평균보다 2.5배 이상 증가하면 마킹합니다. 웃음·감탄 표현도 근거에 포함하며 45초간 중복 감지를 억제합니다. 반응 예시와 15초 전 클립 시작 후보를 내보냅니다. **로컬 통계 기반 편집 후보이며 영상 이해 AI나 실제 재미 평가가 아닙니다.** 영상/음성 녹화 및 외부 AI 호출은 하지 않습니다.

### 플랫폼 인증과 투표

- **YouTube:** Google Cloud에서 YouTube Data API v3를 활성화하고 `youtube.force-ssl` 권한이 있는 **방송 채널 소유자** OAuth 액세스 토큰을 발급받습니다. `liveBroadcasts.list(part=snippet,broadcastStatus=active)` 응답의 `snippet.liveChatId`를 입력합니다. 앱은 `liveChatMessages.list`의 `pollingIntervalMillis`를 준수합니다. 초기 조회의 오래된 채팅은 자동 감지/번호 투표에서 제외합니다. 기본 투표 생성은 `insert(type=pollEvent)`, 종료는 `transition(status=closed)`를 사용합니다. 채널 소유자 인증에만 제공되는 `tally`를 치지직 득표수와 합산합니다. 미제공 시 미확인으로 표시합니다.
- **치지직:** 개발자 앱 등록 후 ‘채팅 메시지 조회’와 ‘채팅 메시지 쓰기’ 권한의 사용자 액세스 토큰을 발급받습니다. 공식 사용자 세션 API 및 지원되는 Socket.IO 2.0.3으로 CHAT 이벤트를 구독합니다. 공식 API는 인증한 사용자의 채널에 연결합니다. 임의 채널 ID 입력/비공식 채팅 크롤링은 제공하지 않습니다.
- 치지직 시청자는 `1`~`4` 중 번호만 입력합니다. 플랫폼별 계정당 첫 표를 집계합니다. 유튜브 기본 투표 모드에서는 유튜브 번호 채팅을 중복 집계하지 않습니다. ‘양쪽 채팅 번호 투표’ 모드도 제공합니다.
- 양 플랫폼 사이의 동일인 중복 투표를 식별할 수 없습니다. 플랫폼 작업은 원자적으로 실행되지 않으므로 유튜브 투표 생성 성공 후 치지직 안내 실패 시 오류와 수동 안내 방법을 표시합니다.
- [참고한 투표 사이트](https://chzzk-vote.vercel.app/)와 직접 연동하지 않습니다. 별도 공개 API를 전제로 하지 않고 투표 기능을 앱 내에 구현합니다.
- **현재 OAuth 로그인 UI, 토큰 자동 갱신, 자동 재연결은 없습니다.** 토큰은 실행 중 메모리에만 보관하며 디스크/내보내기/로그에 쓰지 않습니다. 토큰 만료 또는 연결 실패 시 설정에서 다시 연결하세요. 실제 플랫폼 동작은 유효한 사용자 토큰과 진행 중인 방송에서 별도 확인해야 합니다.

### 저장 및 백그라운드

Electron `userData`의 `sessions.json`에 진행 중인 방송과 최근 100회 방송을 저장합니다. 보통 `%APPDATA%/streamer-assist`입니다. 마커·반응 예시·투표 결과·투표 중복 방지용 플랫폼 계정 식별자가 포함됩니다. 전체 채팅 로그는 저장하지 않으며 분석 버퍼는 70초/최대 10,000개입니다. 저장 파일을 임시 파일에 쓴 뒤 교체하고 재실행 시 기록을 복원합니다. 트레이 모드에서는 React 창을 숨기며 기록/수집은 Electron main 프로세스에서 계속됩니다. 설정에서 Windows 로그인 시 숨김 실행을 켤 수 있습니다.

## 개발

Node.js 22 이상 / Windows 10 이상.

### 설치 없이 함께 개발하기

프로젝트 폴더에서 `npm run dev`를 실행하면 Vite 개발 서버와 Electron 창이 함께 열립니다. 처음 받은 소스라면 `npm ci`를 한 번 실행하세요. Windows에서는 `./dev.ps1`로 의존성 준비와 실행을 함께 할 수도 있습니다. 앱 설치나 배포 빌드는 필요 없습니다.

- `src/`의 React·CSS 저장 → 실행 중인 화면에 즉시 반영됩니다. React Fast Refresh가 가능한 수정은 화면 상태도 유지합니다.
- `electron/`의 main·preload·기록 엔진·플랫폼 코드 저장 → 기록을 저장하고 Electron을 자동 재시작합니다. 재시작하면 채팅 토큰은 다시 입력해야 합니다.
- `F12` → 개발자 도구 열기/닫기. 처음부터 열려면 `npm run dev:tools`를 실행합니다.
- 개발 모드의 마커 단축키는 `Ctrl+Alt+F8`입니다. 설치 버전의 `Ctrl+Shift+F8`과 겹치지 않습니다.
- 터미널의 `Ctrl+C`, `npm run dev:stop` 또는 트레이의 ‘완전히 종료’ → 앱과 개발 서버를 함께 종료합니다. 창의 X는 기존처럼 트레이로 숨깁니다.
- 개발 기록은 프로젝트의 `.dev/profile/`에 저장합니다. `.dev/`는 Git에서 제외됩니다. 개발 모드에서는 Windows 자동 시작 설정을 변경하지 않습니다.
- 개발 서버는 이 PC의 `http://127.0.0.1:5173`에서만 실행됩니다. 이미 같은 포트를 사용하는 프로세스가 있으면 종료 후 다시 실행하세요.

`npm run dev`를 켜 둔 상태에서 소스를 수정하며 계속 함께 개발할 수 있습니다.

```powershell
npm ci
npm run dev
npm test
npm run test:desktop
npm run dist
```

`npm run build`는 TypeScript 검사 및 프런트엔드 빌드, `npm run dist`는 Windows x64 NSIS 설치 프로그램 생성입니다. 출력은 `release/`에 있습니다. Electron 런타임을 포함하므로 설치 크기는 일반 네이티브 유틸리티보다 큽니다. 외부 DB/백엔드/AI 런타임은 없습니다.

## CI / 릴리즈

- `main` push 및 PR: Windows에서 테스트 → TypeScript/Vite 빌드 → NSIS 패키징 → 설치 파일 artifact 보관.
- `package.json`의 버전과 일치하는 `v*` 태그 push: 동일 검증 후 GitHub Release에 설치 프로그램 및 SHA256 체크섬 자동 등록.
- 예: 버전을 `0.1.1`로 올리고 잠금 파일을 갱신해 커밋한 뒤 `git tag v0.1.1`, `git push origin main --tags`.
- 자동 업데이트는 포함하지 않습니다. 새 설치 파일을 Releases에서 다운로드합니다.

## 구조

- `electron/engine.cjs`: 타임라인·반응 감지·투표 집계·내보내기
- `electron/platforms.cjs`: 공식 API 및 채팅 수집
- `electron/main.cjs`: 트레이·전역 단축키·로컬 저장·검증된 IPC
- `electron/preload.cjs`: 제한된 renderer 브리지
- `src/`: React 한국어 UI
- `tests/`: 시간 오프셋, 스팸 억제, 투표 중복 방지, 복원 검증
- `vendor/parseuri/`: 구형 Socket.IO가 요구하는 URI 필드를 Node의 표준 URL 파서로 제공하는 어댑터. 취약한 정규식 파서를 교체하며 프로토콜/인증 query 보존을 테스트합니다. 나머지 소켓 하위 의존성도 호환 패치 버전으로 고정했습니다. 빌드 도구의 `http-cache-semantics` 관련 미해결 advisory는 런타임 의존성에 포함되지 않습니다.

## 공식 문서

- [치지직 세션](https://chzzk.gitbook.io/chzzk/chzzk-api/session)
- [치지직 인증](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization)
- [YouTube 투표 생성](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert)
- [YouTube 투표 종료](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/transition)
- [YouTube 득표수](https://developers.google.com/youtube/v3/live/docs/liveChatMessages)

MIT License.
