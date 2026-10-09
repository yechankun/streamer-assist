# Google OAuth 제출 준비 점검

점검일: 2026-10-09. 앱 0.4.1 개발 소스와 공개 문서 리소스 기준입니다. 구현·검증 결과와 Google의 실제 승인 결과를 구분합니다.

## 제출 화면에 입력할 자료

| 항목 | 값·준비 자료 |
| --- | --- |
| 앱 이름 | Streamer Assist |
| 홈페이지 | https://streamer-assist.foreground.day/ |
| 개인정보처리방침 | https://streamer-assist.foreground.day/privacy.html |
| 이용약관 | https://streamer-assist.foreground.day/terms.html |
| 승인된 도메인 | foreground.day |
| OAuth 클라이언트 종류 | Desktop app |
| 요청 권한 | https://www.googleapis.com/auth/youtube.force-ssl |
| 권한 사용 사유 | [영문 설명](google-oauth-scope-justification.txt) |
| 데모 영상 | [촬영 순서](google-oauth-verification.ko.md)에 따라 실제 계정·기능을 촬영하고 일부 공개 URL 입력 |

도메인 소유권, Google 프로젝트·연락처와 브랜딩·민감한 데이터 액세스 승인 상태는 Google 계정에서 확인해야 합니다. 공개 URL이 열린다는 사실만으로 인증 완료를 판단하지 않습니다.

## 구현과 적용 범위

| 항목 | 구현·자료 | 남은 확인 |
| --- | --- | --- |
| 최종 약관·정책 | 한·영 약관과 개인정보처리방침, 홈페이지·앱의 정책 링크 | 공개 배포 URL 및 설치 버전과 문구 일치 확인 |
| 연결 전 동의 | 약관·개인정보·보관 정책 확인창. 체크박스는 미선택. 내용 해시를 저장하고 변경 시 재동의 | 실제 OAuth 영상에 연결 전 확인과 Google 동의를 모두 포함 |
| 기존 기록 | 삭제될 방송·채팅·후원·참여자·시청자·AI 결과를 검토한 뒤 보관 정책 적용 | 실제 운영 기록으로 테스트하지 않음. 사용자 내보내기·외부 제공자 사본은 별도 관리 |
| 보관 | 방송별 최초 수집일부터 최대 30일. 실행 시와 매시간 만료 정리. 다른 플랫폼 원본·수동 마커 보존 | 앱 종료 중 작업은 실행되지 않는 로컬 앱의 처리 방식을 명시 |
| 철회 | Google revoke, 관련 원본·색인·복구 기록·작업·AI 결과 정리. 암호화된 단계별 재시도 | 실제 테스트 계정의 Google 철회 확인은 시연 단계에서 수행 |
| 외부 철회 감지 | 일시 중지에도 최소 24시간마다 토큰·채널 검사. invalid_grant는 정리 요청으로 전환 | 일시적 네트워크 실패를 철회로 오인해 삭제하지 않음 |
| 취득 경로 | YouTube 웹 다시보기 실행·도구 다운로드·파서 제거. 공식 실시간 API 원본만 사용 | [공식 사후 조회 조사](timeline-data.ko.md#youtube-공식-사후-조회-조사): 전체 종료 채팅 API는 미지원 |
| AI 전송 | 제공자·모델·범위·식별 정보 포함·원문 전송을 확인하고 동의. 취소 시 전송 없음 | 제공자 데이터 사용 조건과 YouTube 분석 기능별 정책 적용 범위 확인 |
| 시연 자료 | 실제 계정·방송·기본 투표의 촬영 안내 | 실제 촬영·업로드 및 Google 검증 센터 제출은 아직 별도 작업 |

정리 실패를 완료로 표시하지 않습니다. 만료·철회 검사와 삭제는 앱이 실행 중일 때 수행하며 장기간 종료 후에는 사용 전에 만료 자료를 정리합니다. 이전 정책의 기록은 연결 전 검토·동의를 거쳐 적용합니다. Google 토큰과 원본 기록은 로컬에서 암호화하며 개발자 서버로 보내지 않습니다.

## AI 전송과 파생 데이터 규정의 구분

외부 AI에 데이터를 보낸다는 이유만으로 추가 감사가 무조건 필요하다고 단정하지 않습니다. Google의 일반 사용자 데이터 정책에는 사용자에게 명확한 기능을 제공하기 위해 동의받은 전송의 허용 조건이 있습니다. YouTube 제품 정책도 함께 검토해야 합니다.

YouTube API 데이터로 새 데이터·지표를 만드는 규정은 별도입니다. [추가 정책](https://developers.google.com/youtube/terms/derived-metrics-policy)은 감사·허가 대상 분석의 예시에 댓글 감성 분석을 포함합니다. 본인 채널이라는 이유만으로 모든 분석에 예외가 있다고 보장하거나, 단순 요약도 반드시 추가 감사 대상이라고 확정하지 않습니다. 반응·키워드·참여자 통계와 자유 분석의 데이터·계산·전송·보관 범위를 각각 제시해 Google에 적용 범위를 확인해야 합니다. 허가를 이미 받았다고 표시하지 않습니다.

## 권한 사용 사유

기본 실시간 투표 생성에는 liveChatMessages.insert, 종료에는 liveChatMessages.transition을 사용합니다. 두 메서드가 허용하는 권한은 youtube와 youtube.force-ssl이며 youtube.readonly는 쓰기 동작을 허용하지 않습니다. 최소 권한 설명은 보관·분석·취득 조건까지 충족했다는 확인서가 아닙니다.

## 공식 근거

- [Google 검증 요구사항](https://support.google.com/cloud/answer/13464321)
- [Google 사용자 데이터 정책](https://developers.google.com/terms/api-services-user-data-policy)
- [YouTube 개발자 정책](https://developers.google.com/youtube/terms/developer-policies): 약관·동의, 철회·보관, 스크래핑, 추가 파생 지표 규정
- [YouTube 추가 정책](https://developers.google.com/youtube/terms/derived-metrics-policy)
- [투표 생성](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert) · [투표 종료](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/transition)
