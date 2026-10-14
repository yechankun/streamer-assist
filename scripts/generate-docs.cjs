const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const {xml:escape}=require("./store-config.cjs");
const {siteConfig}=require("./site-config.cjs");
const {alternateLinks,generateSearchFiles}=require("./site-seo.cjs");
const {publicUrl}=siteConfig(root);
function page(policy,language,other,file){
 const sections=policy.sections.map(section=>"<section><h2>"+escape(section.title)+"</h2>"+section.paragraphs.map(p=>"<p>"+escape(p)+"</p>").join("")+(section.links||[]).map(link=>"<p><a href=\""+escape(link.url)+"\">"+escape(link.label)+"</a></p>").join("")+"</section>").join("");
 const english=language==="en";
 const kind=file.startsWith("privacy")?"privacy":"terms";
 const description=kind==="privacy"
  ?(english?"How Streamer Assist handles platform connections, locally stored broadcast and chat records, optional AI services, and data deletion.":"Streamer Assist의 플랫폼 연결, 로컬 방송·채팅 기록, 선택적 AI 서비스 및 데이터 삭제에 관한 개인정보처리방침입니다.")
  :(english?"Terms for using Streamer Assist, a Windows app for broadcast archives and audience tools, including platform connections and user responsibilities.":"Windows 방송 기록·시청자 참여 도구 Streamer Assist의 이용 조건, 플랫폼 연결 및 사용자 책임에 관한 이용약관입니다.");
 const metadata='<meta name="description" content="'+escape(description)+'"><link rel="canonical" href="'+escape(new URL(file+".html",publicUrl).href)+'">'+alternateLinks(publicUrl,kind+".html",kind+".en.html");
 return '<!doctype html><html lang="'+language+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(policy.title)+'</title>'+metadata+'<style>body{max-width:840px;margin:48px auto;padding:0 24px;color:#e8eaec;background:#111214;font:16px/1.85 system-ui,"Malgun Gothic",sans-serif}h1{font-size:28px}h2{font-size:20px;margin-top:36px}p{color:#b4b8be}a{color:#00e6a2}footer{margin:48px 0;border-top:1px solid #333;padding-top:20px;font-size:13px}nav{display:flex;gap:20px}</style></head><body><nav><a href="'+(english?"index.en.html":"./")+'">Streamer Assist</a><a href="'+other+'">'+(english?"한국어":"English")+'</a></nav><h1>'+escape(policy.title)+'</h1><p>'+(english?"Effective date: ":"적용일: ")+escape(policy.version)+'<br>'+(english?"Operator: ":"운영자: ")+escape(policy.operator)+'</p>'+sections+'<footer><a href="'+escape(policy.contactUrl)+'">'+(english?"Privacy questions":"개인정보 처리 문의")+'</a> · <a href="https://github.com/yechankun/streamer-assist/blob/main/docs/'+(english?"certification.en.md":"certification.md")+'">'+(english?"Review walkthrough":"기능·심사 안내")+'</a></footer></body></html>';
}
fs.mkdirSync(path.join(root,"docs"),{recursive:true});
for(const [file,language,other] of [["privacy","ko","privacy.en.html"],["privacy.en","en","privacy.html"],["terms","ko","terms.en.html"],["terms.en","en","terms.html"]]){
 const policy=JSON.parse(fs.readFileSync(path.join(root,"resources",file+".json"),"utf8"));
 fs.writeFileSync(path.join(root,"docs",file+".html"),page(policy,language,other,file));
}
require("./homepage.cjs").generateHomePages(root);
generateSearchFiles(root);
if(!process.argv.includes("--privacy-only"))require("./store-portal-guide.cjs").generateStorePortalGuide(root);
console.log(process.argv.includes("--privacy-only")?"Generated Korean and English home, privacy and terms pages, sitemap and robots.txt.":"Generated Korean and English home, privacy and terms pages, sitemap, robots.txt and Store submission inputs.");
