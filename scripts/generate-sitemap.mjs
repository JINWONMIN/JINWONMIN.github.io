import fs from "fs";
import path from "path";
import matter from "gray-matter";

const BASE_URL = "https://jinwonmin.github.io";
const locales = ["ko", "en"];
const outDir = path.join(process.cwd(), "out");

function getPostsForLocale(locale) {
  const postsDir = path.join(process.cwd(), "posts", locale);
  if (!fs.existsSync(postsDir)) return [];
  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const content = fs.readFileSync(path.join(postsDir, file), "utf8");
    const { data } = matter(content);
    return {
      slug: file.replace(/\.md$/, ""),
      date: new Date(data.date).toISOString().split("T")[0],
      tags: data.tags || [],
    };
  });
}

const today = new Date().toISOString().split("T")[0];
const urls = [];

// Root redirect
urls.push(
  `<url><loc>${BASE_URL}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`
);

for (const locale of locales) {
  const posts = getPostsForLocale(locale);
  const tags = new Set();
  posts.forEach((p) => p.tags.forEach((t) => tags.add(t)));

  // Home
  urls.push(
    `<url><loc>${BASE_URL}/${locale}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority><xhtml:link rel="alternate" hreflang="ko" href="${BASE_URL}/ko/"/><xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/en/"/></url>`
  );

  // About
  urls.push(
    `<url><loc>${BASE_URL}/${locale}/about/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority><xhtml:link rel="alternate" hreflang="ko" href="${BASE_URL}/ko/about/"/><xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/en/about/"/></url>`
  );

  // Tags index
  urls.push(
    `<url><loc>${BASE_URL}/${locale}/tags/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority><xhtml:link rel="alternate" hreflang="ko" href="${BASE_URL}/ko/tags/"/><xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/en/tags/"/></url>`
  );

  // Posts
  posts.forEach((p) => {
    urls.push(
      `<url><loc>${BASE_URL}/${locale}/posts/${p.slug}/</loc><lastmod>${p.date}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority><xhtml:link rel="alternate" hreflang="ko" href="${BASE_URL}/ko/posts/${p.slug}/"/><xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/en/posts/${p.slug}/"/></url>`
    );
  });

  // Tag pages
  Array.from(tags).forEach((tag) => {
    urls.push(
      `<url><loc>${BASE_URL}/${locale}/tags/${encodeURIComponent(tag)}/</loc><changefreq>weekly</changefreq><priority>0.6</priority><xhtml:link rel="alternate" hreflang="ko" href="${BASE_URL}/ko/tags/${encodeURIComponent(tag)}/"/><xhtml:link rel="alternate" hreflang="en" href="${BASE_URL}/en/tags/${encodeURIComponent(tag)}/"/></url>`
    );
  });
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>`;

fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap);
console.log(`Sitemap generated: ${urls.length} URLs`);
