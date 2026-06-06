---
title: "Part 10: UX Improvements (2) — Navigation and Discovery"
date: 2026-06-06
description: Six touches that shaped the reading experience — progress bar, table of contents, series navigation
tags:
  - UX
  - Navigation
  - Next.js
series: Blog Dev Story
seriesOrder: 10
---

## After Search Came Discovery

In [Part 8: UX Improvements (1) — Search and Dark Mode](/en/posts/search-and-darkmode) I wrote that the next post would cover navigation and discovery — and then [Part 9: The Real Reason Search Wasn't Indexing](/en/posts/seo-exposure-fix) cut in line. I'd just found out the built HTML was a blank page, so SEO had to come first. Once that fire was out, I came back to what I'd actually planned.

If Part 8 was about *finding* a post, this one is about **what happens after you've found it**. Once you opened a post, the blog went quiet. Where am I in this article? Which part of the series is this? What should I read next? The screen said nothing. Scrolling through a long post, I kept wondering "how much is left?", and getting to the next entry in a series meant backing out to the list page. Reading needed a guide rail.

Six things went in this round.

| Area | Component | One-line summary |
| --- | --- | --- |
| While reading | `ReadingProgress` | Top progress bar showing how much is left |
| While reading | `TableOfContents` | TOC with current-section highlight |
| While reading | `ScrollTopButton` | To the top — and back again |
| Between posts | `SeriesNav` / `SeriesArrows` | Move to the previous/next series entry |
| Between posts | `RecentPosts` | Tag-based related-post suggestions |
| Images | `ImageLightbox` | Click an inline image to zoom |

***

## While Reading: Where Am I?

### Progress Bar — How Much Is Left, in One Line

The reading progress bar shows "how far you've read" as a thin bar at the top of the page. The math is trivial: divide the distance scrolled by the total scrollable distance.

```typescript
// src/components/ReadingProgress.tsx
const el = document.documentElement;
const scrollTop = el.scrollTop;
const scrollHeight = el.scrollHeight - el.clientHeight;
setProgress(scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0);
```

That value goes straight into the bar's `width` as a percentage. The reason for subtracting `clientHeight` is that one viewport's worth of content can't be scrolled, so it has to come off the total — otherwise scrolling all the way down never quite reaches 100%.

Three details:

- **Invisible at the top.** When `progress === 0`, the component returns `null`. A 0% bar sitting on an unread post is just clutter.
- **Pinned right under the header.** With `fixed top-16`, an `h-0.5` (2px) bar sits below the header. It stays at the very top of the visual flow without covering anything.
- **Moves smoothly.** `transition-[width] duration-150` lets the bar grow fluidly as you scroll.

For performance, the scroll listener uses `{ passive: true }`. Scroll events fire dozens of times per second; registering them as passive tells the browser it won't call `preventDefault`, so scrolling is handled first. It's a small guard against the bar making scroll feel janky.

### Table of Contents + Scroll Spy — Highlighting Where You Are

The TOC isn't built at build time — it's generated **on mount by scraping the DOM**. The markdown body renders inside a `.prose` container, so querying the `h2` and `h3` elements inside it gives the TOC entries directly.

```typescript
// src/components/TableOfContents.tsx
const elements = Array.from(
  document.querySelectorAll(".prose h2, .prose h3")
);

const items = elements.map((el) => {
  const id =
    el.id ||
    (el.textContent || "")
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/(^-|-$)/g, "");
  if (!el.id) el.id = id;
  return { id, text: el.textContent || "", level: el.tagName === "H2" ? 2 : 3 };
});
```

If a heading has no `id`, one is generated from its text and assigned. The key is that the regex `[^a-z0-9가-힣]+` **includes the Korean syllable range (`가-힣`)**. Without it, a Korean heading collapses into a single `-`, breaking every anchor link. Keeping Korean characters in the id means clicking a TOC entry jumps to the exact section. `h3` entries get `pl-4` indentation to show the hierarchy.

The **scroll spy** that highlights the section you're currently reading is built with `IntersectionObserver`.

```typescript
// src/components/TableOfContents.tsx
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) setActiveId(entry.target.id);
    });
  },
  { rootMargin: "-80px 0px -80% 0px" }
);
```

The trick is `rootMargin: "-80px 0px -80% 0px"`. It trims 80px off the top and 80% off the bottom of the viewport, leaving **a narrow band near the top of the screen** as the observation area. That way, of all the headings filling the screen, only the one that "just crossed the top" becomes active. Without that band, every visible heading would activate at once and the TOC would flicker. The highlight stepping down through the TOC as you scroll is exactly this margin at work.

### Scroll-to-Top Button — Up, Then Back Again

The scroll-to-top button is small but has one clever detail. A "back to top" button usually does one thing: it takes you up, and getting back to where you were reading means scrolling to find it yourself. This button makes a **round trip**.

```typescript
// src/components/ScrollTopButton.tsx
const handleClick = () => {
  if (atTop && savedPosition.current > 0) {
    // At the top → return to the saved position
    window.scrollTo({ top: savedPosition.current, behavior: "smooth" });
    savedPosition.current = 0;
  } else {
    // Scrolled down → save position, then go to top
    savedPosition.current = window.scrollY;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};
```

Press it while scrolled down and it saves the current position to `savedPosition`, then jumps to the top. Press the same button once you're at the top and it returns to the saved spot. The flow covers going up mid-article to check the title or date, then snapping back to where you left off in one tap.

Since the button's meaning changes with state, two things change together. The arrow flips with `rotate-180` to signal "down (back)" instead of "up," and the `aria-label` switches from `"Scroll to top"` to `"Go back to previous position"`. It appears when `scrollY > 300` (scrolled far enough) or when you're at the top but a return position is stored. Every move uses `behavior: "smooth"`.

| State | Action | Arrow | aria-label |
| --- | --- | --- | --- |
| Scrolled down | Save position → go to top | ↑ (default) | Scroll to top |
| At top + saved position | Return to saved position | ↓ (rotated 180°) | Go back to previous position |

***

## Between Posts: What Do I Read Next?

### Series Navigation — A Card and Floating Arrows

Moving between series entries is split across two components: a **card** pinned at the bottom of the post (`SeriesNav`) and **floating arrows** that hover over the screen (`SeriesArrows`). Both use the same data — posts sharing the same `series`, sorted by `seriesOrder`, then the current index located to compute previous and next. If a series has only one post (`seriesPosts.length <= 1`), neither renders.

`SeriesNav` is the card at the end of the body. It shows a `(current / total)` progress marker next to the series title, with the full list tucked inside a `<details>`.

```typescript
// src/components/SeriesNav.tsx
<h3 className="...">
  {series}
  <span className="ml-2 text-xs font-normal">
    ({currentIndex + 1} / {seriesPosts.length})
  </span>
</h3>

<details className="mb-4">
  <summary className="...">{dict.post.showFullList}</summary>
  <ol className="mt-2 space-y-1 pl-5 list-decimal">
    {/* full entry list, current post emphasized */}
  </ol>
</details>
```

`<details>`/`<summary>` collapses and expands using nothing but the browser's built-in behavior — no JS. Always-expanded makes the card long; removing it loses the bird's-eye view of the series. Collapsed by default, expandable on demand is the compromise. Below it sit the previous/next cards side by side for one-step movement.

The highlight of this post is `SeriesArrows`. It **offers the same navigation in different forms depending on screen size**. On desktop, floating arrows on the screen edges; on mobile, a fixed bottom bar.

```typescript
// src/components/SeriesArrows.tsx (desktop — left "previous" arrow)
<Link
  href={`/${locale}/posts/${prev.slug}`}
  className="fixed left-2 top-1/2 -translate-y-1/2 z-40 hidden lg:flex
             opacity-0 hover:opacity-100 transition-opacity duration-200"
>
  {/* arrow + previous post title */}
</Link>
```

On desktop (`lg` and up), `hidden lg:flex` floats arrows at the left and right edges, vertically centered (`top-1/2 -translate-y-1/2`). They sit hidden at `opacity-0` and rise to `hover:opacity-100` on mouseover. They stay out of the way while you read, and only surface when your cursor drifts to the edge because you're curious about the next part.

```typescript
// src/components/SeriesArrows.tsx (mobile — fixed bottom bar)
<div className="fixed bottom-0 left-0 right-0 z-40 flex border-t ... lg:hidden">
  {/* left: previous / right: next — split with flex-1 */}
</div>
```

Mobile has no hover, so the same approach won't work. Instead, a `fixed bottom-0` bar runs along the bottom, splitting previous/next into halves with `flex-1`. It's right where a thumb lands. On mobile I also added an `onTouchStart` handler to briefly surface the title in place of hover.

| Environment | Form | Position | Visibility |
| --- | --- | --- | --- |
| Desktop (`lg`+) | Floating arrows | Screen edges, vertically centered | Hidden by default, shown on hover |
| Mobile (`< lg`) | Fixed bottom bar | Bottom of screen, split left/right | Always visible |

Same data, same purpose, different interaction. Responsive design isn't only about shrinking and growing layouts — it's also about reshaping the interaction itself to fit the input method (mouse hover vs. touch).

### Related Posts — Tag Overlap Was Enough

Related-post suggestions are done with a single **tag-overlap count** — no embeddings, no recommendation engine. For every post except the current one, the number of tags it shares with the current post becomes its score.

```typescript
// src/components/RecentPosts.tsx
const relatedPosts = otherPosts
  .map((post) => ({
    ...post,
    score: post.tags.filter((tag) => currentTags.includes(tag)).length,
  }))
  .sort((a, b) => b.score - a.score || new Date(b.date).getTime() - new Date(a.date).getTime())
  .slice(0, 2);
```

Sort by `score` descending, break ties by recency, then take the top two. More shared tags means more relevance; equal scores favor the newer post. A simple rule.

The one extra thing here is a **fallback**. If no tags overlap, the suggestion area would be empty — and showing the latest posts beats showing nothing.

```typescript
// src/components/RecentPosts.tsx
const hasRelated = relatedPosts[0].score > 0;
// hasRelated → "Related Posts", otherwise → "Other Posts"
```

If the top result's score is above zero, the heading reads "Related Posts"; if everything is zero, it reads "Other Posts." That avoids falsely claiming "related" when the match is thin, while still always surfacing two posts to read next. At a scale of 20 posts, there was no reason to reach for cosine similarity. Diligently tagging posts was enough to make the suggestions plausible.

***

## Images: Click to Zoom

The image lightbox handles every inline image with **a single event delegation**, rather than wrapping each image in its own component. One click listener sits on `document`, and if the clicked target meets the conditions, an overlay opens.

```typescript
// src/components/ImageLightbox.tsx
function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (
    target.tagName === "IMG" &&
    target.closest(".prose") &&
    !target.closest("pre")
  ) {
    const img = target as HTMLImageElement;
    setSrc(img.src);
    setAlt(img.alt || "");
  }
}
```

Three conditions must all hold: the target is an `IMG`, it's inside the `.prose` body, and it's not inside a `pre` (code block). Only markdown body images zoom — an image that happens to sit in a code block, or a UI icon outside the body, is left alone. There's no need to touch any component when adding a new image; as long as it lands inside `.prose`, the lightbox attaches automatically.

The overlay dims and blurs the background with `bg-black/80 backdrop-blur-sm`. There are three ways to close it — click the image, click the background, or the X button in the top right. Escape is wired in too.

```typescript
// src/components/ImageLightbox.tsx
useEffect(() => {
  if (!src) return;
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", handleKey);
  return () => document.removeEventListener("keydown", handleKey);
}, [src, close]);
```

The keyboard listener registers only while the lightbox is open (when `src` is set). No stray global listener hangs around while it's closed.

***

## Wrap-up

| Feature | Core technique | Detail |
| --- | --- | --- |
| Progress bar | `scrollTop / (scrollHeight - clientHeight)` | Hidden at top, passive listener |
| TOC + scroll spy | DOM query + `IntersectionObserver` | Korean id slugs, top-band margin |
| Series navigation | `seriesOrder` sort + responsive split | Desktop hover arrows / mobile bottom bar |
| Related posts | Tag-overlap count | "Other Posts" fallback when score is 0 |
| Scroll-to-top | `savedPosition` toggle | Round trip between top and reading spot |
| Image lightbox | `document` click delegation | Only IMG inside `.prose`, close with Escape |

None of the six features pulled in an external library. The progress bar, the TOC, the suggestions — all of it came together from browser APIs and a bit of sorting logic. For a small blog, discovery UX is built from the sum of small details rather than heavy tooling. What actually ate the most time was getting the Korean id slugs and the scroll spy's `rootMargin` value right.

The next post covers rendering Mermaid diagrams inside the post body.
