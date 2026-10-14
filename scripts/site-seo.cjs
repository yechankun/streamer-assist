const fs = require("node:fs");
const path = require("node:path");
const { xml: escape } = require("./store-config.cjs");
const { siteConfig } = require("./site-config.cjs");

const pageGroups = [
  { ko: "", en: "index.en.html" },
  { ko: "privacy.html", en: "privacy.en.html" },
  { ko: "terms.html", en: "terms.en.html" },
];

function alternateLinks(publicUrl, koreanPath, englishPath) {
  return [["ko", koreanPath], ["en", englishPath]]
    .map(([language, route]) => `<link rel="alternate" hreflang="${language}" href="${escape(new URL(route, publicUrl).href)}">`)
    .join("\n  ");
}

function websiteStructuredData(publicUrl) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": publicUrl + "#website",
    name: "Streamer Assist",
    alternateName: "Streamer-Assist",
    url: publicUrl,
    inLanguage: ["ko", "en"],
  }).replace(/</g, "\\u003c");
}

function generateSearchFiles(root) {
  const { publicUrl } = siteConfig(root);
  const urls = pageGroups.flatMap(group => Object.values(group).map(route => {
    const alternates = Object.entries(group).map(([language, alternate]) =>
      `    <xhtml:link rel="alternate" hreflang="${language}" href="${escape(new URL(alternate, publicUrl).href)}" />`);
    return ["  <url>", `    <loc>${escape(new URL(route, publicUrl).href)}</loc>`, ...alternates, "  </url>"].join("\n");
  }));
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "docs/sitemap.xml"), sitemap);
  fs.writeFileSync(path.join(root, "docs/robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", publicUrl).href}\n`);
}

module.exports = { alternateLinks, websiteStructuredData, generateSearchFiles };
