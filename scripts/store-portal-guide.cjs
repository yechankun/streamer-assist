const fs = require("node:fs");
const path = require("node:path");
const { xml: escape, packageVersion } = require("./store-config.cjs");

function generateStorePortalGuide(root) {
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const fields = JSON.parse(read("docs/store-portal-fields.json"));
  const listing = JSON.parse(read("docs/store-listing.json"));
  const version = JSON.parse(read("package.json")).version;
  const notes = read(fields.reviewNotes).trim();
  const reason = fields.restrictedCapabilities.runFullTrust;
  const screenshots = ["home-dark", "home-light", "timeline", "viewer-raffle", "live-poll", "donation-vote", "roulette", "settings"];
  if (!reason || reason.length > 500) throw new Error("runFullTrust reason must contain 1–500 characters.");
  if (!notes || notes.length > 4000) throw new Error("Certification notes must contain 1–4000 characters.");
  for (const asset of ["icon-300.png", ...screenshots.map(name => "screenshots/" + name + ".png")]) {
    if (!fs.existsSync(path.join(root, "docs/store-assets", asset))) throw new Error("Missing Store image: " + asset);
  }
  for (const locale of ["ko-kr", "en-us"]) {
    const item = listing[locale];
    if (!item?.description || item.description.length > 10000 || !Array.isArray(item.features) || item.features.length > 20 || !Array.isArray(item.keywords) || item.keywords.length > 7) throw new Error("Invalid Store listing: " + locale);
  }
  for (const english of [false, true]) {
    const t = (ko, en) => english ? en : ko;
    let count = 0;
    const copy = (label, value) => {
      const id = "value-" + (++count);
      return `<div class="field"><label for="${id}">${escape(label)}</label><button type="button" data-copy="${id}">${t("복사", "Copy")}</button><textarea id="${id}" readonly rows="${value.length > 500 ? 8 : value.length > 150 ? 4 : 2}">${escape(value)}</textarea></div>`;
    };
    const table = rows => '<table><tbody>' + rows.map(([label, value]) => `<tr><th scope="row">${escape(label)}</th><td>${escape(value)}</td></tr>`).join("") + '</tbody></table>';
    const section = (title, content) => `<section><h2>${escape(title)}</h2>${content}</section>`;
    const paragraph = text => `<p>${escape(text)}</p>`;
    let body = `<nav><a href="https://github.com/yechankun/streamer-assist">Streamer Assist</a><a href="${english ? 'store-portal.html' : 'store-portal.en.html'}">${t('English', '한국어')}</a></nav><h1>${t('Microsoft Store 첫 제출 입력 자료', 'Microsoft Store first submission inputs')}</h1>`;
    body += paragraph(`${fields.productId} · v${version} · MSIX ${packageVersion(version)}`);
    body += '<p class="notice">' + t("이 페이지는 입력 자료입니다. 포털에 저장되었거나 제출이 완료되었다는 확인서가 아닙니다. 미완료 항목을 열고 필요한 값을 입력한 뒤 해당 페이지를 저장하세요.", "These are prepared inputs, not evidence that Partner Center saved or accepted them. Open each incomplete page, enter the relevant values and save it.") + '</p>';
    body += section(t("포털 제출과 자동 업데이트", "Portal submission and automatic updates"), paragraph(t("최초 제출에서 Properties·Submission options를 포털에 저장했다면 해당 제출은 포털에서 심사 요청까지 마무리합니다. 첫 게시 후에는 마지막 게시본을 복사한 새 API 업데이트 초안으로 전환합니다. 진행 중인 API 초안을 포털에서 저장하면 API 수정·제출이 막힐 수 있습니다. 포털 전용 항목을 변경해야 할 때는 그 제출을 포털에서 완료하세요. 자동 업데이트 상태와 복구 방법은 Store 설정 가이드를 확인하세요.", "If the first submission's Properties or Submission options are saved in Partner Center, complete certification submission there. After first publication, create a new API update draft copied from the published submission. Saving a pending API draft in Partner Center can prevent further API updates or commits. If Portal-only fields need changes, complete that submission in the Portal. See the Store setup guide for update states and recovery.")) + `<p><a href="${english ? 'store-setup.en.md' : 'store-setup.md'}">${t('Store 설정 가이드', 'Store setup guide')}</a></p>`);
    body += section(t("가격 및 사용 가능 여부", "Pricing and availability"), table([
      [t("가격", "Base price"), t("무료", "Free")],
      [t("대상·검색 노출", "Audience and discoverability"), t("공개 · Store에서 검색 가능", "Public · Available and discoverable in Store")],
      [t("시장", "Markets"), t("현재 선택 유지. 최초 설정의 포털 기본값은 가능한 모든 시장입니다.", "Retain the current selection. The initial Portal default is all possible markets.")],
      [t("게시 시점", "Publishing hold"), t("심사 통과 후 바로 게시", "Publish as soon as certification passes")],
    ]));
    body += section(t("속성", "Properties"), table([
      [t("기본 카테고리", "Primary category"), t("유틸리티 및 도구", "Utilities & tools")],
      [t("보조 카테고리", "Secondary category"), t("비워둠", "Leave empty")],
      [t("개인정보 접근·수집·전송", "Accesses, collects or transmits personal information"), t("예 — 채팅·닉네임·계정 정보 처리", "Yes — chat, nicknames and account information are processed")],
      [t("생성형 AI 기능", "Incorporates generative AI features"), t("선택 — 사용자가 요청하는 선택적 AI 분석", "Check — optional AI analysis requested by the user")],
      [t("접근성 준수·펜/잉크·게임 녹화 선언", "Accessibility conformance, pen/ink and game recording declarations"), t("선택하지 않음", "Leave unchecked")],
      [t("표시 모드", "Display mode"), t("일반 2D 데스크톱. 몰입형·VR·HoloLens 선택하지 않음", "Normal 2D desktop. Immersive/VR/HoloLens options unchecked")],
      [t("추가 하드웨어 요구 사항", "Additional hardware requirements"), t("비워둠 — OS·x64 조건은 패키지에서 결정", "Leave empty — OS and x64 support come from the package")],
      [t("대체 드라이브·이동식 저장소 설치", "Alternate drives/removable storage"), fields.canInstallOnRemovableMedia ? t("선택", "Check") : t("선택하지 않음", "Uncheck")],
      [t("Windows 자동 OneDrive 백업 허용", "Windows automatic OneDrive backups"), fields.automaticBackupEnabled ? t("기존 선택 유지", "Keep the existing checked setting") : t("선택하지 않음", "Uncheck")],
      [t("전화·주소 등 연락처", "Phone/address contact details"), t("개인 계정은 선택 사항. 회사 계정에서 요구하는 경우 실제 계정 소유자 정보를 포털에 입력하세요.", "Optional for individual accounts. If required for a company account, enter the actual account owner's details in the Portal.")],
    ]) + copy(t("개인정보처리방침 URL", "Privacy policy URL"), fields.privacyPolicyUrl) + copy(t("지원 연락처", "Support contact"), fields.supportContact) + copy(t("웹사이트", "Website"), fields.websiteUrl));
    body += section(t("연령 등급", "Age ratings"), paragraph(t("이전에 완료하신 IARC 설문이 현재 초안에서도 완료로 표시되는지 확인하세요. 설문이 다시 나타나면 실제 기능을 기준으로 답해야 합니다. 자동화가 연령 등급을 생성하거나 확인한 상태는 아닙니다.", "Verify that the IARC questionnaire you previously completed is marked complete in this draft. If it reappears, answer based on actual app behavior. Automation has not generated or verified its ratings.")));
    const packageFile = `Streamer-Assist-${version}-x64.msix`;
    body += section(t("패키지", "Packages"), `<p><a href="https://github.com/yechankun/streamer-assist/releases/download/v${escape(version)}/${escape(packageFile)}" download>${escape(packageFile)}</a> · <a href="https://github.com/yechankun/streamer-assist/releases/download/v${escape(version)}/SHA256SUMS.txt">SHA-256</a></p>` + paragraph(t("패키지가 없거나 PendingUpload로만 남아 있으면 이 릴리즈 MSIX를 포털에 업로드하고 검증 결과를 확인하세요. EXE 설치 프로그램은 이 MSIX 제출의 패키지로 사용하지 않습니다.", "If no package is present or it remains PendingUpload, upload this release MSIX in the Portal and verify its validation result. The EXE installer is not the package for this MSIX submission.")) + copy(t("예약된 앱 이름", "Reserved app name"), fields.reservedName));
    for (const locale of ["ko-kr", "en-us"]) {
      const item = listing[locale];
      body += section(t("Store 등록 정보 — ", "Store listing — ") + locale, copy(t("설명", "Description"), item.description) + copy(t("앱 기능 — 한 항목씩 입력", "Features — enter one item per field"), item.features.join("\n")) + copy(t("키워드 — 한 항목씩 입력", "Keywords — enter one item per field"), item.keywords.join("\n")) + copy(t("새로운 기능", "What's new"), item.releaseNotes));
    }
    body += section(t("스크린샷과 로고", "Screenshots and logo"), paragraph(t("각 언어에 같은 실제 제품 화면 8개를 사용합니다. 이미지가 없다면 아래 파일을 내려받아 해당 언어의 데스크톱 스크린샷으로 추가하세요.", "Use these eight actual product screenshots for each language. Download and add them as desktop screenshots if the listing images are missing.")) + '<ul>' + screenshots.map(name => `<li><a href="store-assets/screenshots/${name}.png" download>${name}.png</a></li>`).join("") + '</ul><p><a href="store-assets/icon-300.png" download>' + t("Store 로고 300×300", "Store logo 300×300") + '</a></p>');
    body += section(t("제출 옵션", "Submission options"), paragraph(t("게시 보류는 ‘심사 통과 후 바로 게시’를 선택합니다. 제한 권한 runFullTrust 설명란에는 아래 사유를 입력하세요. 심사 메모란과는 별개입니다.", "Select publish as soon as certification passes. Enter the reason below in the restricted runFullTrust capability field, separately from certification notes.")) + copy(`runFullTrust — ${reason.length}/500`, reason) + copy(t("심사 메모", "Notes for certification") + ` — ${notes.length}/4000`, notes));
    body += section(t("마무리", "Finish"), paragraph(t("현재 초안을 포털에서 수정한 뒤에는 그 초안의 나머지 작업과 제출도 포털에서 이어가세요. API와 포털 수정을 섞으면 Microsoft가 API 수정을 거부할 수 있습니다. 첫 버전이 Published가 된 후부터 CI가 새 릴리즈의 MSIX 업데이트 제출을 처리합니다.", "After editing this draft in the Portal, complete and submit that same draft in the Portal. Mixing Portal and API edits can make Microsoft reject subsequent API changes. Once the first version is Published, CI submits MSIX updates for new releases.")) + '<p><a href="https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission">' + t("Microsoft 필수 항목 안내", "Microsoft required fields") + '</a> · <a href="https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-app-submissions">' + t("API·포털 수정 제약", "API/Portal editing restrictions") + '</a> · <a href="https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/product-declarations">' + t("제품 선언", "Product declarations") + '</a></p>');
    const css = 'html{color-scheme:dark}body{max-width:920px;margin:36px auto;padding:0 24px;background:#111214;color:#e8eaec;font:15px/1.7 system-ui,"Malgun Gothic",sans-serif}nav{display:flex;justify-content:space-between}a{color:#00e6a2}h1{font-size:28px}h2{font-size:21px}section{border-top:1px solid #34373a;margin-top:28px;padding-top:12px}.notice{padding:14px;border:1px solid #527067;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #34373a;padding:10px;text-align:left;vertical-align:top}th{width:36%;font-weight:500;color:#b8bdc3}.field{display:grid;grid-template-columns:1fr auto;gap:8px;margin:18px 0}textarea{grid-column:1/-1;width:100%;box-sizing:border-box;resize:vertical;border:1px solid #45494e;background:#1c1e21;color:#e8eaec;border-radius:6px;padding:12px;font:inherit}button{border:1px solid #527067;border-radius:6px;background:#143b30;color:#e8eaec;padding:6px 16px;cursor:pointer}button:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid #00e6a2;outline-offset:3px}#copy-status{min-height:1.7em;position:sticky;bottom:0;background:#111214;padding:8px 0}@media(max-width:600px){body{padding:0 14px}th{width:42%}}';
    const script = `document.addEventListener("click",async(event)=>{const button=event.target.closest("button[data-copy]");if(!button)return;const field=document.getElementById(button.dataset.copy);const status=document.getElementById("copy-status");try{await navigator.clipboard.writeText(field.value);status.textContent=${JSON.stringify(t("복사했습니다.", "Copied."))};}catch{field.focus();field.select();status.textContent=${JSON.stringify(t("내용을 선택했습니다. Ctrl+C로 복사하세요.", "Text selected. Press Ctrl+C to copy."))};}});`;
    fs.writeFileSync(path.join(root, "docs", english ? "store-portal.en.html" : "store-portal.html"), `<!doctype html><html lang="${english ? 'en' : 'ko'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('Store 제출 입력 자료', 'Store submission inputs')}</title><style>${css}</style></head><body>${body}<p id="copy-status" role="status" aria-live="polite"></p><script>${script}</script></body></html>`);
  }
}
module.exports = { generateStorePortalGuide };
