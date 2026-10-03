module.exports = function parseUri(input) {
  const source = String(input);
  if (source.length > 16384) throw new Error('URI too long');
  const url = new URL(source.includes('://') ? source : `https://${source}`);
  return {
    source,
    protocol: url.protocol.slice(0, -1),
    authority: url.host,
    userInfo: url.username ? `${url.username}${url.password ? `:${url.password}` : ''}` : '',
    user: url.username,
    password: url.password,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port,
    relative: `${url.pathname}${url.search}${url.hash}`,
    path: url.pathname,
    directory: url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1),
    file: url.pathname.slice(url.pathname.lastIndexOf('/') + 1),
    query: url.search.slice(1),
    anchor: url.hash.slice(1)
  };
};
