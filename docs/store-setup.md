# Microsoft Store 자동 배포 준비

[English](store-setup.en.md) · **한국어** · [README로 돌아가기](../README.ko.md)

## 실행되는 자동화

- main push/PR: 70개 이상의 단위 검증과 실제 Electron 검사 → EXE·MSIX 생성 → 내용/개인정보 제외 검증 → 일회용 GitHub 실행기에서 MSIX 설치·실행 검사 → artifact 보관.
- package.json 버전과 일치하는 v 태그: 같은 검증 후 EXE·MSIX·SHA256 체크섬을 GitHub Release에 등록.
- Store 자동 제출을 켠 경우: 생성한 MSIX를 Microsoft Store CLI로 업데이트 제출. Microsoft 심사 후 공개됩니다.
- 공개 개인정보처리방침은 main 변경에 따라 GitHub Pages에 자동 배포합니다.

개발 PC에는 MSIX·테스트 인증서를 설치하지 않습니다. 개발 모드는 계속 npm run dev로 실행하며, 설치 검증은 GitHub-hosted 실행기만 사용합니다.

## 등록한 인증 정보 확인

GitHub Actions → **Store Access Check → Run workflow**로 저장한 시크릿을 검사합니다. 일회용 실행기에서 공식 Store CLI로 인증한 뒤 대상 앱만 읽고 제품 ID·패키지 이름·게시자를 대조합니다. 조회 과정은 제출 생성·수정·게시를 하지 않습니다.

결과는 인증 성공 여부, 앱 식별자 일치와 최초 게시 유무만 담은 `store-access-report` artifact로 제공합니다. 비밀키·토큰·비공개 원본 응답은 출력하지 않습니다. Seller ID는 계정 설정의 숫자 값이며 제품 ID나 CN 문자열이 아닙니다.

최초 게시가 없다면 인증에 성공해도 Store 자동 업데이트를 켜지 않습니다. 첫 게시 완료 후 `STORE_PUBLISH_ENABLED=true`로 설정합니다. 버전 태그의 제출 작업도 직전에 같은 조회 검사를 수행합니다.

## 첫 제출 초안 관리

**Store Submission** 수동 워크플로의 inspect는 현재 초안을 읽고, prepare는 설명·이미지·검증된 MSIX를 반영하며, submit은 그 초안을 제출합니다. create는 기존 초안을 삭제하지 않고 API 초안 생성을 요청합니다.

recreate-submit은 삭제를 승인한 빈 최초 초안에만 사용합니다. 게시된 버전이 없고 설명·패키지·심사 메모·트레일러가 없는 PendingCommit 초안인지 다시 확인합니다. 공개 가능한 카테고리·무료 가격·공개 방식·기능 선언만 별도 artifact에 먼저 보관한 뒤 해당 초안만 삭제하고, 새 API 초안에 등록 자료를 반영해 제출합니다. 가격·공개 설정·선언은 기존 응답의 값을 유지합니다.

백업 보관 기간은 90일이며 비밀키·업로드 URL·계정 정보·비공개 원본 응답·연령 설문을 포함하지 않습니다. API에 없는 연령 설문 답변을 생성하거나 수정하지 않습니다.

## 최초 제출용 패키지 생성

GitHub Actions → Windows Release → Run workflow를 실행하면 등록한 Store 식별자와 승인된 배포용 Google 앱 설정을 넣은 MSIX를 만듭니다. 이 수동 실행은 artifact만 생성하며 GitHub Release나 Store 제출을 수행하지 않습니다. 최초 Store 제출에는 이 artifact를 사용합니다. 이후 v 태그에서는 릴리즈·Store 업데이트 흐름이 자동 실행됩니다.

## 최초 등록 (개발자 1회)

Microsoft Store 새 개발자 등록 경로 https://storedeveloper.microsoft.com 에서 계정을 만들고 앱 이름을 예약합니다. MSIX용 앱을 선택하고 최초 제출의 설명·연령 등급·스크린샷·개인정보처리방침과 심사 메모를 작성합니다. 첫 게시 이후 API 자동 업데이트를 사용합니다. CI가 계정 등록·신원 확인·앱 이름 예약을 대신 수행하지는 않습니다.

개인정보 URL: https://yechankun.github.io/streamer-assist/privacy.html

심사 메모는 [certification.md](certification.md)를 바탕으로 작성합니다. 실제 플랫폼 로그인 확인용 테스트 환경이 필요하면 Partner Center의 비공개 심사 메모에 제공하며 공개 저장소에 개인 로그인 정보를 넣지 않습니다.

## GitHub Actions Variables (공개 식별자)

