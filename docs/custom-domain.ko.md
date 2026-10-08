# 앱 홈페이지 도메인 연결

연결할 Streamer Assist 홈페이지 주소는 `https://streamer-assist.foreground.day/`입니다. 기존 `foreground.day` 사이트와 분리된 하위 도메인으로, 연결 완료 후 앱의 GitHub Pages 콘텐츠를 제공합니다.

## Cloudflare DNS

Cloudflare에서 **foreground.day → DNS → 레코드 → 레코드 추가**를 엽니다.

| 항목 | 값 |
| --- | --- |
| 유형 | CNAME |
| 이름 | streamer-assist |
| 대상 | yechankun.github.io |
| 프록시 상태 | DNS만 — 회색 구름 |
| TTL | 자동 |

대상에는 `https://`나 `/streamer-assist/` 경로를 넣지 않습니다. GitHub Pages의 Custom domain 설정이 이 호스트를 앱 저장소로 연결합니다. 기존 루트·www·메일 레코드는 유지합니다.

## GitHub Pages와 HTTPS

앱 저장소의 **Settings → Pages → Custom domain**에 `streamer-assist.foreground.day`를 저장합니다. DNS 확인과 인증서 발급이 완료되면 **Enforce HTTPS**를 켭니다. 현재 프로젝트는 GitHub Actions로 Pages를 배포하므로 `CNAME` 파일은 필요하지 않으며 GitHub의 Pages 설정을 사용합니다. [GitHub 공식 설정 안내](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

한·영 홈페이지, 개인정보처리방침과 공유용 PNG를 새 도메인에서 열어 확인합니다. 홈페이지의 canonical·Open Graph·언어 링크는 [website.json](../resources/website.json)의 `publicUrl`에서 생성합니다. 이전 GitHub Pages 주소는 설정 후 새 도메인으로 연결되므로, 오래된 개인정보 URL도 정상적으로 이동하는지 확인합니다.

## Google OAuth 입력

| 입력 항목 | 값 |
| --- | --- |
| 애플리케이션 홈페이지 | https://streamer-assist.foreground.day/ |
| 개인정보처리방침 | https://streamer-assist.foreground.day/privacy.html |
| 승인된 도메인 | foreground.day |

Google Cloud 프로젝트 소유자 계정으로 Search Console에 **도메인 속성 `foreground.day`**을 등록하고, Google이 제공한 확인용 TXT 값을 Cloudflare의 루트 DNS에 추가합니다. 이미 해당 계정으로 DNS 소유권을 확인했다면 기존 확인 상태를 사용합니다. 확인용 TXT 값은 Google이 발급한 것을 사용하며 임의로 만들지 않습니다. [Google 공식 도메인 인증 안내](https://support.google.com/cloud/answer/13804266?hl=en)

Store의 현재 심사 중 제출을 포털에서 수정하지 않습니다. 변경된 Store URL 입력 자료는 다음 필요한 제출에 사용합니다. 기존 설치 버전이나 심사 패키지에 들어간 GitHub Pages URL은 새 도메인으로 정상 이동하는지 별도로 확인합니다.
