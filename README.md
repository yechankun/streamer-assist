# Streamer Assist

윈도우 방송용 타임라인·하이라이트 기록기와 치지직/유튜브 통합 투표 데스크톱 앱. React + Electron으로 구성한 초기 MVP입니다. 별도 백엔드 서버나 서버 호스팅 없이 사용자 PC에서 플랫폼에 직접 연결합니다.

## 다운로드

[GitHub Releases](https://github.com/yechankun/streamer-assist/releases)의 `Streamer-Assist-*-x64-Setup.exe`를 설치하세요. 초기 릴리즈는 코드 서명되지 않았습니다.

현재 새 디자인, 채널 주소 연결과 브라우저 로그인 개선은 main 개발 버전에 적용되어 있습니다. v0.1.0 설치 파일에는 이 개선이 포함되지 않으므로 아래 개발 모드로 확인하세요.

## 사용 방법

1. **방송 기록 시작**을 누릅니다. 이미 방송 중이라면 시작 전에 경과 초를 입력합니다. 방송 플랫폼과 자동으로 시작 시간을 동기화하지 않습니다.
2. 기본 `Ctrl+Shift+F8`로 어떤 창에서든 마커를 추가하거나 화면에 메모를 입력합니다. **설정 → 일반 → 타임라인 기록 단축키**에서 버튼을 누른 뒤 원하는 키 조합을 직접 눌러 변경할 수 있습니다.
3. **설정 → 플랫폼 연결**에서 치지직 채널 주소를 넣고 연결하거나 YouTube에 로그인합니다. 토큰·쿠키·채팅 ID를 직접 입력하지 않습니다. **설정 → 일반**에서 시스템 트레이 사용과 Windows 자동 시작을 관리합니다. 트레이를 켜면 창을 닫아도 계속 기록하고, 끄면 창을 닫을 때 기록을 저장하고 앱을 종료합니다.
4. **통합 투표**에서 같은 질문과 2~4개 선택지를 생성합니다. 새 선택지를 입력하고 **추가** 버튼이나 Enter를 누르면 목록에 추가되며, 입력칸이 비워지고 다음 선택지를 바로 입력할 수 있습니다. 목록의 선택지는 수정·삭제할 수 있습니다. 한글 조합 중 Enter는 선택지를 추가하지 않습니다. **투표 플랫폼**에서 연결된 치지직·YouTube 버튼을 눌러 각각 켜거나 끕니다. 연결하지 않은 플랫폼은 버튼이 나타나지 않습니다. **투표 방식**에서 채팅 명령과 YouTube 참여 방식을 선택합니다. 기본은 치지직·YouTube 채팅에 !투표1, !투표2처럼 입력하는 방식입니다. 번호만 입력하거나 접두어를 바꿀 수도 있고, YouTube는 기본 실시간 투표로 전환할 수 있습니다. **투표 안내 복사**로 현재 규칙을 채팅에 안내합니다. 켠 플랫폼만 게시·집계합니다.
5. 방송 종료 후 타임라인과 자동 감지 근거를 확인하고 Markdown/JSON으로 내보냅니다. 완전 종료는 트레이 메뉴에서 실행합니다.

### 화면 테마

상단 탭에서 타임라인·통합 투표·설정을 전환합니다. 설정의 일반 탭에는 기록 단축키·트레이·자동 시작·테마·테스트 채팅이 있고, 플랫폼 연결 탭에는 치지직과 YouTube가 있습니다. 치지직은 민트, YouTube는 레드로 구분하며 오른쪽 테마 버튼으로 다크/라이트 모드를 바꿀 수 있습니다. 선택한 테마는 다음 실행에도 유지됩니다. Windows 기본 제목 표시줄 없이 앱 상단을 드래그해 창을 이동하고, 오른쪽 버튼으로 최소화·최대화·복원하거나 트레이로 닫을 수 있습니다. 전체 화면에는 스크롤이 생기지 않으며 긴 기록·결과·선택지 목록은 각 패널 안에서만 스크롤되며 추가 입력칸과 조작 버튼은 고정됩니다. 최소 창 크기 900×650에서도 입력칸과 조작 버튼이 보이도록 배치합니다. SVG 아이콘과 시스템 글꼴을 사용해 추가 런타임 의존성이나 외부 이미지·글꼴 요청 없이 동작합니다.

### 자동 하이라이트

최근 10초간 채팅이 15개 이상, 참여자가 5명 이상이고 앞선 60초 평균보다 2.5배 이상 증가하면 마킹합니다. 웃음·감탄 표현도 근거에 포함하며 45초간 중복 감지를 억제합니다. 반응 예시와 15초 전 클립 시작 후보를 내보냅니다. **로컬 통계 기반 편집 후보이며 영상 이해 AI나 실제 재미 평가가 아닙니다.** 영상/음성 녹화 및 외부 AI 호출은 하지 않습니다.

### 플랫폼 연결과 투표

- **치지직:** 채널/라이브 주소 또는 채널 ID를 입력하면 공개 채팅을 로그인 없이 수신합니다. 익명 읽기 권한은 자동으로 받아 메모리에서만 사용합니다. 채널 선택은 로컬에 저장하고, 방송 대기·채팅 채널 변경·연결 끊김을 30초 주기로 확인합니다. 로그인이 필요한 방송은 지원하지 않습니다. 채팅 전송은 제공하지 않으며 투표 질문과 선택지를 복사해 직접 안내합니다.
- 치지직 연결은 비공식 공개 채팅 프로토콜을 사용합니다. 플랫폼 변경 시 동작이 중단될 수 있습니다. [참고 투표 사이트 소스](https://github.com/WisdomIT/chzzk-vote)가 사용하는 [chzzk 라이브러리](https://github.com/kimcore/chzzk)의 공개 읽기 방식과 프로토콜을 참고했습니다. 참고 사이트와 직접 연동하지 않습니다.
- **YouTube:** 기본 브라우저에서 방송 채널 소유자로 로그인합니다. Desktop OAuth + PKCE를 사용하며 필요한 권한은 `youtube.force-ssl`입니다. 로그인 때만 PC의 `127.0.0.1`에 임시 콜백 포트를 열고 결과를 받으면 닫습니다. 서버를 배포하거나 운영할 필요가 없습니다.
- YouTube의 진행 중인 방송 채팅 ID를 자동 조회합니다. 아직 방송이 없으면 ‘방송 대기’로 표시합니다. 기록 시작 시 다시 찾거나 ‘방송 채팅 다시 찾기’를 누를 수 있습니다. 채팅 수집은 API가 지정한 `pollingIntervalMillis`를 준수합니다. 기본 투표 생성·종료 및 소유자에게 제공되는 득표수 합산을 지원합니다.
- 투표 플랫폼 버튼은 설정에서 계정/채널을 연결한 플랫폼만 표시합니다. 방송 채팅이 준비된 선택 플랫폼에서만 시작할 수 있습니다. 플랫폼을 모두 끄면 시작 버튼이 비활성화됩니다. 진행 중에는 플랫폼 선택이 고정되며, 선택은 투표 결과와 함께 저장됩니다. 테스트 채팅을 켜면 실제 플랫폼 대신 테스트 표만 집계합니다.
- 채팅 명령의 기본값과 재투표 규칙은 [참고 사이트 숫자 투표](https://github.com/WisdomIT/chzzk-vote/blob/master/lib/vote.ts)와 [집계 방식](https://github.com/WisdomIT/chzzk-vote/blob/master/app/%28main%29/vote/_views/Running.tsx)을 확인해 적용했습니다. 메시지 맨 앞에 !투표1 또는 !투표 1을 입력하며 뒤에 일반 채팅을 이어 쓸 수 있습니다. 플랫폼별 계정당 한 표를 유지하고 다시 입력하면 이전 선택에서 마지막 선택으로 표를 옮깁니다. 접두어는 12자 이하로 직접 바꿀 수 있고, 비우면 번호만 정확히 입력하는 방식입니다. YouTube 기본 투표를 선택하면 YouTube 채팅 명령은 중복 집계하지 않습니다. 입력 규칙과 플랫폼 선택은 투표 시작 때 고정하고 결과와 함께 저장하며 다음 투표에 사용할 설정도 유지합니다. 끈 플랫폼의 표는 제외합니다. 기존 저장 투표는 원래 번호·첫 표 규칙으로 복원합니다. 플랫폼 사이의 동일인 중복 투표는 식별할 수 없습니다.
- 오래된 채팅 조회·숨김 치지직 메시지는 감지/투표에서 제외합니다. 전체 채팅 로그를 파일에 저장하지 않습니다.
- YouTube 사용자 토큰은 Electron `safeStorage`의 Windows DPAPI로 `accounts.enc`에 암호화 저장합니다. 토큰을 React 화면·로그·방송 내보내기에 전달하지 않습니다. 만료 전 자동 갱신과 401 응답 시 한 번 갱신 후 재시도를 지원하며, 동시 갱신 요청은 하나로 묶습니다. 계정 연결 해제는 이 PC에 저장한 계정만 삭제합니다. 플랫폼 권한 철회는 Google의 연결된 앱 설정에서 할 수 있습니다.
- 치지직 공개 방송에서 로그인 없이 실시간 수신을 확인했습니다. YouTube 인증·방송 탐색·갱신·기본 투표 API는 모의 응답과 데스크톱에서 검증했습니다. 실제 Google 등록 앱/방송의 로그인·투표 검증은 아직 수행하지 않았습니다.

### YouTube 로그인 준비 (개발자 1회 설정)

치지직은 개발자 앱 등록 없이 채널 주소만으로 연결할 수 있습니다. YouTube Desktop 로그인에는 앱의 **Client ID와 Client Secret**이 필요합니다. 실제 등록 클라이언트에 secret을 생략하면 Google 토큰 교환이 거절되는 것을 확인했습니다. 이 설정은 사용자나 개발자 계정의 access/refresh token과 다르며, 계정 권한은 각 사용자의 브라우저 동의로 부여됩니다.

1. Google Cloud 프로젝트에서 YouTube Data API v3를 활성화합니다. OAuth 동의 화면과 **Desktop app** 클라이언트를 생성합니다. 테스트 단계에서는 사용할 계정을 테스트 사용자로 등록합니다. 공개 배포 시 필요한 동의 화면 검증을 진행합니다.
2. `.env.example`을 `.env.local`로 복사해 `STREAMER_ASSIST_GOOGLE_CLIENT_ID`와 `STREAMER_ASSIST_GOOGLE_CLIENT_SECRET`를 설정합니다. 이 로컬 파일은 Git 및 설치 파일에 포함되지 않습니다. 사용자 토큰 입력이나 인증 서버 설정은 없습니다.
3. 개발 모드에서는 로컬 설정 파일을 저장하면 자동으로 읽어 로그인 버튼을 활성화합니다. 별도 서버나 앱 재설치는 필요하지 않습니다. 공개 Client ID는 `electron/oauth-config.json`에서도 지정할 수 있습니다.

Google Desktop 앱의 client secret은 배포된 앱에서 기밀성을 보장할 수 없습니다. Google도 설치형 앱을 비밀값을 안전하게 숨길 수 없는 클라이언트로 취급합니다. 사용자 access/refresh token은 이와 별개이며 각 PC에서 암호화 보관합니다. 현재 secret 설정은 개발 PC용입니다. 릴리즈에서 공유 OAuth 설정을 제공하는 구성은 별도로 준비해야 합니다.

실제 Google 계정 로그인과 방송 투표는 설정 완료 후 추가 확인해야 합니다. 일반 사용자에게 개발자 앱 등록이나 시크릿 입력을 요구하는 화면은 제공하지 않습니다.

### 저장 및 백그라운드

Electron `userData`의 `sessions.json`에 진행 중인 방송과 최근 100회 방송을 저장합니다. 보통 `%APPDATA%/streamer-assist`입니다. 마커·반응 예시·투표 결과·투표 중복 방지용 플랫폼 계정 식별자가 포함됩니다. 전체 채팅 로그는 저장하지 않으며 분석 버퍼는 70초/최대 10,000개입니다. 저장 파일을 임시 파일에 쓴 뒤 교체하고 재실행 시 기록을 복원합니다. 트레이 모드에서는 React 창을 숨기며 기록/수집은 Electron main 프로세스에서 계속됩니다. 기록 단축키와 트레이 여부는 같은 프로필의 preferences.json에 저장됩니다. 단축키는 Ctrl/Alt/Shift/Win 조합 또는 F1~F24로 지정하며, 다른 앱과 충돌하거나 저장이 실패하면 기존 설정을 유지합니다. 키 인식 중에는 기존 기록 키를 잠시 해제하고, Esc·포커스 이동·화면 전환·재로드·30초 대기 시 복원합니다. 설정에서 Windows 로그인 시 자동 시작을 켤 수 있습니다. 트레이를 끈 상태로 자동 시작하면 창이 보이도록 실행합니다.

## 개발

Node.js 22 이상 / Windows 10 이상.

### 설치 없이 함께 개발하기

프로젝트 폴더에서 `npm run dev`를 실행하면 Vite 개발 서버와 Electron 창이 함께 열립니다. 처음 받은 소스라면 `npm ci`를 한 번 실행하세요. Windows에서는 `./dev.ps1`로 의존성 준비와 실행을 함께 할 수도 있습니다. 앱 설치나 배포 빌드는 필요 없습니다.

- `src/`의 React·CSS 저장 → 실행 중인 화면에 즉시 반영됩니다. React Fast Refresh가 가능한 수정은 화면 상태도 유지합니다.
- `electron/`의 main·preload·기록 엔진·플랫폼 코드 저장 → 기록을 저장하고 Electron을 자동 재시작합니다. 저장한 치지직 채널과 YouTube 계정으로 재연결합니다.
- `F12` → 개발자 도구 열기/닫기. 처음부터 열려면 `npm run dev:tools`를 실행합니다.
- 개발 모드의 기본 마커 단축키는 `Ctrl+Alt+F8`입니다. 설정에서 변경한 키는 개발 프로필에 저장됩니다. 설치 버전의 `Ctrl+Shift+F8`과 겹치지 않습니다.
- 터미널의 `Ctrl+C`, `npm run dev:stop` 또는 트레이의 ‘완전히 종료’ → 앱과 개발 서버를 함께 종료합니다. 창의 X는 시스템 트레이 설정에 따라 숨기거나 앱을 종료합니다.
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

`npm run build`는 TypeScript 검사 및 프런트엔드 빌드, `npm run dist`는 Windows x64 NSIS 설치 프로그램 생성입니다. 출력은 `release/`에 있습니다. Electron 런타임을 포함하므로 설치 크기는 일반 네이티브 유틸리티보다 큽니다. 외부 DB/AI 런타임과 운영할 백엔드 서버는 없습니다.

## CI / 릴리즈

- `main` push 및 PR: Windows에서 테스트 → TypeScript/Vite 빌드 → NSIS 패키징 → 설치 파일 artifact 보관.
- `package.json`의 버전과 일치하는 `v*` 태그 push: 동일 검증 후 GitHub Release에 설치 프로그램 및 SHA256 체크섬 자동 등록.
- 예: 버전을 `0.1.1`로 올리고 잠금 파일을 갱신해 커밋한 뒤 `git tag v0.1.1`, `git push origin main --tags`.
- 자동 업데이트는 포함하지 않습니다. 새 설치 파일을 Releases에서 다운로드합니다.

## 구조

- `electron/engine.cjs`: 타임라인·반응 감지·투표 집계·내보내기
- `electron/vote-input.cjs`: 채팅 명령 형식 검증·번호 파싱
- `electron/platforms.cjs`: YouTube 공식 API 및 플랫폼별 채팅 수집
- `electron/chzzk.cjs`: 치지직 공개 채팅 탐색·읽기 전용 WebSocket·재연결
- `electron/oauth.cjs`: 브라우저 로그인·PKCE·콜백·암호화 계정 저장·자동 갱신
- `electron/main.cjs`: 트레이·전역 단축키·로컬 저장·검증된 IPC
- `electron/preferences.cjs`: 설정 저장·단축키 검증·등록 충돌과 저장 실패 복원
- `electron/preload.cjs`: 제한된 renderer 브리지
- `src/`: React 한국어 UI
- `tests/`: 시간 오프셋, 스팸 억제, 투표 중복 방지, 복원 검증
- 치지직 공식 인증용 구형 Socket.IO 의존성은 제거했습니다. 런타임 의존성 감사에서 발견된 취약점은 0개입니다. 빌드 도구의 `http-cache-semantics` 관련 미해결 advisory는 런타임 의존성에 포함되지 않습니다.

## 공식 문서

- [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Electron 전역 단축키](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [YouTube 투표 생성](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert)
- [YouTube 투표 종료](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/transition)
- [YouTube 득표수](https://developers.google.com/youtube/v3/live/docs/liveChatMessages)

MIT License.
