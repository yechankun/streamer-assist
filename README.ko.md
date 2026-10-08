<div align="center">
  <img src="docs/assets/logo.svg" width="80" height="80" alt="Streamer Assist 로고">
  <h1>Streamer Assist</h1>
  <p>치지직·YouTube·Twitch의 방송 채팅을 기록하고, 추첨·투표·룰렛을 진행하는 Windows 앱.</p>
  <p>
    <a href="https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml"><img src="https://github.com/yechankun/streamer-assist/actions/workflows/ci.yml/badge.svg?branch=main" alt="Windows CI"></a>
    <img src="https://img.shields.io/badge/platform-Windows_x64-0078D4?style=flat" alt="Windows x64">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00c78c?style=flat" alt="MIT 라이선스"></a>
  </p>
  <p><a href="README.md">English</a> · <strong>한국어</strong></p>
  <p><a href="#시작하기">시작하기</a> · <a href="#제품-화면">제품 화면</a> · <a href="docs/user-guide.ko.md">사용 가이드</a></p>
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/screenshots/home-light.png">
    <img src="docs/assets/screenshots/home-dark.png" width="1080" alt="방송 타임라인 요약과 네 가지 시청자 참여 도구가 있는 Streamer Assist 워크스페이스">
  </picture>
  <p><sub>샘플 데이터로 촬영한 실제 개발 화면입니다. 현재 화면 언어는 한국어입니다.</sub></p>
</div>

## 주요 기능

- **방송 기록** — 채팅·후원·시청자 수를 모으고, 단축키로 다시 보고 싶은 순간을 남깁니다.
- **시청자 참여** — 시청자를 추첨하고 숫자 투표·지원 후원 투표·가중치 룰렛을 진행합니다.
- **방송 돌아보기** — 채팅을 검색하고 반응 통계를 확인합니다. 원하면 연결한 AI로 선택한 기록을 분석합니다.

도구를 여러 탭·창에 나눠 놓고 글자 크기를 조절할 수 있습니다.


**설정 → 방송 기록**에서 실시간 저장·종료 후 분석·다시보기 수집을 선택할 수 있습니다. 제공되는 YouTube·Twitch·치지직 VOD 채팅을 영상별로 합치고, 실시간 시청자 수·참여 기능을 유지합니다. [수집 방식·전달 한계](docs/timeline-data.ko.md)를 확인하세요.

## 시작하기

**Windows 10/11 x64**에서 사용합니다. [GitHub 릴리즈](https://github.com/yechankun/streamer-assist/releases/latest)에서 설치 파일과 해당 버전의 변경 내용을 확인하세요. 현재 개발 프리뷰입니다.

계정 없이 먼저 체험할 수 있습니다.

1. **방송 타임라인 → 방송 기록 시작**을 누릅니다.
2. **설정 → 일반 → 테스트 채팅**을 켭니다.
3. **시청자 추첨**, **숫자 투표** 또는 **룰렛**을 열어 봅니다.

테스트 채팅은 샘플 메시지를 만들며 실제 결제나 투표 게시를 하지 않습니다. 실제 방송을 연결하려면 **설정 → 플랫폼 연결**을 사용하세요. [사용 가이드](docs/user-guide.ko.md)에서 이어서 안내합니다.

<details>
<summary>소스에서 실행하기</summary>

Node.js 22 이상이 필요합니다.

```powershell
git clone https://github.com/yechankun/streamer-assist.git
cd streamer-assist
npm ci
npm run dev
```

빌드·검사·OAuth 설정은 [개발 가이드](docs/development.ko.md)를 참고하세요.

</details>

## 제품 화면

이미지를 누르면 원본으로 볼 수 있습니다. 모든 화면은 샘플 데이터로 촬영했습니다.

<table>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/timeline.png"><img src="docs/assets/screenshots/timeline.png" alt="방송 시계·동접 그래프·마커"></a><br><strong>방송 기록</strong><br>같은 위치의 탭 메뉴 아래에서 방송 시계, 동접과 기록한 순간을 봅니다.</td>
    <td width="50%"><a href="docs/assets/screenshots/viewer-raffle.png"><img src="docs/assets/screenshots/viewer-raffle.png" alt="시청자 모집과 추첨 결과"></a><br><strong>시청자 추첨</strong><br>채팅 참여자 중 한 명을 뽑습니다.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/screenshots/live-poll.png"><img src="docs/assets/screenshots/live-poll.png" alt="숫자 투표의 실시간 결과"></a><br><strong>숫자 투표</strong><br>시청자의 선택을 실시간으로 보여줍니다.</td>
    <td width="50%"><a href="docs/assets/screenshots/roulette.png"><img src="docs/assets/screenshots/roulette.png" alt="항목별 확률을 보여주는 룰렛"></a><br><strong>가중치 룰렛</strong><br>직접 만든 항목이나 종료된 투표 결과로 돌립니다.</td>
  </tr>
</table>

[채팅·AI·탭 배치·설정 화면도 보기](docs/assets/screenshots/README.md)

<a id="데이터와-플랫폼-참고"></a>

## 알아두기

- 영상·음성은 녹화하지 않습니다. 하이라이트는 채팅 반응으로 찾는 편집 후보입니다.
- 후원 투표는 지원되는 치지직·YouTube 메시지를 집계합니다. Twitch 기본 투표와 Bits 후원 투표는 지원하지 않습니다.
- 기록은 PC에 암호화해 보관합니다. 내보낸 파일은 일반 파일이며, AI 분석은 사용자가 실행할 때 선택한 기록을 외부 CLI/API에 전달합니다.

플랫폼별 연결 조건과 데이터 관리는 [사용 가이드](docs/user-guide.ko.md#플랫폼과-제한)에서 확인하세요.

## 문서

| 하고 싶은 일 | 안내 |
| --- | --- |
| 방송 연결과 도구 사용 | [사용 가이드](docs/user-guide.ko.md) |
| AI 연결과 채팅 분석 | [AI 가이드](docs/ai-integrations.ko.md) |
| 코드 실행·테스트·빌드 | [개발 가이드](docs/development.ko.md) |

[전체 문서](docs/README.md) · [개인정보처리방침](docs/privacy.html)

## 기여와 라이선스

[의견·문제 제보](https://github.com/yechankun/streamer-assist/issues) · [기여 안내](CONTRIBUTING.md#한국어) · [MIT 라이선스](LICENSE)

NAVER·치지직·YouTube·Twitch와 제휴하지 않은 독립 오픈소스 프로젝트입니다.
