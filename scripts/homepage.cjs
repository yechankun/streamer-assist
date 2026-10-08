const fs = require("node:fs");
const path = require("node:path");
const { xml: escape } = require("./store-config.cjs");

function homePage(english) {
  const t = (ko, en) => english ? en : ko;
  const privacy = english ? "privacy.en.html" : "privacy.html";
  const guide = "https://github.com/yechankun/streamer-assist/blob/main/docs/" + (english ? "user-guide.md" : "user-guide.ko.md");
  const description = t("치지직·YouTube·Twitch의 방송 채팅을 기록하고 추첨·투표·룰렛을 진행하는 Windows 데스크톱 앱입니다.", "A Windows desktop app for broadcast chat archives, viewer raffles, polls and weighted roulette across CHZZK, YouTube and Twitch.");
  const features = [
    ["01", t("방송의 순간을 기록", "Keep the moments"), t("방송 타임라인에 단축키로 마커를 남기고, 시청자 수와 채팅 반응을 함께 돌아봅니다. 영상·음성을 녹화하는 앱은 아닙니다.", "Mark broadcast moments with a shortcut, then review viewer samples and chat reactions. The app does not record video or audio.")],
    ["02", t("시청자와 함께 진행", "Bring viewers into the stream"), t("채팅 참여자 추첨, 숫자 투표, 지원되는 후원 메시지 투표와 가중치 룰렛을 사용합니다. 투표 종료 타이머도 설정할 수 있습니다.", "Run chat-based raffles, number votes, votes from supported donation messages and weighted roulette. Set an optional closing timer for votes.")],
    ["03", t("채팅을 찾고 분석", "Find and understand chat"), t("날짜·플랫폼별로 기록을 검색하고 로컬 통계를 확인합니다. 플랫폼에서 제공되는 다시보기 채팅을 가져와 합칠 수 있습니다.", "Search archives by date and platform, inspect local statistics, and import available platform replay chat into your records.")],
    ["04", t("내 방송에 맞는 배치", "A workspace that fits"), t("도구를 여러 탭·창으로 나누고 배치를 복원합니다. 다크·라이트 테마, 글자 크기와 단축키를 조절할 수 있습니다.", "Arrange tools in tabs and separate windows, restore layouts, and adjust themes, text size and keyboard shortcuts.")],
  ];
  const featureCards = features.map(([number, title, text]) => `<article class="feature"><span class="feature-number">${number}</span><h3>${escape(title)}</h3><p>${escape(text)}</p></article>`).join("\n");
  const steps = [
    [t("설치하고 체험하세요", "Install and try it"), t("Windows 10/11 x64에서 실행합니다. 설정의 테스트 채팅으로 실제 계정이나 결제 없이 주요 도구를 체험할 수 있습니다.", "Run on Windows 10/11 x64. Generated test chat lets you try the main tools without connecting an account or making a payment.")],
    [t("방송 플랫폼을 연결하세요", "Connect your platform"), t("설정 → 플랫폼 연결에서 치지직 채널을 추가하거나 YouTube·Twitch 계정을 연결합니다. 실제 수신에는 플랫폼 권한과 지원되는 방송이 필요합니다.", "In Settings → Platform connections, add a CHZZK channel or connect YouTube/Twitch. Real reception requires platform permissions and a supported broadcast.")],
    [t("기록과 참여를 시작하세요", "Start recording and participation"), t("타임라인에서 방송 기록을 시작하고 추첨·투표를 엽니다. AI 분석은 원할 때 연결한 서비스와 전송 범위를 선택해 직접 실행합니다.", "Start a broadcast record, then open raffles or polls. Optional AI analysis runs when you choose a connected service and record scope and start it.")],
  ].map(([title, text], index) => `<li><span class="step-number">${index + 1}</span><div><h3>${escape(title)}</h3><p>${escape(text)}</p></div></li>`).join("\n");
  return `<!doctype html>
<html lang="${english ? "en" : "ko"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escape(description)}">
  <meta name="theme-color" content="#101413">
  <title>Streamer Assist — ${t("방송 기록과 시청자 참여", "Broadcast archives and audience tools")}</title>
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/homepage.css">
  <link rel="alternate" hreflang="ko" href="https://yechankun.github.io/streamer-assist/">
  <link rel="alternate" hreflang="en" href="https://yechankun.github.io/streamer-assist/index.en.html">
</head>
<body>
  <a class="skip-link" href="#main">${t("본문으로 이동", "Skip to content")}</a>
  <header class="site-header wrap">
    <a class="brand" href="${english ? "index.en.html" : "./"}" aria-label="Streamer Assist ${t("홈", "home")}"><img src="assets/logo.svg" width="38" height="38" alt=""><span>Streamer Assist</span></a>
    <nav aria-label="${t("주 메뉴", "Main navigation")}">
      <a href="#features">${t("기능", "Features")}</a><a href="#youtube">YouTube</a><a href="#support">${t("지원", "Support")}</a>
      <a class="language-link" href="${english ? "./" : "index.en.html"}" lang="${english ? "ko" : "en"}">${t("English", "한국어")}</a>
    </nav>
  </header>
  <main id="main" class="wrap">
    <section class="hero" aria-labelledby="hero-title">
      <div class="eyebrow"><span class="status-dot"></span>Windows 10 / 11 · x64 · ${t("오픈소스", "Open source")}</div>
      <h1 id="hero-title">${t("방송 기록과 시청자 참여,<br>하나의 워크스페이스에서.", "Your broadcast moments.<br>Your audience, together.")}</h1>
      <p class="hero-description">${escape(description)}</p>
      <div class="actions"><a class="button primary" href="https://apps.microsoft.com/detail/9PKRWHZ2CWBG">${t("Microsoft Store에서 받기", "Get it from Microsoft Store")} <span aria-hidden="true">↗</span></a><a class="button secondary" href="https://github.com/yechankun/streamer-assist/releases/latest">${t("GitHub 릴리즈", "GitHub releases")} <span aria-hidden="true">↗</span></a></div>
      <p class="hero-note">${t("현재 앱 화면 언어는 한국어입니다. 설치 파일과 변경 내역은 릴리즈에서 확인하세요.", "The app interface is currently Korean. Find installers and version details in the releases.")}</p>
      <figure class="app-preview"><div class="preview-label"><span class="status-dot"></span>Streamer Assist <span>${t("실제 앱 화면", "Actual app interface")}</span></div><img src="assets/screenshots/home-dark.png" width="1280" height="800" alt="${t("방송 시계와 최근 마커, 추첨·투표·룰렛 도구가 있는 Streamer Assist 화면", "Streamer Assist with a broadcast clock, recent markers, raffles, polls and roulette tools")}" fetchpriority="high"><figcaption>${t("샘플 데이터로 촬영한 실제 개발 화면입니다. 설치 버전별 기능은 릴리즈 노트를 확인하세요.", "Actual development build with generated sample data. Check release notes for the features of your installed version.")}</figcaption></figure>
    </section>
    <section id="features" class="section" aria-labelledby="features-title"><div class="section-heading"><p class="eyebrow">${t("방송 전부터, 방송이 끝난 뒤까지", "Before, during and after the stream")}</p><h2 id="features-title">${t("필요한 도구를 한곳에.", "The tools you need, in one place.")}</h2></div><div class="feature-grid">${featureCards}</div></section>
    <section class="section getting-started" aria-labelledby="start-title"><div><p class="eyebrow">${t("시작하기", "Getting started")}</p><h2 id="start-title">${t("연결 없이 먼저<br>체험해 보세요.", "Try the tools.<br>Then connect your stream.")}</h2><a class="inline-link" href="${guide}">${t("사용 가이드 읽기", "Read the user guide")} <span aria-hidden="true">↗</span></a></div><ol class="steps">${steps}</ol></section>
    <section id="youtube" class="section" aria-labelledby="youtube-title"><div class="section-heading"><p class="eyebrow">${t("Google 계정 연결 안내", "Connecting your Google account")}</p><h2 id="youtube-title">${t("YouTube 방송을 연결하는 이유.", "Why connect YouTube?")}</h2><p>${t("Streamer Assist는 연결한 방송 채널과 활성 방송을 찾고, 실시간 채팅·지원되는 후원 메시지를 받아 기록·추첨·투표 기능에 사용합니다. 지원되는 YouTube 기본 실시간 투표도 연동합니다.", "Streamer Assist identifies your connected channel and active broadcast, then uses live chat and supported donation messages for archives, raffles and votes. It also integrates supported native YouTube live polls.")}</p></div>
      <div class="data-grid"><article class="data-card"><h3>${t("Google에서 직접 승인", "Authorize directly with Google")}</h3><p>${t("계정 연결을 선택하면 기본 브라우저에서 Google 동의 화면이 열립니다. 앱에 Google 비밀번호를 입력하지 않습니다. 승인 여부와 요청 권한은 동의 화면에서 확인할 수 있습니다.", "Connecting an account opens Google's consent screen in your browser. You do not enter your Google password into this app. Review and approve the requested access on Google's screen.")}</p></article><article class="data-card"><h3>${t("이 PC에 보관하는 기록", "Records stored on this PC")}</h3><p>${t("채널 정보와 연결 토큰, 방송·채팅 기록은 이 PC의 앱 프로필에서 관리합니다. 연결 토큰과 원본 기록은 암호화해 보관하며 개발자가 운영하는 애플리케이션 서버로 보내지 않습니다.", "Channel details, connection tokens and broadcast/chat records are managed in the app profile on this PC. Connection tokens and original archives are encrypted and are not sent to a developer-operated application server.")}</p></article><article class="data-card"><h3>${t("연결 해제와 데이터 삭제", "Disconnect and delete")}</h3><p>${t("앱 설정에서 연결을 해제하고 저장된 기록을 삭제할 수 있습니다. Google 계정의 연결된 앱 관리에서도 권한을 철회할 수 있습니다. 직접 내보낸 파일은 사용자가 관리합니다.", "Disconnect accounts and delete saved records in the app. You can also revoke access in your Google account's connected-app settings. You manage files that you export separately.")}</p></article></div>
      <details class="permission-details"><summary>${t("요청 권한과 선택적 AI 분석", "Requested access and optional AI analysis")}</summary><p>${t("앱은 YouTube 연결에 Google의 youtube.force-ssl 권한을 요청합니다. 동의 화면에 표시되는 접근 범위를 확인하고 승인하세요. 앱의 실제 기능은 방송 조회·채팅 수신·지원되는 투표 연동이며, Google API 데이터의 처리 내용은 개인정보처리방침에서 확인할 수 있습니다.", "The app requests Google's youtube.force-ssl permission for YouTube connections. Review the access shown on the consent screen before approving. The app uses it for broadcast lookup, chat reception and supported poll integration; the privacy policy explains how Google API data is handled.")}</p><p>${t("외부 AI 분석은 선택 사항입니다. 사용자가 서비스를 연결하고 기록 범위와 요청을 선택해 실행할 때 해당 외부 서비스로 기록과 요청을 전송합니다. AI 서비스의 처리·보관·요금은 각 제공자의 정책을 따르며, 원하지 않으면 로컬 통계만 사용할 수 있습니다.", "External AI analysis is optional. Records and your prompt are sent to the selected external service only when you connect it, select a record scope and start analysis. Provider policies govern processing, retention and fees. You can use local statistics without AI.")}</p></details>
      <a class="inline-link" href="${privacy}">${t("개인정보처리방침에서 자세히 보기", "Read the full privacy policy")} <span aria-hidden="true">→</span></a>
    </section>
    <section id="support" class="section support" aria-labelledby="support-title"><div><p class="eyebrow">${t("프로젝트와 지원", "Project and support")}</p><h2 id="support-title">${t("사용 중 궁금한 점이 있나요?", "Need a hand?")}</h2><p>${t("개발·운영: yechankun (Store 게시자: Yeong). 오류 제보와 기능 요청은 GitHub Issues에서 받습니다. 공개 게시판에는 계정 토큰이나 개인정보를 올리지 마세요.", "Developed and maintained by yechankun (Store publisher: Yeong). Report issues or request features through GitHub Issues. Do not post account tokens or personal information publicly.")}</p></div><div class="support-links"><a class="button secondary" href="https://github.com/yechankun/streamer-assist/issues">${t("문의·오류 제보", "Support and bug reports")} <span aria-hidden="true">↗</span></a><a class="inline-link" href="https://github.com/yechankun/streamer-assist">${t("소스 코드 보기", "View the source code")} <span aria-hidden="true">↗</span></a></div></section>
  </main>
  <footer class="site-footer wrap"><div><a class="brand" href="${english ? "index.en.html" : "./"}"><img src="assets/logo.svg" width="28" height="28" alt=""><span>Streamer Assist</span></a><p>${t("치지직·NAVER·YouTube·Google·Twitch와 제휴하지 않은 독립 오픈소스 프로젝트입니다.", "An independent open-source project, not affiliated with CHZZK, NAVER, YouTube, Google or Twitch.")}</p></div><nav aria-label="${t("정책과 프로젝트", "Policies and project")}"><a href="${privacy}">${t("개인정보처리방침", "Privacy policy")}</a><a href="https://github.com/yechankun/streamer-assist/blob/main/LICENSE">MIT ${t("라이선스", "license")}</a><a href="${english ? "./" : "index.en.html"}" lang="${english ? "ko" : "en"}">${t("English", "한국어")}</a></nav></footer>
</body>
</html>\n`;
}

function generateHomePages(root) {
  fs.writeFileSync(path.join(root, "docs/index.html"), homePage(false));
  fs.writeFileSync(path.join(root, "docs/index.en.html"), homePage(true));
}
module.exports = { generateHomePages };
