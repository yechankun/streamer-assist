# Google OAuth 승인 결과와 검증 제출 자료

## 확인된 승인 범위

2026-10-12 Google Third Party Data Safety Team이 다음 OAuth 앱 검증 요청의 승인을 이메일로 통보했습니다.

| 항목 | 확인된 내용 |
| --- | --- |
| Google Cloud 프로젝트 | `streamer-assist-510517` |
| 프로젝트 번호 | `74696803905` |
| 승인된 권한 | `https://www.googleapis.com/auth/youtube.force-ssl` |
| 근거 | [Google 승인 알림](https://mail.google.com/mail/u/0/#all/1a12edd38df14a26) (메일 접근 권한 필요) |

이 권한은 YouTube 실시간 채팅 읽기와 사용자가 요청한 기본 실시간 투표 생성·종료에 사용합니다. 승인은 이 프로젝트의 위 권한에 한정되며, 다른 민감한·제한된 권한이나 YouTube 분석 기능별 정책 허가까지 뜻하지 않습니다. 승인 메일은 새 권한이나 OAuth 동의 화면 구성 변경 시 새 검증 요청이 필요하다고 안내합니다. **변경 없는 기존 승인 범위는 다시 제출하지 않습니다.**

현재 저장소의 `package.json` 버전은 **0.4.2**입니다. [구현·실환경 점검](google-oauth-readiness.ko.md)은 0.4.1 당시 제출 준비 기록과 이후 승인 결과를 구분합니다. 연결 전 동의·보관·철회와 비공식 YouTube 다시보기 수집 제거의 구현 설명 및 아래 제출 자료는 보존합니다.

## 승인과 별도로 확인할 항목

- 실제 Windows 설치 앱에서 Google 로그인·동의·콜백과 토큰 갱신이 성공하는지 확인합니다.
- 실제 계정·활성 방송에서 채팅 수신과 YouTube 기본 투표 생성·종료가 성공하는지 확인합니다.
- WACK 및 Microsoft Store 심사·게시 상태는 별도로 확인합니다. Google 승인은 이들의 통과를 의미하지 않습니다.
- 실제 공개 설치 버전의 동의·보관·철회 동작과 분석 기능별 정책 적용 범위를 확인합니다. 승인 메일만으로 전체 준수나 실환경 검증 완료를 주장하지 않습니다.

2026-10-16 저장소 점검에서 `electron/oauth.cjs`의 요청 권한은 승인된 `youtube.force-ssl`과 일치했습니다. `electron/oauth-config.json`의 기본 Client ID는 `74696803905-6p9hj54udubvn0f563pm5vvg08jsgteu.apps.googleusercontent.com`이며 번호 접두사가 승인된 프로젝트 번호와 일치합니다. 다만 이 일치만으로 실제 Cloud 설정이나 배포 설정까지 확인된 것은 아닙니다.

`scripts/package.cjs`는 `GOOGLE_DESKTOP_CLIENT_ID`가 있으면 기본 ID를 대체하고, `GOOGLE_DESKTOP_CLIENT_SECRET`을 별도 패키지 리소스에 넣습니다. 릴리즈 워크플로는 Actions Variables/Secrets에서 이를 받습니다. 이번 점검에서는 Google Cloud 콘솔에 접근하지 못했으며 Actions의 실제 설정값과 배포 패키지도 대조하지 못했습니다. Cloud에서 클라이언트 소속·Desktop app 유형, 동의 화면 게시·데이터 액세스 승인 상태와 실제 배포용 Client ID의 일치를 확인해야 합니다. 비밀키·사용자 토큰은 문서에 기록하지 않습니다.

아래 사용 사유·촬영·제출 절차는 **기존 제출 자료와 변경 시 참고용**입니다. 이미 승인된 요청을 다시 촬영·제출해야 한다는 뜻이 아닙니다.

## 범위 사용 사유

Google의 **범위가 어떤 방식으로 사용됩니까?** 입력란에는 [붙여 넣기용 영문 설명](google-oauth-scope-justification.txt)의 본문만 입력합니다. 1,000자 이내이며 실제 구현된 YouTube 기능을 설명합니다.

핵심 이유는 방송 채널·활성 방송·채팅 조회뿐 아니라, 사용자가 요청한 **YouTube 기본 실시간 투표의 생성과 종료**입니다.

| 실제 기능 | 구현 | 공식 요구사항 |
| --- | --- | --- |
| Google 동의 요청 | `electron/oauth.cjs`에서 `youtube.force-ssl` 요청 | 민감한 권한 검증: 2026-10-12 승인 |
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

### 로컬 촬영 도구

`node scripts/prepare-oauth-demo.cjs`는 FFmpeg 공식 다운로드 안내에 연결된 Windows 빌드를 고정 버전·SHA-256으로 검증하고 `release/google-oauth-demo/record-demo.cmd`를 준비합니다. 전역 설치나 계정 연결·녹화는 자동 시작하지 않습니다. 녹화 제어 창에서 **촬영용 앱 열기 → 촬영 영역 선택 → 녹화 시작** 순서로 진행합니다. 앱과 브라우저를 선택 영역 안에, 제어 창은 밖에 둡니다.

- **F6**: 녹화 시작·일시 중지·재개. 비밀번호·인증 코드 입력 전에 멈추고 입력 후 재개합니다.
- **F7**: 다음 실제 장면. 현재 구간을 저장하고 다음 구간으로 이어 찍습니다.
- **F8**: 녹화 종료·영어 자막을 포함한 1920×1080 MP4 생성. 마이크·컴퓨터 소리는 녹음하지 않습니다.

장면별 동작·영어 문구는 [촬영 구성](../scripts/oauth-demo-scenes.json)에 있습니다. 촬영용 앱은 현재 빌드의 실제 앱·OAuth·API를 사용하고 기록·설정만 별도 로컬 프로필에 저장합니다. 일반 설치의 기록을 복사하거나 생성 채팅으로 인증 영상을 대체하지 않습니다. Google 토큰 철회는 같은 계정의 이 앱 승인에도 영향을 줄 수 있으므로 별도 테스트 계정을 사용합니다.

세션 폴더에는 원본 `segments/`, `captions.en.srt`, `recording.json`, `google-oauth-demo.mp4`, `review.json`이 남습니다. 장면 선택과 자막만으로 실제 Google 동의·API 성공을 판정하지 않습니다. 비밀번호·인증 코드·키가 보이지 않는지, 동의와 실제 방송·투표 성공 장면이 모두 있는지 검토한 뒤 업로드합니다. `recorder-smoke.mp4`는 도구 자체를 확인한 테스트 영상이며 제출하지 않습니다.

OBS 촬영은 기존 설치·프로필·장면 모음을 사용합니다. 별도 OBS를 실행하거나 동시송출 플러그인을 제외하지 않습니다. 저장된 기존 OBS WebSocket 설정으로 `node scripts/obs-demo-control.cjs GetRecordStatus`처럼 제어할 수 있습니다. 현재 설치에서 충돌한 `GetOutputList`는 도구에서 차단하며, 추가 출력은 이름을 지정하여 조회합니다. 자세한 작업 제한은 [OBS 작업 규칙](../AGENTS.md)에 있습니다.

송출과 녹화의 인코더를 분리하고, 각 녹화의 실제 프레임과 브라우저 캡처를 확인합니다. 모든 구간의 시간 기준을 정규화한 뒤 자막을 합치며, 최종 영상의 길이와 초당 30프레임을 검사합니다. OAuth client ID는 주소를 바꾸지 않고 실제 주소 표시줄의 해당 문자열을 선택하여 보여줍니다. Google 승인을 누른 뒤 인증 코드가 붙는 로컬 복귀 화면은 녹화에서 제외합니다.

앱의 Google 로그인 대기 시간은 10분입니다. 대기 시간이 지나 로컬 수신 서버가 닫혔다면 앱에서 새 연결 요청을 시작합니다. 만료된 주소를 새로고침해서 이어 승인하지 않습니다. 권한 철회 안내 창을 취소한 영상은 철회·삭제를 실행했다는 증거로 설명하지 않습니다.

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

## 영상 제출 (기존 절차 참고)

영상은 YouTube에 **일부 공개(Unlisted)**로 업로드하고 실제 공유 링크를 Google의 **데모 동영상 → YouTube 링크**에 입력합니다. 제한 없이 심사자가 볼 수 있어야 합니다. 영상에는 OAuth 동의 과정과 각 요청 권한으로 구현된 실제 기능을 포함합니다.

승인 전 절차는 브랜딩이 **Ready to publish**이면 브랜딩 게시까지 완료하고, **검증 센터 → 데이터 액세스**에서 권한 사용 사유와 영상을 제출하는 것이었습니다. 검증 대상 앱이 요청하는 권한 목록과 제출한 목록이 일치해야 합니다. 기존 `youtube.force-ssl` 요청은 승인됐으므로 같은 요청을 다시 제출하지 않습니다.

승인 결과의 근거는 위 Google 알림이며, 촬영 안내 자체는 실제 Windows 설치 앱의 로그인·방송 수신·투표 성공을 증명하지 않습니다. 향후 제출 자료가 필요한 변경에서는 본인 테스트 계정에서 실제 과정을 촬영해야 합니다.
