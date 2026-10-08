const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),zlib=require("node:zlib");
const MAGIC=Buffer.from("SAT3");
function captureKey(directory,storage){
  if(!storage.isEncryptionAvailable())throw Error("Windows 암호화 저장소를 사용할 수 없습니다.");
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,"capture-key.enc");
  if(fs.existsSync(file)){const text=storage.decryptString(fs.readFileSync(file));if(!/^[a-f0-9]{64}$/.test(text))throw Error("채팅 암호화 키를 확인하세요.");return Buffer.from(text,"hex");}
  const key=crypto.randomBytes(32);fs.writeFileSync(file+".tmp",storage.encryptString(key.toString("hex")),{flush:true});fs.renameSync(file+".tmp",file);return key;
}
function encode(value,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(MAGIC);const json=Buffer.from(JSON.stringify(value)),raw=json.length>1024?zlib.gzipSync(json,{level:1}):json;const data=Buffer.concat([cipher.update(raw),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),data]);}
function decode(data,key){const cipher=crypto.createDecipheriv("aes-256-gcm",key,data.subarray(4,16));cipher.setAAD(MAGIC);cipher.setAuthTag(data.subarray(16,32));const raw=Buffer.concat([cipher.update(data.subarray(32)),cipher.final()]);return JSON.parse((raw[0]===0x1f&&raw[1]===0x8b?zlib.gunzipSync(raw,{maxOutputLength:512*1024*1024}):raw).toString("utf8"));}
function configure(store,key){const legacy=store.decode.bind(store);store.encode=value=>encode(value,key);store.decode=file=>{const data=fs.readFileSync(file);return data.subarray(0,4).equals(MAGIC)?decode(data,key):legacy(file);};return store;}
module.exports={captureKey,encode,decode,configure};
