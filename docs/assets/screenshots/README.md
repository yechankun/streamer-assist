# 제품 화면 · Screenshots

샘플 데이터로 촬영한 실제 앱 화면입니다. 보고 싶은 화면을 눌러 원본 크기로 확인하세요.
Actual app screens with synthetic data. Choose a picture to open it at full resolution.

| 보고 싶은 화면 / Area | 스크린샷 / Pictures |
| --- | --- |
| 방송 기록 / Recording | [타임라인 / Timeline](timeline.png) · [채팅 / Chat](chat-history.png) · [분석 / Analysis](chat-analysis.png) · [날짜 관리 / Storage](chat-storage.png) |
| 타임라인 작업 / Timeline workspaces | [AI 분석 / AI analysis](ai-analysis.png) · [다시보기 수집 / Replay collection](replay.png) |
| 시청자 참여 / Audience tools | [추첨 / Raffle](viewer-raffle.png) · [숫자 투표 / Number vote](live-poll.png) · [후원 투표 / Donation vote](donation-vote.png) · [룰렛 / Roulette](roulette.png) |
| 탭·창·글자 크기 / Workspace | [탭 메뉴 / Tabs](workspace-tabs.png) · [보조 창 / Separate window](workspace-detached.png) · [큰 글자 / Larger text](text-size.png) |
| AI 연결·설정 / AI | [AI 추가 / Add](ai-connectors.png) · [로그인 / Login](ai-login.png) · [기능별 설정 / Functions](ai-functions.png) · [그룹 설정 / Group](ai-function-editor.png) |
| 앱 설정 / Settings | [일반 / General](settings.png) · [플랫폼 / Platforms](platforms.png) · [데이터 관리 / Data controls](privacy.png) |
| 홈 / Home | [다크 / Dark](home-dark.png) · [라이트 / Light](home-light.png) · [기록 중 / Recording](home-recording.png) |

[제품 소개 / Overview](../../../README.md) · [사용 가이드 / User guide](../../user-guide.ko.md)

이미지는 현재 개발 소스의 화면이며 설치 버전의 기능은 해당 릴리즈 노트를 확인하세요.
These images show the development source; check release notes for an installed version.

## English

<details>
<summary>Capture data and reproduction</summary>

The main gallery uses unedited **1280 × 800** native Electron captures, refreshed **2026-10-08** from the current 0.3.0 development source. Separate AI login/function captures use **1240 × 850** and workspace captures use **900 × 650**, as described below. The app interface is Korean. Timeline, analysis and calendar pictures use a real encrypted synthetic archive spanning 31 earlier broadcasts plus a current recording. Chats, participants, donation/viewer samples and dates are generated. Number/donation totals use explicit synthetic renderer fixtures, with 10/15-minute closing timers. No accounts connect, no payments occur and no personal profile is loaded.

| Capture | Contents |
| --- | --- |
| home-dark / home-light / home-recording | Idle and recording workspaces. |
| timeline | Stable navigation above broadcast controls, viewer axes that retain text proportions and manual/automatic markers. |
| chat-history | Original-time rows, all-date scope and platform/type filters. |
| chat-analysis | Local lexical activity, participant statistics and JSONL export controls. |
| ai-analysis / replay | AI assignment notice, scope/prompt and results; replay collection controls while a sample recording is active. |
| ai-connectors | The provider picker opened from an initially empty AI connection list. |
| ai-login | Account connection dialog with a simulated successful CLI authentication response. |
| ai-functions / ai-function-editor | Inline AI/model/reasoning dropdowns, automatic saving and group inheritance using synthetic connections; the second filename is retained from the earlier editor capture. |
| chat-storage | Multi-date selection with completed file-size lookup; active date protected. |
| viewer-raffle / live-poll / donation-vote / roulette | Generated participation/results in the actual app. |
| settings / platforms / privacy | Automatic detection, shortcut/tray, connection setup and data controls. |
| workspace-tabs / workspace-detached | Five context-menu actions, duplicate tabs and a full secondary workspace. |
| text-size | General settings at 150% text size in a 1280 × 800 window. |

```powershell
npm ci
npm run docs:screenshots
npm run docs:screenshots:store
```

The wrapper uses a checked renderer build, an isolated temporary profile, reduced motion and overflow/clipping checks. It removes the profile after Electron exits. Outputs are `release/readme-screens/` (1280 × 800) or `release/store-assets/screenshots/` (1600 × 900). No app installation or real poll publication occurs.

Review every image before copying it here. Capture filenames stay shared by both READMEs. The displayed F18 shortcut belongs to the capture process; connection-button availability depends on developer client configuration. Do not substitute pictures from a reference voting site. Store submission selects its configured images separately; a new gallery is not automatically uploaded.

The timeline, chat, analysis and storage captures now show the same top tab bar. AI analysis and replay captures use the same 1280 × 800 workflow. Viewer-axis text is separate from the resizing plot; keyboard focus stays inside timeline controls. Resize checks at 900 × 650, 1240 × 850 and 1600 × 1000 with 100%/150% text can be reproduced with `node scripts/test-desktop.cjs --suite timeline --screenshots --hidden`; their screenshots remain in `release/`.

The AI connector image shows the provider picker, including bundled provider icons, in the same native 1280 × 800 documentation capture as the gallery. Separate `node scripts/test-desktop.cjs --build --suite ai-component --screenshots --hidden` captures also check the 900 × 650 layout.

The AI login and inline function images were captured at 1240 × 850 on 2026-10-08. Reproduce them with `node scripts/test-desktop.cjs --build --suite ai --screenshots --hidden`. This writes `release/ai-login.png`, `release/ai-functions.png` and `release/ai-function-editor.png`, using fake child processes and synthetic credentials in an isolated profile, with no real sign-in, browser launch or paid API request. Review them before copying to this directory.

