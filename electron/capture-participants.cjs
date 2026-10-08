const {DatabaseSync}=require("node:sqlite"),path=require("node:path");
const {encode,decode}=require("./capture-codec.cjs");
// Names, identities and roles are authenticated encrypted blobs. The index holds
// only installation-salted participant keys, counts and platform identifiers.
class CaptureParticipants {
  constructor(folder,key,fileName="participants.sqlite"){
    this.key=key;this.db=new DatabaseSync(path.join(folder,fileName));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; CREATE TABLE IF NOT EXISTS actors (key TEXT PRIMARY KEY,platform TEXT,chats INTEGER,donations INTEGER,data BLOB); CREATE INDEX IF NOT EXISTS actors_rank ON actors(chats DESC); CREATE TABLE IF NOT EXISTS ids (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,data BLOB);");
    this.getRow=this.db.prepare("SELECT data FROM actors WHERE key=?");this.hasRow=this.db.prepare("SELECT 1 FROM actors WHERE key=?");
    this.putRow=this.db.prepare("INSERT INTO actors VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET platform=excluded.platform,chats=excluded.chats,donations=excluded.donations,data=excluded.data");
    this.putId=this.db.prepare("INSERT OR IGNORE INTO ids VALUES(?)");this.getId=this.db.prepare("SELECT 1 FROM ids WHERE id=?");this.absent=new Set();
    this.cache=new Map();this.dirty=new Set();this.size=Number(this.db.prepare("SELECT count(*) AS count FROM actors").get().count);this.transaction=false;
  }
  begin(){if(!this.transaction){this.db.exec("BEGIN IMMEDIATE");this.transaction=true;}}
  has(key){return this.cache.has(key)||(!this.absent.has(key)&&!!this.hasRow.get(key));}
  get(key){let item=this.cache.get(key);if(!item){const row=this.getRow.get(key);if(!row){this.absent.add(key);if(this.absent.size>4096)this.absent.delete(this.absent.values().next().value);return;}item=decode(Buffer.from(row.data),this.key);this.cache.set(key,item);}this.dirty.add(key);this.compact();return item;}
  set(key,value){this.begin();if(!this.has(key))this.size++;this.absent.delete(key);this.cache.set(key,value);this.dirty.add(key);this.compact();return this;}
  save(key){const item=this.cache.get(key);if(!item||!this.dirty.has(key))return;this.begin();this.putRow.run(key,item.platform,item.chats||0,item.donations||0,encode(item,this.key));this.dirty.delete(key);}
  compact(){while(this.cache.size>4096){const key=this.cache.keys().next().value;this.save(key);this.cache.delete(key);}}
  remember(id){this.begin();return this.putId.run(id).changes!==0;}
  knownId(id){return !!this.getId.get(id);}
  stats(){const row=this.db.prepare("SELECT data FROM meta WHERE key='stats'").get();return row?decode(Buffer.from(row.data),this.key):null;}
  commit(state){for(const key of this.dirty)this.save(key);this.begin();this.db.prepare("INSERT OR REPLACE INTO meta VALUES('stats',?)").run(encode({seq:state.seq,analysis:state.analysis.persisted()},this.key));this.db.exec("COMMIT");this.transaction=false;}
  *values(){for(const row of this.db.prepare("SELECT data FROM actors").iterate())yield decode(Buffer.from(row.data),this.key);for(const [key,value]of this.cache)if(!this.hasRow.get(key))yield value;}
  *[Symbol.iterator](){for(const value of this.values())yield[value.key,value];}
  top(limit=30,platform=""){for(const key of this.dirty)this.save(key);const sql=platform?"SELECT data FROM actors WHERE platform=? ORDER BY chats DESC LIMIT ?":"SELECT data FROM actors ORDER BY chats DESC LIMIT ?";return this.db.prepare(sql).all(...(platform?[platform,limit]:[limit])).map(row=>decode(Buffer.from(row.data),this.key));}
  descriptor(){return{storage:"encrypted-sqlite-v1",size:this.size};}
  close(){if(this.transaction)this.db.exec("ROLLBACK");this.db.close();}
}
module.exports={CaptureParticipants};
