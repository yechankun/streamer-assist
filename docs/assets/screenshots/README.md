# Product screenshots · 제품 화면

[English](#english) · [한국어](#한국어)

## English

Unedited **1280 × 800** native Electron captures, refreshed **2026-10-06**. The app interface is Korean. Timeline, analysis and calendar pictures use a real encrypted synthetic archive spanning 31 earlier broadcasts plus a current recording. Chats, participants, donation/viewer samples and dates are generated. Number/donation totals use explicit synthetic renderer fixtures. No accounts connect, no payments occur and no personal profile is loaded.

| Capture | Contents |
| --- | --- |
| home-dark / home-light / home-recording | Idle and recording workspaces. |
| timeline | Sample viewer graph and manual/automatic markers. |
| chat-history | Original-time rows, all-date scope and platform/type filters. |
| chat-analysis | Local lexical activity, participant statistics and JSONL export controls. |
| ai-connectors | The provider picker opened from an initially empty AI connection list. |
| chat-storage | Multi-date selection with completed file-size lookup; active date protected. |
| viewer-raffle / live-poll / donation-vote / roulette | Generated participation/results in the actual app. |
| settings / platforms / privacy | Automatic detection, shortcut/tray, connection setup and data controls. |

```powershell
npm ci
npm run docs:screenshots
npm run docs:screenshots:store
```

The wrapper uses a checked renderer build, an isolated temporary profile, reduced motion and overflow/clipping checks. It removes the profile after Electron exits. Outputs are `release/readme-screens/` (1280 × 800) or `release/store-assets/screenshots/` (1600 × 900). No app installation or real poll publication occurs.

Review every image before copying it here. Capture filenames stay shared by both READMEs. The displayed F18 shortcut belongs to the capture process; connection-button availability depends on developer client configuration. Do not substitute pictures from a reference voting site. Store submission selects its configured images separately; a new gallery is not automatically uploaded.

The current AI connector image is a reviewed 1240 × 850 component smoke capture. Reproduce it with `node scripts/test-desktop.cjs --suite ai-component --screenshots --hidden`; it also checks the 900 × 650 layout. The documentation capture script includes this screen in subsequent gallery refreshes.

## 한국어

**2026-10-06**에 갱신한 편집 없는 **1280 × 800** 실제 Electron 창입니다. 한국어 UI이며 타임라인·분석·달력은 이전 31개 방송과 현재 기록의 암호화 샘플 파일을 실제로 조회합니다. 채팅·참여자·후원·동접·날짜는 생성 데이터이고 숫자·도네 합계는 명시적인 샘플 화면 상태입니다. 개인 프로필·계정 연결·결제는 없습니다.

위 명령으로 검증된 빌드·격리 임시 프로필·동작 줄이기·스크롤/잘림 검사를 사용합니다. 종료 후 프로필을 제거하며 README는 `release/readme-screens/`, Store용 1600 × 900은 `release/store-assets/screenshots/`에 남습니다. 앱 설치나 실제 투표 게시를 하지 않습니다.

이미지를 모두 검토한 뒤 이 폴더로 복사합니다. F18 조합은 캡처용이며 연결 버튼은 개발자 클라이언트 설정에 따라 달라집니다. 두 README가 같은 파일 이름을 사용하고 참고 사이트 이미지를 대신 넣지 않습니다. Store 제출용 이미지는 별도로 선택하며 갤러리 갱신만으로 업로드하지 않습니다.

현재 AI 연결 모듈 이미지는 검토한 1240 × 850 구성요소 검사 캡처입니다. `node scripts/test-desktop.cjs --suite ai-component --screenshots --hidden`으로 재현하며 900 × 650 배치도 확인합니다. 문서 캡처 스크립트의 다음 갱신에도 이 화면을 포함합니다.