`node scripts/test-desktop.cjs --build --suite design --hidden` always writes stress-case captures and `contrast.json` to `release/design-audit/`. These check long names/messages/codes, focus scrolling and multi-page provider lists in both themes; they are test artifacts, separate from the product gallery.

The workspace guide images use native 900 × 650 windows captured on 2026-10-08. Reproduce them with `node scripts/test-desktop.cjs --build --suite workspace --screenshots`. The isolated suite exercises the five-action menu, duplicate drafts and roulettes, full secondary tools/settings, window-specific hide options, three-way pointer exchange, close/reload and a second app launch to check layout restoration. These dedicated images use generated data without connected accounts.

Reproduce the text-size capture with `node scripts/test-desktop.cjs --build --suite appearance --screenshots`. Copy the reviewed `release/text-size/일반-150-1280x800.png` to `text-size.png`. This suite verifies the 95–150% slider, layouts at 900 × 650 and 1280 × 800, keyboard reachability, cross-window synchronization and actual restart restoration. Focus/drag checks may briefly show an isolated test window even with `--hidden`.

</details>

## 한국어

<details>
<summary>캡처 데이터와 재현 방법</summary>

기본 갤러리는 **2026-10-08**에 현재 0.3.0 개발 소스로 갱신한 편집 없는 **1280 × 800** 실제 Electron 창입니다. 별도 AI 로그인·기능별 설정 캡처는 **1240 × 850**, 탭 배치 캡처는 **900 × 650**입니다. 한국어 UI이며 타임라인·분석·달력은 이전 31개 방송과 현재 기록의 암호화 샘플 파일을 실제로 조회합니다. 채팅·참여자·후원·동접·날짜는 생성 데이터이고 숫자·도네 합계는 명시적인 샘플 화면 상태이며 10분·15분 자동 종료를 설정합니다. 개인 프로필·계정 연결·결제는 없습니다.

위 명령으로 검증된 빌드·격리 임시 프로필·동작 줄이기·스크롤/잘림 검사를 사용합니다. 종료 후 프로필을 제거하며 README는 `release/readme-screens/`, Store용 1600 × 900은 `release/store-assets/screenshots/`에 남습니다. 앱 설치나 실제 투표 게시를 하지 않습니다.

이미지를 모두 검토한 뒤 이 폴더로 복사합니다. F18 조합은 캡처용이며 연결 버튼은 개발자 클라이언트 설정에 따라 달라집니다. 두 README가 같은 파일 이름을 사용하고 참고 사이트 이미지를 대신 넣지 않습니다. Store 제출용 이미지는 별도로 선택하며 갤러리 갱신만으로 업로드하지 않습니다.

타임라인·채팅·분석·날짜 관리 캡처에 동일한 상단 탭 메뉴를 반영했습니다. AI 분석과 다시보기 수집도 같은 1280 × 800 캡처로 추가했습니다. 동접 그래프는 축 글자를 그래프 확대와 분리하고, 키보드 포커스는 컨트롤 안쪽에 표시합니다. `node scripts/test-desktop.cjs --suite timeline --screenshots --hidden`으로 900 × 650·1240 × 850·1600 × 1000 창과 글자 크기 100%·150% 검사를 재현할 수 있습니다. 검사 스크린샷은 `release/`에 보관합니다.

AI 연결 이미지는 공급자 아이콘이 포함된 AI 추가 선택창이며 갤러리와 같은 1280 × 800 문서 캡처입니다. 별도의 `node scripts/test-desktop.cjs --build --suite ai-component --screenshots --hidden` 캡처에서도 900 × 650 배치를 확인합니다.

AI 로그인·목록에서 직접 지정하는 기능별 설정은 2026-10-08에 캡처한 1240 × 850 실제 창입니다. `node scripts/test-desktop.cjs --build --suite ai --screenshots --hidden`으로 재현합니다. `release/ai-login.png`, `release/ai-functions.png`, `release/ai-function-editor.png`를 생성하며 격리 프로필의 가상 프로세스·생성 자격증명을 사용합니다. 마지막 파일명은 이전 설정창 캡처의 이름을 유지한 것입니다. 실제 로그인·브라우저 실행·유료 API 요청은 없습니다. 검토한 이미지만 이 폴더로 복사합니다.

`node scripts/test-desktop.cjs --build --suite design --hidden`은 항상 `release/design-audit/`에 긴 이름·로그인 문구·인증 코드·키보드 포커스·다중 페이지 연결 목록의 두 테마 캡처와 `contrast.json`을 저장합니다. 제품 갤러리와 별도로 관리하는 테스트 결과입니다.

탭 배치 안내의 `workspace-tabs`·`workspace-detached` 이미지는 2026-10-08의 편집 없는 900 × 650 실제 창입니다. `node scripts/test-desktop.cjs --build --suite workspace --screenshots`로 재현합니다. 격리 프로필에서 다섯 항목 우클릭 메뉴·복제 입력과 룰렛·보조 창의 전체 도구와 설정·창별 숨김 옵션·세 창 사이 마우스 이동·닫기와 재로드·두 번째 앱 실행 복원을 검사합니다. 계정 연결 없이 생성한 샘플 데이터를 사용합니다.

큰 글자 화면은 `node scripts/test-desktop.cjs --build --suite appearance --screenshots`로 재현합니다. 검토한 `release/text-size/일반-150-1280x800.png`를 `text-size.png`로 복사합니다. 95~150% 슬라이더, 900 × 650·1280 × 800 배치, 키보드 접근, 창 간 동기화와 실제 재시작 복원을 검사합니다. 포커스·드래그 검사는 `--hidden`을 지정해도 격리 테스트 창을 잠깐 표시할 수 있습니다.

</details>
