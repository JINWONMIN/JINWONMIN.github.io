---
title: "Part 9: Why My Blog Was Invisible to Search Engines"
date: 2026-04-11
description: I did everything right for SEO — then opened the built HTML and found an empty page
tags:
  - SEO
  - Next.js
  - GitHub Pages
series: Blog Dev Story
seriesOrder: 9
---

## I Thought SEO Was Done

After [Part 7: Copy Protection and SEO in One Shot](/en/posts/copy-protection-and-seo), the blog had JSON-LD, Open Graph, robots.txt, and sitemap hreflang all in place. A follow-up PR added `<html lang>` attributes, Twitter cards, a custom 404 page, lazy loading, enriched JSON-LD, and expanded sitemap hreflang coverage. I submitted the sitemap to Google Search Console and registered the site with Naver Webmaster.

**Nothing showed up.** Searching `site:jinwonmin.github.io` on Google returned zero results. Naver was the same. No matter how carefully you craft meta tags, if the HTML the crawler reads is empty, none of it matters.

***

## Opening the Built HTML

To find the problem, I inspected the build output directly — the HTML files under `out/` after `next build`.

### The homepage: body was empty

The `<body>` of `out/ko.html` contained just 36 characters of footer text. No header, no post listing, no h1 tag. To a crawler, this was effectively a blank page.

### Post detail pages: perfectly fine

In contrast, a post page like `out/ko/posts/api-key-auth.html` had 4,682 characters of properly rendered body content. Because the markdown-to-HTML output is inserted via `dangerouslySetInnerHTML`, the full article body is present in the static HTML.

| Page | Body text | Key tags | Crawler perception |
| --- | --- | --- | --- |
| Home (`ko.html`) | 36 chars (footer only) | No h1, no article | Blank page |
| Post detail | 4,682 chars | h1, article, p — all present | Normal |

When the homepage is blank, crawlers conclude the site has no content. Even if individual post pages are perfect, a blocked entry point means no indexing.

***

## The Cause: BAILOUT_TO_CLIENT_SIDE_RENDERING

A closer look at the Next.js build log revealed warnings:

```plain
BAILOUT_TO_CLIENT_SIDE_RENDERING
  Header.tsx:14
  HomeContent.tsx:30
```

**`useSearchParams()` was the culprit.** In Next.js static export, calling `useSearchParams()` causes the entire component to bail out of server rendering. It only renders after client JS loads — which means crawlers that don't execute JS (notably Naver's Yeti bot) never see that component at all.

Both `Header.tsx` and `HomeContent.tsx` were calling `useSearchParams()`, causing the header and the entire post listing to be missing from the static HTML.

***

## The Fix

### Phase 1: Removing dead code from Header

`Header.tsx` was calling `useSearchParams()`, but the return value was never used anywhere. Line 33 used `new URLSearchParams(window.location.search)` directly — making the `useSearchParams()` call pure dead code.

```typescript
// Header.tsx — before removal
import { useSearchParams } from "next/navigation";
// ...
const searchParams = useSearchParams(); // return value unused
```

Removing the import and the call dropped BAILOUT from 2 to 1. **Headers started appearing in the static HTML across all pages.**

### Phase 2: Adding a Suspense fallback for HomeContent

The `useSearchParams()` call in `HomeContent.tsx` was not dead code. It was actively used for filter initialization and URL synchronization — the `?q=`, `?tag=`, `?series=` query parameter handling built in [Part 8: UX Improvements (1) — Search and Dark Mode](/en/posts/search-and-darkmode).

Removing it would break logo-click filter reset and browser back-button URL sync. I needed a fix that didn't touch the component's functionality.

**Solution: provide meaningful content in the `<Suspense>` fallback.**

```typescript
// src/app/[locale]/page.tsx
<Suspense fallback={<StaticPostList posts={latestPosts} locale={locale} />}>
  <HomeContent posts={posts} locale={locale} dict={dict} />
</Suspense>
```

Without touching `HomeContent`, I added a fallback to the `<Suspense>` boundary in `[locale]/page.tsx`. The fallback statically renders the 5 most recent posts as `PostCard` components. At server render time, this fallback is what goes into the HTML. Once client JS loads, `HomeContent` hydrates and replaces the fallback.

