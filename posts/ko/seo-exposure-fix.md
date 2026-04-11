---
title: "9편: 검색 노출이 안 되는 진짜 이유"
date: 2026-04-11
description: SEO를 열심히 했는데 검색에 안 뜨길래 빌드된 HTML을 까봤더니 빈 페이지였다
tags:
  - SEO
  - Next.js
  - GitHub Pages
series: 블로그 개발기
seriesOrder: 9
---

## SEO는 충분히 했다고 생각했다

[7편: 복사 방지와 SEO 한방에 잡기](/ko/posts/copy-protection-and-seo)에서 JSON-LD, Open Graph, robots.txt, sitemap hreflang까지 다 붙였다. 이후 PR에서 `<html lang>` 속성, Twitter 카드, 404 페이지, lazy loading, JSON-LD 보강, sitemap hreflang 확장까지 추가 작업도 했다. 구글 서치 콘솔에 sitemap을 제출하고, 네이버 웹마스터에도 등록했다.

그런데 **검색에 아무것도 안 떴다.** 구글에서 `site:jinwonmin.github.io`를 검색하면 결과가 0건이었다. 네이버도 마찬가지. 메타데이터를 아무리 정성 들여 넣어도, 크롤러가 읽는 HTML 자체가 비어 있으면 아무 소용이 없다.

***

## 빌드된 HTML을 열어봤다

문제를 찾기 위해 빌드 결과물을 직접 확인했다. `next build` 후 `out/` 디렉토리에 생성된 HTML 파일을 열어봤다.

### 홈페이지: body가 비어 있었다

`out/ko.html`의 `<body>`에는 footer 텍스트 36자만 있었다. 헤더도 없고, 포스트 목록도 없고, h1 태그도 없었다. 크롤러가 이 페이지를 읽으면 사실상 빈 페이지다.

### 포스트 상세: 정상이었다

반면 `out/ko/posts/api-key-auth.html` 같은 포스트 상세 페이지는 본문이 4,682자로 정상 렌더링되어 있었다. `dangerouslySetInnerHTML`로 마크다운 변환 결과를 직접 삽입하는 구조라, 서버 렌더링 시점에 본문 전체가 HTML에 포함된다.

| 페이지 | body 텍스트 | 주요 태그 | 크롤러 인식 |
| --- | --- | --- | --- |
| 홈 (`ko.html`) | 36자 (footer만) | h1, article 없음 | 빈 페이지 |
| 포스트 상세 | 4,682자 | h1, article, p 정상 | 정상 |

홈페이지가 빈 페이지면, 크롤러는 이 사이트에 콘텐츠가 없다고 판단한다. 포스트 상세 페이지가 아무리 잘 되어 있어도, 진입점이 막혀 있으면 색인이 되지 않는다.

***

## 원인: BAILOUT_TO_CLIENT_SIDE_RENDERING

Next.js 빌드 로그를 자세히 보니 경고가 있었다.

```plain
BAILOUT_TO_CLIENT_SIDE_RENDERING
  Header.tsx:14
  HomeContent.tsx:30
```

**`useSearchParams()`가 범인이었다.** Next.js static export에서 `useSearchParams()`를 사용하면 해당 컴포넌트가 서버 렌더링에서 완전히 빠진다. 클라이언트 JS가 로드된 후에야 렌더링되는데, 크롤러 — 특히 JS를 실행하지 않는 네이버봇(Yeti) — 에게는 그 컴포넌트가 아예 존재하지 않는 것이다.

`Header.tsx`와 `HomeContent.tsx` 두 곳에서 `useSearchParams()`를 호출하고 있었고, 이 때문에 헤더와 포스트 목록이 모두 정적 HTML에서 누락되었다.

***

## 해결 과정

### Phase 1: Header의 dead code 제거

`Header.tsx`에서 `useSearchParams()`를 호출하고 있었지만, 반환값을 어디에서도 사용하지 않았다. line 33에서 `new URLSearchParams(window.location.search)`를 직접 쓰고 있었으니, `useSearchParams()`는 순수한 dead code였다.

```typescript
// Header.tsx — 제거 전
import { useSearchParams } from "next/navigation";
// ...
const searchParams = useSearchParams(); // 반환값 미사용
```

import와 호출을 제거했다. BAILOUT이 2개에서 1개로 줄었고, **모든 페이지의 header가 정적 HTML에 포함되기 시작했다.**

### Phase 2: HomeContent에 Suspense fallback 추가

`HomeContent.tsx`의 `useSearchParams()`는 dead code가 아니었다. 실제로 URL 쿼리 파라미터를 읽어서 필터 초기화와 URL 동기화에 사용하고 있었다. [8편: UX 개선기 (상) — 검색과 다크모드](/ko/posts/search-and-darkmode)에서 구현한 검색어 URL 동기화(`?q=`, `?tag=`, `?series=`)가 이 훅에 의존한다.

단순히 제거하면 로고 클릭 시 필터 리셋, 브라우저 뒤로가기 시 URL 동기화가 깨진다. 기능을 건드리지 않는 방법이 필요했다.

**해결: `<Suspense>`의 fallback에 정적 콘텐츠를 넣었다.**

```typescript
// src/app/[locale]/page.tsx
<Suspense fallback={<StaticPostList posts={latestPosts} locale={locale} />}>
  <HomeContent posts={posts} locale={locale} dict={dict} />
</Suspense>
```

