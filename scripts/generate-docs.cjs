const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const {xml:escape}=require("./store-config.cjs");
function page(policy,language,other){
 const sections=policy.sections.map(section=>"<section><h2>"+escape(section.title)+"</h2>"+section.paragraphs.map(p=>"<p>"+escape(p)+"</p>").join("")+"</section>").join("");
 const english=language==="en", back=english?"README.md":"README.ko.md";
 return '<!doctype html><html lang="'+language+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(policy.title)+'</title><style>body{max-width:840px;margin:48px auto;padding:0 24px;color:#e8eaec;background:#111214;font:16px/1.85 system-ui,"Malgun Gothic",sans-serif}h1{font-size:28px}h2{font-size:20px;margin-top:36px}p{color:#b4b8be}a{color:#00e6a2}footer{margin:48px 0;border-top:1px solid #333;padding-top:20px;font-size:13px}nav{display:flex;gap:20px}</style></head><body><nav><a href="https://github.com/yechankun/streamer-assist/blob/main/'+back+'">Streamer Assist</a><a href="'+other+'">'+(english?"한국어":"English")+'</a></nav><h1>'+escape(policy.title)+'</h1><p>'+(english?"Effective date: ":"적용일: ")+escape(policy.version)+'<br>'+(english?"Operator: ":"운영자: ")+escape(policy.operator)+'</p>'+sections+'<footer><a href="'+escape(policy.contactUrl)+'">'+(english?"Privacy questions":"개인정보 처리 문의")+'</a> · <a href="https://github.com/yechankun/streamer-assist/blob/main/docs/'+(english?"certification.en.md":"certification.md")+'">'+(english?"Review walkthrough":"기능·심사 안내")+'</a></footer></body></html>';
}
fs.mkdirSync(path.join(root,"docs"),{recursive:true});
for(const [file,language,other] of [["privacy","ko","privacy.en.html"],["privacy.en","en","privacy.html"]]){
 const policy=JSON.parse(fs.readFileSync(path.join(root,"resources",file+".json"),"utf8"));
 fs.writeFileSync(path.join(root,"docs",file+".html"),page(policy,language,other));
}
fs.writeFileSync(path.join(root,"docs/index.html"),'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=privacy.html"><a href="privacy.html">개인정보처리방침 · Privacy policy</a>');
console.log("Generated Korean and English privacy pages.");
