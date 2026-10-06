# Contributing · 기여 안내

[English](#english) · [한국어](#한국어)

## English

Thank you for helping improve Streamer Assist. Bugs, usability improvements, documentation and focused pull requests are welcome.

### Start locally

Use Windows 10/11 x64 and Node.js 22+. Run `npm ci`, then `npm run dev`. The window refreshes with source changes; an installer is not needed. See the [development guide](docs/development.md).

### Report an issue

Use [GitHub Issues](https://github.com/yechankun/streamer-assist/issues). Include the app version/source commit, Windows version, reproduction steps, expected behavior and actual behavior. For a layout issue, include window size and a screenshot with account details removed. English and Korean reports are both welcome.

Do not include account tokens, OAuth credentials, private chat logs, `.env.local` or personal app profiles.

### Send a pull request

Keep the change focused and explain the user-visible problem, resulting behavior and relevant validation. For core logic changes run `npm test`; for UI changes run a focused checked build such as `node scripts/test-desktop.cjs --build --suite timeline` (`npm run test:desktop` covers all eight).

Preserve the frameless layout, no outer-page scrolling, internal list scrolling, keyboard input and reduced-motion support. Update [README.md](README.md) / [README.ko.md](README.ko.md) and matching guide translations together. Refresh [product captures](docs/assets/screenshots/README.md) when the visible design changes.

Privacy edits should update `resources/privacy.json` and `resources/privacy.en.json`, then run `npm run docs`. Run `npm run docs:check` after documentation edits. Do not commit generated packages, profiles or credentials. Contributions are distributed under the repository's [MIT License](LICENSE).

## 한국어

버그 수정, 사용성 개선, 문서와 범위가 명확한 Pull Request를 환영합니다.

### 로컬에서 시작하기

Windows 10/11 x64와 Node.js 22 이상에서 `npm ci` 후 `npm run dev`로 실행합니다. 설치 파일 없이 변경이 반영되는 창에서 작업합니다. 자세한 내용은 [개발 가이드](docs/development.ko.md)에 있습니다.

### 문제 제보

[GitHub Issues](https://github.com/yechankun/streamer-assist/issues)에 앱 버전·소스 커밋, Windows 버전, 재현 단계, 기대 동작과 실제 동작을 적어 주세요. 레이아웃 문제는 창 크기와 계정 정보를 제거한 화면을 첨부하면 도움이 됩니다. 영어·한국어 모두 가능합니다.

계정 토큰·OAuth 인증 정보·비공개 채팅 로그·`.env.local`·개인 앱 프로필은 포함하지 않습니다.

### Pull Request

수정 범위를 분명히 하고 사용자에게 보이던 문제, 변경 후 동작과 관련 검증 결과를 설명합니다. 핵심 로직은 `npm test`, UI는 `node scripts/test-desktop.cjs --build --suite timeline`처럼 해당 기능을 검사합니다. `npm run test:desktop`은 전체 8종입니다.

프레임 없는 창, 전체 화면 스크롤 없음, 패널 내부 목록 스크롤, 키보드 입력과 동작 줄이기를 유지합니다. [영어 README](README.md)·[한국어 README](README.ko.md) 및 가이드 번역을 함께 갱신하고 디자인 변경 시 [제품 화면](docs/assets/screenshots/README.md#한국어)을 다시 캡처합니다.

개인정보 문구는 `resources/privacy.json`·`resources/privacy.en.json`을 함께 수정하고 `npm run docs`로 생성합니다. 문서 수정 후 `npm run docs:check`로 링크를 확인합니다. 패키지·프로필·인증 정보는 커밋하지 않습니다. 기여한 내용은 저장소의 [MIT License](LICENSE)로 배포합니다.
