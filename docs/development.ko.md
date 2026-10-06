# 개발 가이드

[English](development.md) · **한국어** · [README로 돌아가기](../README.ko.md)

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

## 명령

| 명령                       | 용도                                                      |
| -------------------------- | --------------------------------------------------------- |
| `npm run build`            | TypeScript 검사와 Vite 빌드.                              |
| `npm test`                 | 격리 데이터·모의 플랫폼 응답으로 핵심 로직 검사.          |
| `npm run test:desktop`     | 빌드 및 현황·참여·개인정보·생명주기의 격리 Electron 검사. |
| `npm run dist`             | Windows x64 NSIS EXE 설치 파일.                           |
| `npm run dist:msix`        | Windows x64 Microsoft Store MSIX 패키지.                  |
| `npm run dist:all`         | 두 패키지 생성.                                           |
| `npm run verify:msix`      | Manifest·리소스·개인 파일 제외 검사.                      |
| `npm run docs`             | 내장 방침 리소스에서 공개 개인정보 페이지 생성.           |
| `npm run docs:screenshots` | 빌드 후 별도 프로필·샘플 데이터로 실제 앱 캡처.           |

출력은 Git에서 제외한 `release/`에 있습니다. Electron 런타임을 포함하므로 네이티브 유틸리티보다 설치 파일이 큽니다. 외부 DB·AI 런타임을 운영할 필요는 없습니다.

## 구조

| 영역                                                | 역할                                       |
| --------------------------------------------------- | ------------------------------------------ |
| `src/main.tsx`                                      | 앱 셸·타임라인·숫자 투표·연결·일반 설정.   |
| `src/audience.tsx`                                  | 방송 워크스페이스·시청자 추첨·도네 투표.   |
| `src/presentation.tsx` / `src/roulette.tsx`         | 방송용 결과·숫자 애니메이션·SVG 룰렛.      |
| `src/privacy.tsx`                                   | 개인정보와 로컬 데이터 관리.               |
| `electron/engine.cjs`                               | 타임라인·반응 감지·숫자 투표·내보내기.     |
| `electron/audience.cjs`                             | 모집·추첨·도네 투표·타이머·복원.           |
| `electron/roulette.cjs` / `electron/vote-input.cjs` | 가중치 추첨과 명령 검증.                   |
| `electron/platforms.cjs` / `electron/chzzk.cjs`     | 공식 YouTube API와 치지직 채팅 읽기.       |
| `electron/oauth.cjs`                                | 브라우저 OAuth·PKCE·암호화 인증·갱신.      |
| `electron/main.cjs` / `electron/preload.cjs`        | 트레이·전역 단축키·암호화 기록·제한된 IPC. |
| `electron/preferences.cjs`                          | 설정·단축키 충돌 및 복구.                  |
| `scripts/` / `tests/`                               | 개발 실행기·패키징·문서·검증.              |

Renderer는 제한된 preload 브리지를 사용하고 인증 정보는 Electron main에 둡니다. 트레이로 숨긴 상태에서도 수집·타이머가 계속됩니다.

## CI와 릴리즈

- `main` push와 PR은 Windows 검사, EXE·MSIX 생성, 내용 검증 후 **일회용 GitHub-hosted 실행기**에서 테스트 서명 MSIX를 설치·실행합니다. 임시 인증서와 테스트 서명본은 배포하지 않습니다.
- 앱 버전과 같은 태그(`0.1.1`이면 `v0.1.1`)는 같은 검사 후 EXE·MSIX·SHA256 체크섬을 게시합니다.
- **Windows Release → Run workflow**는 앱 식별자·OAuth를 넣은 최초 제출용 artifact를 만듭니다. 수동 실행은 GitHub 릴리즈나 Store 제출을 하지 않습니다.
- Store 최초 게시와 API 인증을 준비하고 `STORE_PUBLISH_ENABLED=true`로 켜면 버전 태그에서 제출합니다. Microsoft 심사 후 공개됩니다.
- 개인정보 페이지 변경은 GitHub Pages로 배포합니다.

새 버전은 `package.json`과 `package-lock.json`을 함께 변경하고 커밋 후 일치하는 태그를 올립니다. 문서만 수정할 때 앱 릴리즈 태그를 만들지 않습니다. 앱 내부 자동 업데이트는 아직 제공하지 않습니다.

## 화면 캡처와 문서

[영어 README](../README.md)와 [한국어 README](../README.ko.md)를 사용자 동작 변경에 맞춰 함께 수정합니다.

[캡처 안내](assets/screenshots/README.md#한국어)에 갤러리 갱신 방법이 있습니다. 실제 앱을 생성 데이터로 렌더링하며 개인 계정·실제 결제를 사용하지 않습니다. 저장소로 복사하기 전에 각 이미지를 검토하세요.

## 공식 참고 자료

- [Google 설치형 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [YouTube 실시간 채팅과 투표](https://developers.google.com/youtube/v3/live/docs/liveChatMessages)
- [Electron 전역 단축키](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