| 이름                        | 값                                                                         |
| --------------------------- | -------------------------------------------------------------------------- |
| MSIX_IDENTITY_NAME          | Partner Center → 제품 관리 → 제품 ID에 표시된 Package/Identity/Name        |
| MSIX_PUBLISHER              | 같은 화면의 Package/Identity/Publisher 문자열 전체 (CN=…)                  |
| MSIX_PUBLISHER_DISPLAY_NAME | Store에 등록한 게시자 표시 이름                                            |
| MSSTORE_PRODUCT_ID          | 예약한 앱의 Store 제품 ID (9… 형태)                                        |
| GOOGLE_DESKTOP_CLIENT_ID    | 기존 Google Desktop OAuth Client ID. 생략하면 저장소의 공개 Client ID 사용 |
| STORE_PUBLISH_ENABLED       | 첫 게시와 인증 준비를 완료한 뒤 true                                       |

일부 MSIX 식별자만 입력하면 빌드를 실패시킵니다. 아무 식별자도 없으면 StreamerAssist.Development 이름으로 검증용 MSIX만 생성합니다. 개발용 식별자는 Store에 제출할 수 없습니다.

## GitHub Actions Secrets (CI 인증)

| 이름                         | 용도                                           |
| ---------------------------- | ---------------------------------------------- |
| MSSTORE_TENANT_ID            | Partner Center에 연결한 Microsoft Entra 테넌트 |
| MSSTORE_CLIENT_ID            | 제출용 Entra 애플리케이션 ID                   |
| MSSTORE_CLIENT_SECRET        | 해당 애플리케이션의 비밀키                     |
| MSSTORE_SELLER_ID            | Partner Center Seller/Publisher 식별자         |
| GOOGLE_DESKTOP_CLIENT_SECRET | 설치형 Google OAuth 앱 설정                    |

Microsoft Store 제출 애플리케이션은 대상 Partner Center 계정의 Manager 역할과 API 접근 권한이 필요합니다. 인증 정보는 GitHub Secrets에 등록하고 채팅·코드·스크린샷에 넣지 않습니다. msstore CLI의 인증 정보 출력 명령은 CI에서 실행하지 않습니다.

Google Desktop의 client secret은 설치형 공개 클라이언트 설정이므로 배포된 프로그램에서 숨길 수 없습니다. 빌드는 앱용 Client ID/Secret만 별도 리소스에 포함합니다. 개인 계정의 access/refresh token·개발 프로필·.env.local은 포함하지 않습니다. Google OAuth 공개 동의 화면과 필요한 검증도 준비해야 합니다.

## 버전과 로컬 빌드

npm run dist:msix로 MSIX만, npm run dist:all로 EXE와 MSIX를 만듭니다. npm run verify:msix는 manifest·코드·리소스·개인 데이터 제외를 검사합니다. MSIX의 첫 버전 필드는 0일 수 없고 마지막 필드는 Store용 0이므로 앱 버전의 major에 1을 더해 매핑합니다. 앱 0.1.0 → MSIX 1.1.0.0, 앱 1.0.0 → MSIX 2.0.0.0입니다. CI 빌드 번호를 마지막 필드에 넣지 않습니다.

로컬 Store 식별자는 store.config.example.json을 .store.local.json으로 복사해 입력할 수 있습니다. 이 파일은 Git에서 제외합니다. 로컬 빌드는 .env.local의 시크릿을 자동으로 배포 파일에 복사하지 않습니다. 배포용 앱 설정을 넣으려면 GOOGLE_DESKTOP_CLIENT_ID/GOOGLE_DESKTOP_CLIENT_SECRET 환경 변수를 지정합니다.

unsigned MSIX는 Store 업로드용이며 직접 설치하려면 신뢰할 수 있는 서명이 필요합니다. CI의 임시 테스트 서명은 게시되지 않습니다. Store 서명은 GitHub의 EXE 경고를 제거하지 않습니다.

## 제출 전 Windows 인증 검사

CI는 패키지 검사와 실제 MSIX 설치·실행을 수행합니다. Microsoft의 Windows App Certification Kit(WACK) 검사와 실제 YouTube·치지직 로그인/방송 수신 검증은 정식 제출 전에 별도 Windows 테스트 환경에서 수행합니다. WACK와 Microsoft 심사를 통과했다고 표시하지 않습니다. 불합격 보고서가 오면 해당 사유를 보완해 새 버전으로 제출합니다.

공식 자료: [Store CI/CD](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/github-actions), [MSIX 버전 요구](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/package-version-numbering?pivots=store-installer-msix), [심사 절차](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process).