| Metric | Before | After |
| --- | --- | --- |
| Body text | 36 chars (footer) | 774 chars |
| h1 tag | None | "Latest" |
| h2 tags | None | 5 post titles |
| article tags | None | 5 |

The HTML that crawlers read now contains titles, descriptions, and links.

### Phase 3: meta refresh for root redirect

`src/app/page.tsx` used `redirect('/ko')`. Next.js `redirect()` is JS-only, so crawlers that don't execute JS couldn't navigate from `/` to `/ko`.

```typescript
// src/app/page.tsx — after change
<meta httpEquiv="refresh" content="0;url=/ko" />
<link rel="canonical" href="https://jinwonmin.github.io/ko/" />
<a href="/ko">minsnote</a>
```

`<meta http-equiv="refresh">` is an HTML standard that every crawler recognizes. The canonical points to `/ko`, and a fallback link covers environments where neither JS nor meta refresh works.

### Phase 4: canonical URLs on every page

Previously, only post detail pages had canonical URLs set. The home, about, tags, and tags/[tag] pages had none.

```typescript
// src/app/[locale]/layout.tsx — canonical + alternates added
alternates: {
  canonical: `https://jinwonmin.github.io/${locale}/`,
  languages: { ko: "/ko/", en: "/en/" },
}
```

On a multilingual site, having ko/en pages without canonical declarations can cause search engines to flag them as duplicate content. Adding canonical and alternates languages to every page prevents this.

### Phase 5: Improving the description

```plain
Before (ko): "Random musings about this and that ~~"
After  (ko): "Dev notes on web development, monitoring, and infrastructure — Next.js, Prometheus, Cloudflare Workers, and more"
```

The site description appears directly in search result snippets. The old one conveyed nothing about the actual content. The new version explicitly names the technologies covered.

### Phase 6: Unifying URLs with trailingSlash

Added `trailingSlash: true` to `next.config.ts`.

| Aspect | Before | After |
| --- | --- | --- |
| File structure | `ko.html` | `ko/index.html` |
| URL | `/ko` | `/ko/` |
| GitHub Pages | Occasional 404 | Stable serving |

GitHub Pages can serve `ko.html` as `/ko`, but trailing slash inconsistencies may cause redirects. With `trailingSlash: true`, Next.js generates `ko/index.html`, which GitHub Pages serves reliably. Sitemap, canonical, and JSON-LD URLs were all updated to include the trailing slash.

Since the site had zero indexed URLs at this point, the URL change carried no risk. It was the ideal time to establish a consistent URL scheme from scratch.

***

## Final Verification

| Check | Result |
| --- | --- |
| Home static HTML | header + h1 + 5 h2 tags + 5 articles |
| Post detail | title, description, canonical, OG, JSON-LD all present |
| Sitemap | 75 URLs, trailing slash unified, hreflang set |
| robots.txt | Allow /, Yeti allowed, sitemap declared |
| Root `/` | meta refresh redirects to `/ko/` |
| Canonical | Set on home, about, tags, and all post pages |

The site is now indexable by Google, Naver, Daum, and Bing.

***

## Summary

| Phase | Change | Impact |
| --- | --- | --- |
| 1 | Remove dead `useSearchParams()` from Header | BAILOUT 2 → 1, header in static HTML |
| 2 | Add Suspense fallback for HomeContent | Body 36 → 774 chars, post listing visible |
| 3 | Add meta refresh to root redirect | Crawlers can navigate `/` → `/ko/` |
| 4 | Add canonical to all pages | Prevent multilingual duplicate content |
| 5 | Improve description | Meaningful search snippets |
| 6 | Unify with trailingSlash | URL consistency + GitHub Pages compatibility |

SEO is not just about metadata. The HTML that crawlers read must contain actual content. A single `useSearchParams()` call silently turning an entire page into client-only rendering is a Next.js static export behavior you won't catch unless you inspect the `out/` directory yourself. If I had opened the built HTML even once, this would have been caught much sooner.
