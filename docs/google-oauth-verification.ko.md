# Google OAuth 민감한 권한 검증 준비

도메인 소유권·브랜딩 인증과 민감한 권한의 데이터 액세스 검증은 별도입니다. Streamer Assist는 `https://www.googleapis.com/auth/youtube.force-ssl`을 요청하므로 브랜딩만 인증된 상태에서는 미확인 앱 경고가 남을 수 있습니다. 검증 센터에서 데이터 액세스 상태까지 확인합니다.

먼저 [현재 구현의 제출 준비 점검](google-oauth-readiness.ko.md)을 확인합니다. 0.4.1에는 연결 전 동의·보관·철회와 비공식 YouTube 다시보기 수집 제거가 구현되어 있습니다. 사용 사유와 영상만으로 전체 준수를 주장할 수 없으며, 실제 공개 설치 버전과 분석 기능별 정책 조건을 확인해야 합니다.

## 범위 사용 사유

Google의 **범위가 어떤 방식으로 사용됩니까?** 입력란에는 [붙여 넣기용 영문 설명](google-oauth-scope-justification.txt)의 본문만 입력합니다. 1,000자 이내이며 실제 구현된 YouTube 기능을 설명합니다.

핵심 이유는 방송 채널·활성 방송·채팅 조회뿐 아니라, 사용자가 요청한 **YouTube 기본 실시간 투표의 생성과 종료**입니다.

| 실제 기능 | 구현 | 공식 요구사항 |
| --- | --- | --- |
| Google 동의 요청 | `electron/oauth.cjs`에서 `youtube.force-ssl` 요청 | 민감한 권한 검증 |
| 채널·방송 조회 | `channels.list(mine=true)`, `liveBroadcasts.list` | 연결한 채널과 활성 방송 확인 |
| 채팅·슈퍼챗·투표 결과 수신 | `electron/platforms.cjs` 및 `youtube-stream.cjs` | 기록·추첨·숫자 투표에 사용 |
| YouTube 투표 생성 | `publishPoll()`의 `liveChatMessages.insert`, `snippet.type=pollEvent` | `youtube` 또는 `youtube.force-ssl` |
| YouTube 투표 종료 | `closePoll()`의 `liveChatMessages.transition`, `status=closed` | `youtube` 또는 `youtube.force-ssl` |

`youtube.readonly`는 투표 생성·종료 API가 허용하는 권한에 포함되지 않습니다. 공식 자료: [투표 생성](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert), [투표 종료](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/transition).

## 데모 영상 촬영 준비

