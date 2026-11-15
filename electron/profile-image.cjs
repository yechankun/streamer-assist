const MAX_IMAGE = 512 * 1024;
function allowedImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && value.length <= 2048 &&
      (/^(?:yt3\.ggpht\.com|yt3\.googleusercontent\.com|static-cdn\.jtvnw\.net)$/.test(url.hostname) ||
       /^(?:[a-z0-9-]+\.)*pstatic\.net$/.test(url.hostname)) ? url.href : "";
  } catch { return ""; }
}
async function profileImage(value, fetcher = fetch, thumbnail) {
  const url = allowedImageUrl(value);
  if (!url) return "";
  try {
    const response = await fetcher(url, { redirect:"error", credentials:"omit", signal:AbortSignal.timeout(8000) });
    const type = response.headers.get("content-type")?.split(";")[0].toLowerCase();
    if (!response.ok || !["image/png","image/jpeg","image/webp","image/gif"].includes(type) || Number(response.headers.get("content-length")) > MAX_IMAGE) return "";
    const chunks = []; let size = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.length;
          if (size > MAX_IMAGE) { await reader.cancel(); return ""; }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_IMAGE) return "";
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    const valid = type === "image/png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
      type === "image/webp" ? bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP" : /^GIF8[79]a/.test(bytes.toString("ascii",0,6));
    if (!valid) return "";
    return thumbnail ? thumbnail(bytes) : `data:${type};base64,${bytes.toString("base64")}`;
  } catch { return ""; }
}
module.exports = { profileImage, allowedImageUrl };
