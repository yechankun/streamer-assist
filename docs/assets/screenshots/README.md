# Product screenshots · 제품 화면

[English](#english) · [한국어](#한국어)

## English

These are unedited **1280 × 800** captures of Streamer Assist's actual Electron window from the current source. The interface is Korean; the product documentation is bilingual.

Captured on **2026-10-06**, after the original broadcast workspace redesign. The timeline and recruitment use generated demo events; poll/donation totals use explicit sample renderer snapshots. Accounts are not connected, payments are not made, and no personal profile is loaded. The unusual shortcut shown is reserved for the isolated capture process.

From the repository root:

```powershell
npm ci
npm run docs:screenshots
```

The script builds the app, creates an isolated profile, disables motion for stable captures, and checks for page overflow/clipped controls. Output and generated profiles stay under the ignored `release/` directory. It does not install the app or publish a vote.

Review every image in `release/readme-screens/`, then copy the approved PNG files here. Keep filenames stable for both READMEs. Never substitute screenshots from the reference voting site.

## 한국어

현재 소스의 실제 Electron 창을 편집 없이 **1280 × 800**으로 캡처했습니다. 앱 화면은 한국어이며 제품 문서는 영어·한국어를 제공합니다.

독자적인 방송 워크스페이스로 변경한 **2026-10-06** 캡처입니다. 타임라인·모집은 테스트 이벤트, 숫자·도네 투표 합계는 명시적인 샘플 화면 상태를 사용합니다. 계정 연결·결제·개인 프로필 사용은 없습니다. 화면의 특수 단축키는 격리된 캡처 실행용입니다.

저장소 루트에서 위 명령을 실행합니다. 스크립트는 빌드 후 별도 프로필과 동작 줄이기로 화면을 준비하고 전체 스크롤·조작 버튼 잘림을 검사합니다. 결과와 생성 프로필은 Git에서 제외한 `release/` 안에 둡니다. 앱 설치나 실제 투표 게시는 하지 않습니다.

`release/readme-screens/`의 각 이미지를 검토한 뒤 승인한 PNG만 이 폴더로 복사합니다. 두 README의 링크를 위해 파일 이름을 유지하고 참고 투표 사이트의 화면을 대신 넣지 않습니다.
