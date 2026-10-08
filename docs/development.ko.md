# 개발 가이드

[English](development.md) · **한국어** · [README로 돌아가기](../README.ko.md)

이 문서는 소스에서 앱을 실행하거나 수정할 때 사용하는 안내입니다. 먼저 실행 방법을 확인하고, 필요한 경우에만 테스트·구조·배포를 읽으세요.

[실행](#설치-없이-실행하기) · [테스트·빌드](#빌드테스트-명령) · [구조](#구조)

## 설치 없이 실행하기

Windows 10/11 x64와 Node.js 22 이상을 사용합니다.

```powershell
npm ci
npm run dev
```

Windows의 `./dev.ps1`도 의존성을 준비하고 개발 앱을 실행합니다.

| 수정·작업                                      | 동작                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `src/`의 React·CSS 저장                        | Vite가 열린 창에 즉시 반영하며 가능한 수정은 React 상태를 유지합니다. |
| `electron/` 코드 저장                          | 기록을 저장하고 앱을 재시작하며 저장된 채널·계정으로 재연결합니다.    |
| F12 / `npm run dev:tools`                      | 개발자 도구 토글 / 시작부터 열기.                                     |
| Ctrl+C / `npm run dev:stop` / 트레이 완전 종료 | Electron과 개발 서버를 함께 종료합니다.                               |

서버는 `http://127.0.0.1:5173`에서 실행합니다. 개발 프로필은 `.dev/profile/`이며 Git에서 제외하고 설치 앱 데이터와 분리합니다. 개발 모드는 Windows 자동 시작을 변경하지 않습니다. 기본 기록 키는 `Ctrl+Alt+F8`이고 저장한 사용자 지정 키가 우선합니다. 설치 버전 기본값은 `Ctrl+Shift+F8`입니다.

창 닫기는 트레이 설정에 따라 종료 대신 숨김으로 동작할 수 있습니다.

## YouTube OAuth

**앱 개발자 측에서 한 번 준비하는 설정**입니다. 사용자가 토큰을 입력하는 흐름은 없습니다. 치지직 공개 채팅에는 채널 주소만 필요합니다.

1. Google Cloud 프로젝트에서 YouTube Data API v3를 켜고 OAuth 동의 화면을 준비합니다.
2. **Desktop app** OAuth 클라이언트를 생성합니다. 테스트 상태에서는 사용할 계정을 테스트 사용자로 추가합니다.
3. `.env.example`을 `.env.local`로 복사하고 `STREAMER_ASSIST_GOOGLE_CLIENT_ID`와 `STREAMER_ASSIST_GOOGLE_CLIENT_SECRET`를 설정합니다.
4. 저장하면 개발 모드가 로컬 설정을 읽고 브라우저 로그인을 활성화합니다.

공개 배포 전에 필요한 동의 화면 게시·검증을 준비합니다. 앱은 `youtube.force-ssl` 권한, PKCE와 이 PC의 임시 콜백을 사용합니다. 운영할 인증 백엔드 서버는 필요하지 않습니다.

설치 앱에 포함한 Desktop client secret은 **기밀성을 보장할 수 없습니다**. 사용자 access/refresh token과 별개의 앱 설정입니다. 사용자는 브라우저에서 본인 계정에 권한을 주고, 사용자 토큰은 로컬 프로필에 암호화 저장하며 화면·내보내기에 전달하지 않습니다.

패키징할 때는 `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` 환경 변수로 앱 설정을 제공합니다. 패키저가 별도 OAuth 리소스를 만들며 `.env.local`이나 개인 프로필을 복사하지 않습니다.

릴리즈 워크플로는 Actions Variables/Secrets에서 앱 설정을 받습니다. 일반 push/PR CI에는 앱 시크릿을 제공하지 않으므로 프리뷰 artifact는 YouTube 로그인을 지원하지 않을 수 있습니다. 배포 설정은 [Store 가이드](store-setup.md)를 참고하세요. 실제 계정 로그인·방송 참여는 별도 실환경 검증이 필요합니다.

## 트위치 OAuth

[Twitch 개발자 콘솔](https://dev.twitch.tv/console/apps)에 이 앱 전용 애플리케이션을 등록하고 **Client Type: Public**을 선택합니다. 개발자 계정의 이메일 인증과 2단계 인증이 필요합니다. 등록 화면에서 Redirect URL을 요구하면 `http://localhost`를 등록합니다. 이 앱의 Device Code 인증에는 콜백 서버가 필요하지 않습니다.

개발 시 `.env.local`에 `STREAMER_ASSIST_TWITCH_CLIENT_ID`를 설정합니다. 패키징은 `TWITCH_CLIENT_ID` 환경 변수·릴리즈 워크플로의 같은 이름 Actions Variable 또는 `electron/oauth-config.json`의 `twitchClientId`를 사용합니다. Client ID는 공개 앱 설정이며 Client Secret이나 사용자 토큰 수동 입력은 필요하지 않습니다. 설정 전에는 로그인 버튼이 비활성화됩니다.

기본 브라우저에서 Twitch 기기 활성화 페이지를 열고 설정 화면에 승인 코드를 표시합니다. 권한은 `user:read:chat`만 요청합니다. 앱·계정·권한을 검증한 뒤 기존 암호화 저장소에 토큰을 저장합니다. Public 앱의 갱신 토큰은 한 번 사용하면 교체되므로 후속 검증 전에 새 토큰을 저장합니다. 앱 시작 시 토큰을 확인하고 채팅 수집 중에는 최소 50분마다 다시 검증합니다.

EventSub WebSocket으로 로그인한 계정의 본인 채널에 연결합니다. Shared Chat에서 다른 채널에 작성된 메시지는 제외합니다. 방송 상태는 Get Streams와 `stream.online`·`stream.offline` 구독으로 확인하며 헤더에는 방송 중인 플랫폼 아이콘만 표시합니다. 채팅 하이라이트·구독자 및 Founder 추첨·숫자 투표와 YouTube 기본 투표의 혼합 집계를 지원합니다. 트위치 기본 투표와 Bits 도네 투표는 아직 지원하지 않습니다. 실제 OAuth와 방송 수신은 등록된 앱과 방송 계정으로 별도 검증해야 합니다.

참고: [Device Code 인증](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow), [EventSub WebSocket](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).

## 빌드·테스트 명령

| 명령 | 동작 |
| --- | --- |
| `npm run dev` / `npm run dev:tools` | 변경이 반영되는 개발 창 / 개발자 도구. |
| `npm run build` | 검증된 결과 재사용 또는 증분 타입 검사·Vite 병렬 실행. |
| `node scripts/build.cjs --force` | 화면 번들 강제 재생성. |
| `npm test` | 핵심 로직·빌드 캐시 안전성 전체 검사. |
| `npm run test:desktop` | 검증된 빌드와 탭 배치 재시작·공통 수집·실제 트레이 단축키를 포함한 격리 Electron 전체 15종. |
| `node scripts/test-desktop.cjs --build --suite timeline` | 빌드 후 타임라인만 검사. |
| `node scripts/test-desktop.cjs --build --suite workspace` | 실제 포인터 분리·복귀·순서 이동, 제거·재로드와 창 해제, 두 번째 앱 실행에서 저장 배치 복원 검사. |
| `node scripts/test-desktop.cjs --build --suite collection` | 여러 실제 타임라인 탭·창의 기록·채팅·시청자 수·마커 공유와 플랫폼별 단일 수집, 탭 생성 시 연결 증가 방지와 동시 시작·종료 검사. |
| `node scripts/test-desktop.cjs --build --suite idle` | 숨김·최소화 상태에서 채팅 2,001건·후원 10건, 중복 제외·저장 순서·실제 Windows 마커 단축키·투표 마감·복귀 상태 검사. 네트워크 전송만 테스트 대체물 사용. |
| `node scripts/test-desktop.cjs --build --suite appearance` | 95~150% 슬라이드바 글자 크기, 최소 창의 고정 현황·내부 스크롤, 창 간 동기화와 실제 재시작 복원 검사. |
| `node scripts/test-desktop.cjs --build --suite design` | 긴 AI 이름·로그인 문구·인증 코드, 키보드 스크롤과 두 테마의 글자 대비 검사. |
| `node scripts/test-desktop.cjs --build --suite ai,ai-component,design --hidden` | 창을 숨긴 AI 로그인·기능별 설정·모듈 관리·디자인 검사. |
| `node scripts/test-desktop.cjs --build --suite presentation,audience` | 현황·참여 기능만 검사. |
| `node scripts/test-desktop.cjs --build --screenshots` | 전체 검사와 성공 화면 PNG 저장. |
| `npm run dist:all` | 같은 페이로드에서 Windows x64 EXE·Store MSIX 생성. |
| `npm run dist` / `npm run dist:msix` | 한 가지 형식만 생성. |
| `npm run verify:msix` | Manifest·코드·자산·언어·개인 파일 제외 검사. |
| `npm run docs` / `npm run docs:check` | 한·영 개인정보 페이지 생성 / 로컬 문서 링크 검증. |
| `npm run docs:screenshots` | 생성 기록 데이터로 1280 × 800 실제 창 캡처. |
| `npm run docs:screenshots:store` | 1600 × 900 Store용 캡처. |
| `npm run benchmark:timeline` | 임시 합성 기록의 용량·조회 성능 측정. |
| `npm run benchmark:idle` | 빈 임시 프로필의 실제 번들 CPU·메모리·IPC 측정. AI 화면 전후의 표시·최소화·트레이 상태 비교. |

선택 가능한 검사는 `icon,desktop,timeline,presentation,audience,twitch,privacy,lifecycle,ai,ai-component,design,workspace,collection,appearance,idle`입니다. `--build`가 없으면 기존 `dist/`를 사용합니다. `--hidden`은 테스트 창을 숨기고 숨긴 창에서도 레이아웃 검사를 계속합니다. CI는 한 번 빌드한 뒤 `test:desktop:built`, `dist:all:built`로 이어집니다.

일반 성공 화면은 `--screenshots`를 지정할 때 저장합니다. `design`은 캡처와 대비 보고서를 항상 `release/design-audit/`에 저장합니다. 이전 8종의 성능 측정은 현재 15종의 전체 실행 시간과 구분합니다. 실제 창·단축키 검사와 유휴 측정은 포커스·CPU 간섭을 피하도록 순차 실행합니다.

### 탭 배치 저장과 창 이동

탭 배치는 `userData/workspace-layout.json`에 원자적으로 저장합니다. v2는 창별 탭 인스턴스(고유 ID·도구 종류·로드/닫힌 상태), 순서·활성 탭·비활성 탭 숨김 옵션·일반 위치와 크기를 담습니다. v1의 순서·닫힌 탭·분리 창 위치도 이관합니다.

모든 창은 고정된 설정 탭을 포함한 동일한 셸을 사용합니다.

`electron/workspace-windows.cjs`는 IPC 발신 메인 프레임과 탭 소유 창을 검증하고, 새 보기의 입력·옵션 복제와 모든 창 사이의 탭 이동을 처리합니다.

탭을 닫으면 React 화면과 임시 입력을 해제하며 보조 창 전체를 닫으면 탭을 메인 창으로 반환합니다.

입력 전달은 메모리에서 수행하고 룰렛 저장 키는 인스턴스별로 분리하되 기존 룰렛 키는 유지합니다. 방송·계정·진행 중인 투표는 공유합니다. 단축키 입력은 시작한 창이 관리합니다.

`workspace`는 실제 포인터 캡처를 위해 격리 창을 잠깐 표시하며 세 창 사이 이동·같은 종류의 독립 입력·보조 창의 설정과 단축키·옵션 복제 및 독립 변경·화면 해제·두 번째 앱 실행 복원을 검사합니다. 복원한 창은 현재 연결된 모니터 안으로 보정합니다.

### 비활성 탭과 화면 수명

정규화는 각 창의 모든 도구 종류를 보장합니다. 로드된 인스턴스가 없는 종류에는 비활성 기본 자리 하나를 두고, 로드된 인스턴스가 있으면 없음 표시를 대체합니다. 처음의 도구 자리는 비활성입니다. 로드된 모든 인스턴스의 화면을 생성하고 탭 선택이 바뀌어도 유지합니다. 마지막 인스턴스를 이동할 때는 원래 자리 위치와 창을 보존합니다. 비활성 자리는 도구 화면과 런타임 입력을 갖지 않으며 숨김은 표시만 바꿉니다. 기존 v2의 누락된 기본 자리는 읽기·변경 시 보충합니다.

### 공용 방송·채팅 수집

메인 프로세스의 `Platforms`가 플랫폼별 `PlatformWorker`를 하나씩 생성합니다. 각 워커가 채팅 연결·폴링 타이머와 공통 방송 상태를 소유하며 동일 채널의 동시 조회를 합치고 오래된 채널 응답이 최신 상태를 덮지 않도록 합니다. Twitch의 방송 조회와 치지직 채팅 채널 탐색도 공통 워커의 결과를 사용합니다. 치지직은 live-detail에 채팅 채널이 없을 때만 접속용 조회를 별도로 수행합니다.

`ensureConnected`는 연결 중 요청과 정상 연결을 재사용하고, 명시적인 로그인·재연결은 완료된 연결을 교체할 수 있습니다.

`Engine`과 `TimelineStore`는 앱 전체에서 하나씩 생성합니다. 탭은 공통 로컬 기록을 조회하며 생성 시 수집을 시작하지 않습니다.

동시 기록 종료 요청은 하나의 완료 처리를 공유합니다.

### 유휴·트레이 동작

수집·연결 유지와 재접속·방송 감지·전역 단축키는 메인 프로세스에서 처리합니다. 창을 숨기거나 최소화해도 유지합니다. `RuntimeActivity`는 기록 중 1초 저장, 변경된 메타데이터의 5초 저장, 추첨·투표 마감을 화면 상태와 독립적으로 예약합니다. 연속 채팅이 저장 시점을 미루지 않으며 메타데이터 저장 실패는 5초 뒤 재시도합니다. 대기 작업이 없는 정상 유휴 상태에는 유지 관리 타이머가 없습니다.

`StatePublisher`는 채팅으로 발생한 화면 갱신을 100ms 동안 합쳐 표시 중인 창에 하나의 스냅샷을 전달합니다. 표시·최소화 해제 상태인 창이 없으면 스냅샷도 생성하지 않습니다. 명시적 읽기는 요청한 창에 즉시 응답하고 표시·복귀 시 최신 상태를 전달합니다. 채팅·후원은 각각 엔진과 공통 기록으로 들어가며 화면 갱신을 합치는 것과 별개로 보존합니다.

`PageActivityContext`는 선택한 탭과 실제 화면 표시 여부를 함께 확인합니다. 숨겨진 탭의 시계·기록 조회·추첨 애니메이션은 멈추고 입력·스크롤 상태는 유지합니다. 타임라인·AI 화면은 필요한 시점에 별도 번들을 로드합니다. AI 서비스는 처음 사용할 때 초기화하고 표시 중인 AI 화면들은 상태 요청·푸시 구독을 공유합니다. 추가된 AI가 있으면 표시 중 10초 상태 조회를 유지합니다. 로그인 창 조회는 숨김·완료 시 멈추며 인증·분석 작업은 앱에서 계속 수행하고 복귀 시 최신 상태를 조회합니다. 추첨 재생 종료 후 임시 명단은 해제하고 후보·당첨자·이력은 유지합니다.

## 검증된 빌드와 자원 사용

`.build-cache/`·`dist/`는 Git에서 제외한 생성 결과입니다. 소스·설정·가져온 JSON·잠금 파일·빌드 환경·결과 내용의 해시가 일치할 때만 성공한 타입 검사와 번들을 재사용합니다. 두 컴파일 작업이 성공한 뒤 `index.html`을 마지막에 교체합니다. 중간 소스 변경·결과 누락/변조·타입 오류는 재사용을 차단하며 패키징도 현재 검증된 화면 빌드를 요구합니다.

격리 테스트 화면의 짧은 전환만 4배속으로 재생합니다. 필요한 단계에 데모 콜백을 실행하고 실제 룰렛 회전·당첨·마감 검증을 유지합니다. 검증·레이아웃 검사는 항상 수행하고 성공 PNG는 선택 저장합니다. 포커스·단축키 충돌을 피하도록 순차 검사하며 Electron 종료 후 임시 프로필을 제거합니다.

React·React DOM은 Vite 빌드 의존성으로 번들에 포함해 데스크톱 런타임에 중복으로 넣지 않습니다. 한국어·영어 언어 파일, 코덱·접근성·소프트웨어 렌더링·라이선스는 유지합니다. 순수 JavaScript 의존성은 네이티브 재빌드를 생략하고 네이티브 모듈 추가 시 자동으로 유지합니다. 자산은 생성 스크립트와 결과 해시를 확인합니다.

NSIS·MakeAppx는 준비·서명한 페이로드를 함께 압축하고 도우미 API가 달라지면 순차 실행합니다. MSIX는 원본 경로 직접 매핑, 의미 검증과 압축을 사용합니다. 이번 실행의 작업 경로만 검증해 정리합니다. OAuth 설정·설치 파일은 새로 만들며 캐시하지 않습니다. CI는 소스·Node 버전별 공개 도구·검증된 화면·타입 검사 상태를 캐시합니다.

합성 암호화 측정과 CI 비교의 범위는 [성능 실측](performance.ko.md)을 확인하세요.

## 구조

| 영역 | 역할 |
| --- | --- |
| `src/main.tsx` / `src/audience.tsx` | 앱 셸·연결 설정·시청자 참여 도구. |
| `src/timeline.tsx` / `src/history.tsx` | 그래프·분석·전체 날짜 조회·일/주/월 선택. |
| `src/history-records.tsx` | 커서로 100건씩 이어 읽는 최신순 채팅 목록과 화면 주변 행 렌더링. |
| `src/workspace.tsx` / `src/workspace-state.tsx` / `src/workspace-pointer.mjs` | 다중 탭·창 셸, 탭별 입력과 포인터 이동. |
| `src/activity.tsx` / `electron/runtime-activity.cjs` | 화면 표시 여부에 따른 UI 시계, 앱의 저장·마감 예약과 스냅샷 전달. |
| `src/text-size-control.tsx` / `resources/appearance.json` | 95~150% 글자 크기 슬라이더·기본값·범위와 단계. |
| `src/presentation.tsx` / `src/roulette.tsx` | 방송 현황 애니메이션과 가중치 룰렛. |
| `src/ai-settings.tsx` / `src/ai-login-dialog.tsx` / `src/ai-assignments.tsx` | AI 연결·계정 인증·그룹/기능별 모델 지정. |
| `src/ai-analysis.tsx` / `src/ai-provider-icon.tsx` | 분석 범위·실행 설정·결과 표시와 공급자 아이콘. |
| `electron/engine.cjs` / `electron/audience.cjs` | 기록·마커·투표·모집·복원. |
| `electron/broadcast-monitor.cjs` | 하나라도 방송이면 시작·모두 종료면 종료·동접 샘플. |
| `electron/timeline-store.cjs` / `electron/timeline-history.cjs` | 암호화 기록·색인·페이지 조회·중단 복구 삭제. |
| `electron/chat-analysis.cjs` / `electron/timeline-export.cjs` | 로컬 통계·화자 키·가명 JSONL. |
| `electron/ai-service.cjs` / `electron/ai-assignments.cjs` / `electron/ai-functions.json` | AI 작업·연결 설정·암호화 키/결과·3개 그룹과 6개 기능의 설정 적용. |
| `electron/ai-profile.cjs` / `electron/ai-login.cjs` | CLI 인증 프로필·로그인/로그아웃·완료 확인. |
| `electron/platforms.cjs` / `electron/chzzk.cjs` / `electron/twitch.cjs` | 플랫폼 수신과 YouTube 기본 투표. |
| `electron/platform-worker.cjs` | 플랫폼별 공용 채팅 연결·방송 조회·동시 요청 병합. |
| `electron/workspace-layout.cjs` / `electron/workspace-windows.cjs` | 탭/창 배치 저장·이관·복원과 창별 IPC 검증. |
| `electron/oauth.cjs` / `electron/twitch-auth.cjs` | 브라우저 인증·암호화 토큰·갱신. |
| `electron/main.cjs` / `electron/preload.cjs` | 창·트레이·단축키·제한된 IPC. |
| `scripts/` / `tests/` | 검증된 빌드·패키징·캡처·문서·회귀 검사. |

## CI/CD와 릴리즈 상태

Push·PR은 로직·데스크톱·패키지와 **일회용 GitHub-hosted 실행기**의 MSIX 설치·실행을 확인합니다. 테스트 인증서·서명본은 배포하지 않습니다. 버전과 같은 `v*` 태그는 설치 파일·SHA256을 게시하며 Windows Release 수동 실행은 artifact만 생성합니다.

최초 Store 게시·API 준비 이후 `STORE_PUBLISH_ENABLED=true`로 업데이트 제출을 켭니다. 공개 시점은 Microsoft 심사에 따릅니다. 등록·인증·최초 초안 관리는 [Store 가이드](store-setup.md)를 참고하세요. 모의 응답·CI 설치 검사를 실제 플랫폼 검증이나 Store 인증으로 표시하지 않습니다. 앱 내부 자동 업데이트는 아직 없습니다.

앱 릴리즈는 `package.json`·`package-lock.json` 버전을 함께 갱신합니다. 문서만 바꿀 때는 릴리즈 태그·설치 파일 재생성이 필요하지 않습니다. 내장 한국어 방침은 `resources/privacy.json`, 공개 영어 번역은 `resources/privacy.en.json`이며 수정 후 `npm run docs`를 실행합니다.

## 문서와 캡처

[영어](../README.md)·[한국어](../README.ko.md) 소개와 번역을 함께 갱신합니다. [캡처 안내](assets/screenshots/README.md)에 따라 실제 렌더링·생성 데이터·격리 임시 프로필을 사용하고 이미지를 검토합니다. 토큰·비공개 채팅·개인 프로필을 포함하지 않습니다.

AI 공급자 아이콘은 `src/assets/ai/`의 로컬 SVG입니다. [출처·고정 리비전](../src/assets/ai/sources.json)과 [MIT 라이선스](../public/licenses/lobe-icons.txt)를 함께 유지합니다. Vite가 아이콘과 라이선스를 빌드 결과에 포함하므로 화면을 표시하기 위해 외부 이미지 서버에 접속하지 않습니다.

공식 자료: [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [YouTube live chat](https://developers.google.com/youtube/v3/live/docs/liveChatMessages), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [MakeAppx 매핑](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool#mapping-files).

## AI 어댑터와 실행 구성요소

렌더러는 제한된 assist 브리지를 호출합니다. ai-service는 작업·취소·암호화 키와 결과·연결 설정, ai-context는 제한된 가명 컨텍스트, ai-api는 크기가 제한된 HTTP/SSE 전송, ai-components는 GitHub 연결 모듈 검증·설치·업데이트, ai-runtime은 검증된 CLI 다운로드, ai-quota는 읽기 전용 한도 프로토콜, ai-usage는 토큰 검증과 비용 계산을 담당합니다. 공급자 요청·출력 변환·모델 조회·요금표·CLI 다운로드 메타데이터는 독립 [AI Connectors 저장소](https://github.com/yechankun/streamer-assist-ai-connectors)에 두며 설치 프로그램에 넣지 않습니다. 선택 가능한 모델은 CLI/API에서 실제 조회한 목록으로만 구성합니다. 공급자 호환성 변경은 연결 모듈을, 공통 호스트 ABI 변경은 앱을 업데이트합니다.

검사는 모의 HTTP 스트림·프로세스·생성한 암호화 기록을 사용합니다. CI는 `node scripts/fetch-ai-test-components.cjs`로 검증된 어댑터를 한 번 준비하고 무시된 캐시를 재사용합니다. 로컬에서는 별도 연결 저장소의 소스를 테스트 전용으로 사용할 수 있습니다. `ai` 데스크톱 검사는 실제 브리지·키 비공개·인증 완료/취소·기능별 상속과 실행 시점 설정·범위 분석·사용량과 비용·최소 창 레이아웃을, `ai-component`는 모듈 추가·업데이트·복원·제거와 공급자 아이콘을 확인합니다. `design`은 긴 AI 이름·로그인 안내·인증 코드·14개 연결의 페이지 이동·키보드 포커스와 다크/라이트 테마의 글자 대비를 확인합니다. 유료 모델을 호출하거나 실제 CLI를 설치하지 않습니다. `node scripts/test-desktop.cjs --build --suite ai,ai-component,design --hidden`으로 선택 실행하고 단위 검사는 `npm test`에 포함됩니다. 개발 실행·재시작은 조용한 Node 프로세스로 모듈 로딩과 문법을 먼저 검사해 통과할 때만 Electron을 실행·교체합니다. [AI 연결 안내](ai-integrations.ko.md)를 참고하세요.

## 연결 모듈 다운로드 안정성

연결 저장소의 CI는 GitHub API의 릴리즈 다이제스트와 파일을 검증한 뒤 같은 저장소의 distribution-v1/index.json에 메타데이터를 게시합니다. 데스크톱은 고정된 HTTPS 게시자와 이 결과를 신뢰하며 태그·주소·카탈로그·패키지·파일 해시를 대조합니다. 별도 전자서명 또는 매번 수행하는 클라이언트 REST 인증이 아닙니다. 익명 REST 요청 한도에 의존하지 않고 검증된 메타데이터를 재사용합니다.

Windows 파일 교체는 기존 대상을 먼저 삭제하지 않고 제한된 간격으로 재시도합니다. 개발 Vite 감시는 .dev·.build-cache·release·별도 연결 저장소를 제외합니다. 잠금 회귀 검사는 실제 지연 대신 주입한 대기 함수를 사용하면서 운영 환경의 재시도 간격을 검증합니다.