`HomeContent` 코드를 건드리지 않고, `[locale]/page.tsx`의 `<Suspense>`에 fallback을 추가했다. fallback에는 최신 포스트 5개를 `PostCard`로 정적 렌더링한다. 서버 렌더링 시점에는 이 fallback이 HTML에 포함되고, 클라이언트 JS가 로드되면 `HomeContent`가 hydrate되면서 fallback을 대체한다.

| 항목 | 변경 전 | 변경 후 |
| --- | --- | --- |
| body 텍스트 | 36자 (footer) | 774자 |
| h1 태그 | 없음 | "Latest" |
| h2 태그 | 없음 | 최신 포스트 5개 제목 |
| article 태그 | 없음 | 5개 |

크롤러가 읽는 HTML에 제목, 설명, 링크가 모두 포함된다.

### Phase 3: 루트 리다이렉트에 meta refresh 추가

`src/app/page.tsx`에서 `redirect('/ko')`를 사용하고 있었다. Next.js의 `redirect()`는 클라이언트 JS로만 동작하기 때문에, JS를 실행하지 않는 크롤러는 `/`에서 `/ko`로 이동하지 못한다.

```typescript
// src/app/page.tsx — 변경 후
<meta httpEquiv="refresh" content="0;url=/ko" />
<link rel="canonical" href="https://jinwonmin.github.io/ko/" />
<a href="/ko">minsnote</a>
```

`<meta http-equiv="refresh">`는 HTML 표준이라 모든 크롤러가 인식한다. canonical로 `/ko`를 가리키고, JS가 안 되는 환경을 위해 fallback 링크도 넣었다.

### Phase 4: canonical URL 전 페이지 적용

기존에는 포스트 상세 페이지에만 canonical이 설정되어 있었다. 홈, about, tags, tags/[tag] 페이지에는 canonical이 없었다.

```typescript
// src/app/[locale]/layout.tsx — canonical + alternates 추가
alternates: {
  canonical: `https://jinwonmin.github.io/${locale}/`,
  languages: { ko: "/ko/", en: "/en/" },
}
```

다국어 사이트에서 canonical 없이 ko/en 페이지가 존재하면 검색 엔진은 중복 콘텐츠로 판단할 수 있다. 모든 페이지에 canonical과 alternates languages를 추가하여 중복 문제를 방지했다.

### Phase 5: description 개선

```plain
변경 전 (ko): "이모저모 주저리주저리 ~~"
변경 후 (ko): "웹 개발, 모니터링, 인프라에 대한 개발 노트 — Next.js, Prometheus, Cloudflare Workers 등"
```

사이트 description은 검색 결과의 스니펫에 그대로 노출된다. 기존 description은 콘텐츠를 전혀 설명하지 않았다. 실제 다루는 기술 스택을 명시하는 것으로 변경했다.

### Phase 6: trailingSlash로 URL 통일

`next.config.ts`에 `trailingSlash: true`를 추가했다.

| 항목 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 파일 구조 | `ko.html` | `ko/index.html` |
| URL | `/ko` | `/ko/` |
| GitHub Pages | 경우에 따라 404 | 안정적 서빙 |

GitHub Pages는 `ko.html`을 `/ko`로 서빙하긴 하지만, trailing slash 유무에 따라 리다이렉트가 발생할 수 있다. `trailingSlash: true`로 설정하면 `ko/index.html`을 생성하므로 GitHub Pages에서 안정적으로 서빙된다. sitemap, canonical, JSON-LD URL을 모두 trailing slash로 통일했다.

기존에 검색 엔진에 인덱싱된 URL이 없었으므로, URL 변경에 따른 깨짐 리스크는 없었다. 오히려 처음부터 일관된 URL로 시작할 수 있는 타이밍이었다.

***

## 최종 검증

| 검증 항목 | 결과 |
| --- | --- |
| 홈 정적 HTML | header + h1 + h2 5개 + article 5개 |
| 포스트 상세 | title, description, canonical, OG, JSON-LD 정상 |
| sitemap | 75개 URL, trailing slash 통일, hreflang 설정 |
| robots.txt | Allow /, Yeti 허용, sitemap 선언 |
| 루트 `/` | meta refresh로 `/ko/`로 이동 |
| canonical | 홈, about, tags, posts 전 페이지 설정 |

Google, Naver, Daum, Bing 크롤러 모두 색인 가능한 구조가 되었다.

***

## 정리

| Phase | 작업 | 효과 |
| --- | --- | --- |
| 1 | Header `useSearchParams()` dead code 제거 | BAILOUT 2 → 1, header 정적 렌더링 |
| 2 | HomeContent Suspense fallback 추가 | body 36자 → 774자, 포스트 목록 노출 |
| 3 | 루트 meta refresh 추가 | 크롤러 `/` → `/ko/` 이동 가능 |
| 4 | canonical 전 페이지 적용 | 다국어 중복 콘텐츠 방지 |
| 5 | description 개선 | 검색 스니펫에 실제 콘텐츠 설명 노출 |
| 6 | trailingSlash 통일 | URL 일관성 + GitHub Pages 호환 |

SEO는 메타데이터만의 문제가 아니다. 크롤러가 읽는 HTML에 콘텐츠가 있어야 한다. `useSearchParams()` 하나가 전체 페이지를 클라이언트 전용으로 만들어버리는 Next.js static export의 특성은, 빌드 결과물을 직접 열어보지 않으면 알기 어렵다. 빌드 후 `out/` 디렉토리의 HTML을 한 번이라도 까봤으면 더 일찍 잡았을 문제다.
