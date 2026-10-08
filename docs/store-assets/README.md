# Store assets · Store 제출 이미지

The screenshots are unedited 1600 × 900 captures of the actual Korean interface with generated test data. They meet the desktop screenshot size requirement. The 300 × 300 icon is rendered from the project's own activity logo.

스크린샷은 실제 한국어 화면을 테스트 데이터로 캡처한 1600 × 900 PNG입니다. 실제 계정이나 결제 내역은 없습니다. 300 × 300 아이콘은 프로젝트 자체 로고를 렌더링했습니다.

Generate screenshots with `npm run docs:screenshots:store`. Generate the icon with `powershell -NoProfile -File scripts/generate-assets.ps1`. Review captures before copying to this folder.

[Microsoft image requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images)

Copy only reviewed captures that match the submitted version. Development gallery additions are not automatically uploaded to an existing Store submission. 현재 개발 캡처를 기존 Store 제출에 자동으로 올리지 않습니다. 실제 패키지와 일치하는 이미지만 제출에 사용합니다.

The gallery refreshed on **2026-10-09** uses the current 0.4.0 development source, including tab headers, the scrolling chat archive, closing timers and `ai-connectors.png`. AI login/function, workspace and text-size images in [product screenshots](../assets/screenshots/README.md) use separate capture workflows; those images are not Store-size exports. Use the Store capture command for 1600 × 900 images. The submitted image selection comes from `scripts/prepare-store-submission.ps1`; verify that selection and the bilingual [listing text](../store-listing.json) against the packaged build before submission.

**2026-10-09** 갤러리는 현재 0.4.0 개발 소스의 탭 헤더·스크롤 채팅 기록·자동 종료 타이머·AI 추가 선택창 `ai-connectors.png`를 반영합니다. [제품 화면](../assets/screenshots/README.md)의 AI 로그인·기능별 설정·탭 배치·글자 크기 이미지는 별도 캡처이며 Store 크기의 내보내기가 아닙니다. 1600 × 900 이미지는 Store용 캡처 명령으로 생성하세요. 제출 이미지 선택은 `scripts/prepare-store-submission.ps1`에서 정하므로 제출 전에 선택 목록과 [한·영 Store 소개](../store-listing.json)를 실제 패키지와 대조합니다.
