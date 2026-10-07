# Store assets · Store 제출 이미지

The screenshots are unedited 1600 × 900 captures of the actual Korean interface with generated test data. They meet the desktop screenshot size requirement. The 300 × 300 icon is rendered from the project's own activity logo.

스크린샷은 실제 한국어 화면을 테스트 데이터로 캡처한 1600 × 900 PNG입니다. 실제 계정이나 결제 내역은 없습니다. 300 × 300 아이콘은 프로젝트 자체 로고를 렌더링했습니다.

Generate screenshots with `npm run docs:screenshots:store`. Generate the icon with `powershell -NoProfile -File scripts/generate-assets.ps1`. Review captures before copying to this folder.

[Microsoft image requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images)

Copy only reviewed captures that match the submitted version. Development gallery additions are not automatically uploaded to an existing Store submission. 현재 개발 캡처를 기존 Store 제출에 자동으로 올리지 않습니다. 실제 패키지와 일치하는 이미지만 제출에 사용합니다.

The gallery refreshed on **2026-10-07** includes `ai-connectors.png`, showing the AI provider picker with local provider icons. AI login/function images in [product screenshots](../assets/screenshots/README.md) use a different size and capture workflow. Use the Store capture command for 1600 × 900 images. The submitted image selection comes from `scripts/prepare-store-submission.ps1`; verify that selection and the bilingual [listing text](../store-listing.json) against the packaged build before submission.

**2026-10-07** 갤러리에는 로컬 공급자 아이콘을 표시하는 AI 추가 선택창 `ai-connectors.png`도 포함합니다. [제품 화면](../assets/screenshots/README.md)의 AI 로그인·기능별 설정 이미지는 크기와 캡처 절차가 다릅니다. 1600 × 900 이미지는 Store용 캡처 명령으로 생성하세요. 제출 이미지 선택은 `scripts/prepare-store-submission.ps1`에서 정하므로 제출 전에 선택 목록과 [한·영 Store 소개](../store-listing.json)를 실제 패키지와 대조합니다.