앱의 현재 화면 언어는 한국어입니다. Google 공식 안내에 따라 OAuth 동의 과정은 영어로 보여주고, 앱의 기능 설명에는 영어 자막이나 영어 내레이션을 사용하면 심사자가 확인하기 쉽습니다. [민감한 권한 검증·데모 안내](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

1. 검증 대상 프로젝트의 Desktop OAuth 클라이언트와 연결된 실제 앱을 사용합니다. 현재 공개 기본 Client ID는 `74696803905-6p9hj54udubvn0f563pm5vvg08jsgteu.apps.googleusercontent.com`입니다. 로컬 환경 변수로 다른 클라이언트를 쓰고 있지 않은지 확인합니다.
2. 본인이 관리하는 테스트용 YouTube 채널에서 채팅 가능한 실제 방송을 준비합니다. 계정·채널 권한과 활성 방송이 필요합니다.
3. 테스트용 계정으로 Google OAuth 동의 과정을 촬영합니다. 다시 동의를 받기 위해 철회한다면 **권한 철회 및 데이터 삭제**의 영향부터 확인합니다. 개발 버전의 철회는 관련 YouTube 기록도 삭제합니다. 실제 운영 계정 기록에 철회를 시험하지 마세요. 비밀번호·2단계 인증 코드·사용자 access/refresh token은 영상에 노출하지 않습니다.
4. Google 로그인·동의 화면을 영어로 표시합니다. Google 화면의 언어 선택이나 계정의 언어 설정을 사용합니다. 앱 이름, 요청 권한과 OAuth Client ID가 확인되는 화면을 보여줍니다.
5. 앱의 **테스트 채팅은 끕니다**. 이 영상은 실제 Google API 권한 사용을 입증해야 하므로 생성 채팅·가짜 로그인·모의 투표만으로 대체하지 않습니다.

## 촬영 순서와 영어 설명 예시

아래 시간은 촬영 구성 예시이며 Google의 영상 길이 제한을 뜻하지 않습니다.

| 구간 | 보여줄 화면·동작 | 영어 설명 예시 |
| --- | --- | --- |
| 0:00–0:20 | 앱 이름과 새 홈페이지·약관·개인정보처리방침 | Streamer Assist is a Windows desktop companion for broadcasters. These are our homepage, terms and privacy policy. |
| 0:20–1:10 | 설정 → 플랫폼 연결 → YouTube 연결 전 약관·보관 정책과 삭제 대상 확인 → 명시적 동의 → Google OAuth 동의 | The broadcaster accepts the terms and retention policy, reviews affected records, and connects their own YouTube channel. The app requests youtube.force-ssl to read live chat and manage native live polls. |
| 1:10–1:40 | 승인 후 연결된 채널·활성 방송 표시 | The authorized channel and its active broadcast are identified. |
| 1:40–2:20 | 실제 YouTube 채팅 작성 → 앱 채팅 기록·숫자 투표 또는 추첨 참여에 반영 | Real live chat is used for local archives and audience participation. |
| 2:20–3:20 | 숫자 투표에서 YouTube만 선택 → YouTube 기본 실시간 투표 → 질문·보기 입력 → 시작. YouTube 채팅에 투표가 표시되는 장면과 결과 반영 | Creating a native live poll uses liveChatMessages.insert. A read-only scope cannot perform this operation. |
| 3:20–3:50 | 앱에서 투표 종료 → YouTube 투표 종료 및 최종 결과 확인 | Closing the native poll uses liveChatMessages.transition with status closed. |
| 3:50–4:20 | 외부 AI 분석을 시연하는 경우 제공자·모델·범위·식별 정보·원문 전송 확인창과 취소 시 전송되지 않는 동작 | External AI analysis requires confirmation of the provider, model, selected records and original-text transfer. Canceling sends no request. |
| 4:20–4:50 | 설정의 연결 일시 중지·재개, 권한 철회 및 데이터 삭제 확인창. 테스트 계정에서 철회·정리 완료 확인 | Pause keeps the connection and records. Revoke access and delete data revokes Google authorization and removes app-managed YouTube data. Exported files and provider-held AI copies are managed separately. |

실제 API 호출이 실패하면 해당 문제를 해결하고 성공한 동작을 다시 촬영합니다. 테스트 채널에 슈퍼챗이 없어도 데모를 위해 결제할 필요는 없습니다. 채팅 조회와 권한을 필요로 하는 투표 생성·종료를 실제로 보여줍니다.

## 영상 제출

영상은 YouTube에 **일부 공개(Unlisted)**로 업로드하고 실제 공유 링크를 Google의 **데모 동영상 → YouTube 링크**에 입력합니다. 제한 없이 심사자가 볼 수 있어야 합니다. 영상에는 OAuth 동의 과정과 각 요청 권한으로 구현된 실제 기능을 포함합니다.

브랜딩이 **Ready to publish**이면 브랜딩 게시까지 완료하고, **검증 센터 → 데이터 액세스**에서 권한 사용 사유와 영상을 제출합니다. 검증 대상 앱이 요청하는 권한 목록과 제출한 목록이 일치해야 합니다. 데이터 액세스 검증 결과가 나오기 전에는 미확인 앱 경고가 계속 보일 수 있습니다.

이 문서는 제출 자료 준비 안내입니다. 현재 Google 검증 완료를 증명하거나, 실제 로그인·방송 수신·투표가 검증됐다고 표시하지 않습니다. 제출 영상은 본인 테스트 계정에서 실제 과정을 촬영해야 합니다.
