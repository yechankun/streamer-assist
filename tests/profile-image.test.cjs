const {test}=require('node:test');
const assert=require('node:assert/strict');
const {profileImage,allowedImageUrl}=require('../electron/profile-image.cjs');
const url='https://yt3.ggpht.com/avatar.png';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2]);
test('CHZZK loads a small CDN thumbnail for oversized avatars and preserves other URL parameters', async () => {
  const original = 'https://nng-phinf.pstatic.net/channel/image.png?v=2&type=original';
  const preview = 'https://nng-phinf.pstatic.net/channel/image.png?v=2&type=f120_120';
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url);
    return new Response(url === preview ? png : Buffer.alloc(5799387), {headers:{'Content-Type':'image/png'}});
  };
  assert.equal(await profileImage(original, fetcher), 'data:image/png;base64,' + png.toString('base64'));
  assert.deepEqual(requests, [preview]);
});
test('a missing CHZZK thumbnail falls back to the bounded original and an already-sized URL is requested once', async () => {
  const original = 'https://nng-phinf.pstatic.net/channel/image.png';
  const preview = original + '?type=f120_120';
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url);
    return url === original ? new Response(png, {headers:{'Content-Type':'image/png'}}) : new Response(null, {status:404});
  };
  assert.equal(await profileImage(original, fetcher), 'data:image/png;base64,' + png.toString('base64'));
  assert.deepEqual(requests, [preview, original]);
  requests.length = 0;
  assert.equal(await profileImage(preview, fetcher), '');
  assert.deepEqual(requests, [preview]);
});
test('profile images allow only HTTPS platform CDNs and reject remote redirects and active image formats',async()=>{
  for(const value of ['http://yt3.ggpht.com/a','https://yt3.ggpht.com.evil.org/a','https://name:pass@yt3.ggpht.com/a','https://localhost/a','https://yt3.ggpht.com:8000/a','data:image/png;base64,AA=='])assert.equal(allowedImageUrl(value),'');
  for(const value of [url,'https://static-cdn.jtvnw.net/a','https://nng-phinf.pstatic.net/a'])assert.equal(allowedImageUrl(value),value);
  let calls=0;
  assert.equal(await profileImage('https://evil.org/a',()=>{calls++;}), '');assert.equal(calls,0);
  assert.equal(await profileImage(url,async(_,options)=>{assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}});}), '');
  assert.equal(await profileImage(url,async()=>new Response('<svg/>',{headers:{'Content-Type':'image/png'}})),'');
  assert.equal(await profileImage(url,async()=>{throw Error('redirect');}),'');
});
test('profile bytes are bounded and only validated raster bytes reach thumbnail conversion',async()=>{
  let converted=0;
  assert.equal(await profileImage(url,async()=>new Response(png,{headers:{'Content-Type':'image/png'}}),bytes=>{converted++;assert.deepEqual(bytes,png);return 'data:image/png;base64,thumbnail';}),'data:image/png;base64,thumbnail');
  assert.equal(converted,1);
  for(const headers of [{'Content-Type':'image/png','Content-Length':'524289'},{'Content-Type':'text/plain'}])assert.equal(await profileImage(url,async()=>new Response(png,{headers})),'');
  let canceled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(524289));},cancel(){canceled=true;}});
  assert.equal(await profileImage(url,async()=>new Response(stream,{headers:{'Content-Type':'image/png'}})),'');assert.ok(canceled);
  assert.equal(await profileImage(url,async()=>new Response(png,{headers:{'Content-Type':'image/png'}})),`data:image/png;base64,${png.toString('base64')}`);
});
