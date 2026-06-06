---
title: "10편: UX 개선기 (하) — 네비게이션과 탐색"
date: 2026-06-06
description: 글을 읽는 동안의 경험을 다듬으며 붙인 진행률 바, 목차, 시리즈 네비게이션 여섯 가지
tags:
  - UX
  - 네비게이션
  - Next.js
series: 블로그 개발기
seriesOrder: 10
---

## 검색 다음은 탐색이었다

[8편: UX 개선기 (상) — 검색과 다크모드](/ko/posts/search-and-darkmode)에서 "다음 편은 네비게이션과 탐색"이라고 적어놓고는, [9편: 검색 노출이 안 되는 진짜 이유](/ko/posts/seo-exposure-fix)가 급하게 끼어들었다. 빌드된 HTML이 빈 페이지인 걸 발견했으니 SEO부터 막아야 했다. 그 불을 끄고 나서 원래 하려던 작업으로 돌아왔다.

8편이 "글을 찾는" 기능이었다면, 이번 편은 **"글을 찾은 다음"의 경험**이다. 막상 글을 열고 나면 블로그는 너무 조용했다. 지금 어디쯤 읽고 있는지, 이 글이 시리즈의 몇 번째인지, 다음에 뭘 읽으면 좋을지 — 화면은 아무것도 말해주지 않았다. 긴 글을 끝까지 스크롤하다 보면 "이거 얼마나 남았지" 싶었고, 시리즈 글에서 다음 편으로 가려면 목록 페이지로 돌아가야 했다. 읽는 동안의 길잡이가 필요했다.

이번에 붙인 건 여섯 가지다.

| 영역 | 컴포넌트 | 한 줄 요약 |
| --- | --- | --- |
| 읽는 중 | `ReadingProgress` | 상단 진행률 바로 남은 분량 표시 |
| 읽는 중 | `TableOfContents` | 목차 + 현재 위치 하이라이트 |
| 읽는 중 | `ScrollTopButton` | 맨 위로, 그리고 다시 제자리로 |
| 글 사이 이동 | `SeriesNav` / `SeriesArrows` | 시리즈 이전·다음 편 이동 |
| 글 사이 이동 | `RecentPosts` | 태그 기반 관련 포스트 추천 |
| 이미지 | `ImageLightbox` | 본문 이미지 클릭 시 확대 |

***

## 읽는 중: 지금 어디쯤인지

### 진행률 바 — 남은 분량을 한 줄로

읽기 진행률 바는 페이지 상단에 가느다란 막대 하나로 "얼마나 읽었는지"를 보여준다. 계산은 단순하다. 스크롤한 거리를 전체 스크롤 가능 거리로 나누면 끝이다.

```typescript
// src/components/ReadingProgress.tsx
const el = document.documentElement;
const scrollTop = el.scrollTop;
const scrollHeight = el.scrollHeight - el.clientHeight;
setProgress(scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0);
```

이 값을 막대의 `width`에 `%`로 그대로 꽂는다. `scrollHeight - clientHeight`로 나누는 이유는, 화면에 보이는 한 화면 분량(`clientHeight`)은 스크롤할 수 없는 영역이라 전체에서 빼줘야 끝까지 내렸을 때 정확히 100%가 되기 때문이다.

디테일은 세 가지다.

- **상단에선 안 보인다.** `progress === 0`이면 `null`을 반환한다. 아직 안 읽은 글에 0% 막대가 떠 있는 건 군더더기다.
- **헤더 바로 아래에 붙인다.** `fixed top-16`으로 헤더(높이 `top-16`) 밑에 `h-0.5`(2px) 막대를 깔았다. 헤더를 가리지 않으면서 시선 흐름의 맨 위에 위치한다.
- **부드럽게 움직인다.** `transition-[width] duration-150`으로 막대가 스크롤을 따라 매끄럽게 늘어난다.

성능을 위해 스크롤 리스너에 `{ passive: true }`를 줬다. 스크롤 이벤트는 초당 수십 번 발생하는데, passive로 등록하면 브라우저가 리스너의 `preventDefault` 호출을 기다리지 않고 스크롤을 먼저 처리한다. 스크롤이 막대 때문에 버벅이는 일을 막는 작은 장치다.

### 목차 + 스크롤 스파이 — 현재 위치 하이라이트

목차는 빌드 타임에 만들지 않고 **마운트 시점에 DOM을 긁어서** 생성한다. 마크다운 본문이 `.prose` 컨테이너 안에 렌더링되므로, 그 안의 `h2`, `h3`를 쿼리하면 그대로 목차 항목이 된다.

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

heading에 `id`가 없으면 텍스트로 슬러그를 만들어 직접 붙인다. 정규식 `[^a-z0-9가-힣]+`에 **한글 음절 범위(`가-힣`)를 포함**시킨 게 포인트다. 이게 없으면 "읽는 중: 지금 어디쯤인지" 같은 한글 제목이 통째로 `-` 하나로 뭉개져서 앵커 링크가 다 깨진다. 한글 id를 살려두니 목차 클릭 시 정확한 섹션으로 점프한다. `h3`는 `pl-4`로 들여써서 계층을 시각적으로 구분했다.

현재 읽고 있는 섹션을 하이라이트하는 **스크롤 스파이**는 `IntersectionObserver`로 구현했다.

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

핵심은 `rootMargin: "-80px 0px -80% 0px"`다. 뷰포트의 위쪽 80px, 아래쪽 80%를 잘라내서 **화면 상단 근처의 좁은 띠**만 관측 영역으로 남긴다. 이렇게 하면 화면을 꽉 채운 여러 heading 중 "방금 상단을 지나간" 하나만 활성으로 잡힌다. 이 띠가 없으면 화면에 보이는 heading이 전부 동시에 활성화되어 목차가 깜빡인다. 스크롤할 때 목차의 하이라이트가 본문을 따라 한 칸씩 내려가는 게 이 마진 덕분이다.

### 스크롤 탑 버튼 — 위로, 그리고 다시 제자리로

스크롤 탑 버튼은 작지만 한 가지 영리한 디테일이 있다. 보통 "맨 위로" 버튼은 누르면 끝이다. 다시 읽던 곳으로 가려면 직접 스크롤해서 찾아야 한다. 이 버튼은 **왕복**한다.

```typescript
// src/components/ScrollTopButton.tsx
const handleClick = () => {
  if (atTop && savedPosition.current > 0) {
    // 맨 위 상태 → 저장해둔 위치로 복귀
    window.scrollTo({ top: savedPosition.current, behavior: "smooth" });
    savedPosition.current = 0;
  } else {
    // 내려가 있는 상태 → 위치 저장 후 맨 위로
    savedPosition.current = window.scrollY;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};
```

아래로 내려간 상태에서 누르면 현재 위치를 `savedPosition`에 저장하고 맨 위로 올라간다. 맨 위에 도착한 뒤 같은 버튼을 다시 누르면, 저장해둔 위치로 되돌아간다. 글 중간에서 제목이나 날짜를 확인하러 위로 갔다가, 읽던 곳으로 한 번에 복귀하는 흐름이다.

상태에 따라 버튼의 의미가 바뀌므로 두 가지를 같이 바꿔준다. 화살표를 `rotate-180`으로 뒤집어 "위" 대신 "아래(제자리로)"임을 보여주고, `aria-label`도 `"Scroll to top"`에서 `"Go back to previous position"`으로 전환한다. 노출 조건은 `scrollY > 300`(충분히 내려갔을 때) 또는 맨 위에 있지만 복귀할 위치가 저장된 경우다. 모든 이동은 `behavior: "smooth"`로 부드럽게 처리했다.

| 상태 | 동작 | 화살표 | aria-label |
| --- | --- | --- | --- |
| 내려가 있음 | 위치 저장 → 맨 위로 | ↑ (기본) | Scroll to top |
| 맨 위 + 저장된 위치 | 저장된 위치로 복귀 | ↓ (180° 회전) | Go back to previous position |

***

## 글 사이 이동: 다음엔 뭘 읽지

### 시리즈 네비게이션 — 카드와 떠다니는 화살표

시리즈 글의 이동은 두 컴포넌트로 나눠 풀었다. 본문 하단에 고정으로 박히는 **카드형**(`SeriesNav`)과, 화면에 떠다니는 **화살표형**(`SeriesArrows`)이다. 둘 다 같은 데이터를 쓴다. 같은 `series`를 가진 포스트를 `seriesOrder`로 정렬한 뒤, 현재 글의 인덱스를 찾아 이전·다음을 계산한다. 시리즈에 글이 하나뿐이면(`seriesPosts.length <= 1`) 양쪽 다 렌더링하지 않는다.

`SeriesNav`는 본문 끝에 놓이는 카드다. 시리즈 제목 옆에 `(현재 / 전체)` 진행 표시를 달고, 전체 목록은 `<details>`로 접어뒀다.

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
    {/* 전체 편 목록, 현재 글은 강조 */}
  </ol>
</details>
```

`<details>`/`<summary>`는 JS 없이 브라우저 기본 기능만으로 접기/펼치기가 동작한다. 전체 목록을 항상 펼쳐두면 카드가 길어지고, 아예 빼면 시리즈 전체를 조망할 수 없으니, 평소엔 접어두고 원할 때 펼치는 절충이다. 그 아래에 이전/다음 카드를 나란히 둬서 한 칸씩 이동하게 했다.

이 편의 하이라이트는 `SeriesArrows`다. **같은 네비게이션을 화면 크기에 따라 다른 형태로 제공한다.** 데스크탑에선 양쪽 가장자리에 떠다니는 화살표로, 모바일에선 하단 고정 바로 나타난다.

```typescript
// src/components/SeriesArrows.tsx (데스크탑 — 좌측 이전 화살표)
<Link
  href={`/${locale}/posts/${prev.slug}`}
  className="fixed left-2 top-1/2 -translate-y-1/2 z-40 hidden lg:flex
             opacity-0 hover:opacity-100 transition-opacity duration-200"
>
  {/* 화살표 + 이전 글 제목 */}
</Link>
```

데스크탑(`lg` 이상)에선 `hidden lg:flex`로 화면 좌우 가장자리, 세로 중앙(`top-1/2 -translate-y-1/2`)에 화살표를 띄운다. 평소엔 `opacity-0`으로 숨겨두고 마우스를 올리면 `hover:opacity-100`으로 떠오른다. 본문을 읽는 동안엔 거슬리지 않다가, 다음 편이 궁금해 가장자리로 마우스가 가면 그제야 나타나는 흐름이다.

```typescript
// src/components/SeriesArrows.tsx (모바일 — 하단 고정 바)
<div className="fixed bottom-0 left-0 right-0 z-40 flex border-t ... lg:hidden">
  {/* 좌: 이전 편 / 우: 다음 편 — flex-1로 분할 */}
</div>
```

모바일에선 호버가 없으니 같은 방식이 통하지 않는다. 대신 `fixed bottom-0`으로 화면 하단에 고정 바를 깔고, 이전/다음을 `flex-1`로 좌우 절반씩 나눴다. 엄지로 닿기 좋은 위치다. 모바일에선 호버 대신 `onTouchStart`로 제목을 잠깐 띄우는 처리도 넣었다.

| 환경 | 형태 | 위치 | 노출 방식 |
| --- | --- | --- | --- |
| 데스크탑 (`lg` 이상) | 떠다니는 화살표 | 화면 좌우 가장자리, 세로 중앙 | 평소 숨김, 호버 시 노출 |
| 모바일 (`lg` 미만) | 하단 고정 바 | 화면 하단, 좌우 분할 | 항상 노출 |

같은 데이터, 같은 목적, 다른 인터랙션. 반응형은 레이아웃을 줄이고 늘리는 것만이 아니라, 입력 방식(마우스 호버 vs 터치)에 맞춰 인터랙션 자체를 바꾸는 일이기도 하다.

### 관련 포스트 추천 — 태그 교집합이면 충분했다

관련 포스트 추천은 임베딩이나 추천 엔진 없이 **태그 교집합 카운트** 하나로 끝냈다. 현재 글을 뺀 모든 포스트에 대해, 현재 글의 태그와 겹치는 태그 수를 점수로 매긴다.

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

`score` 내림차순으로 정렬하고, 동점이면 최신순으로 한 번 더 정렬한 뒤 상위 2개를 뽑는다. 겹치는 태그가 많을수록 관련성이 높고, 같은 점수면 최신 글을 우선한다는 단순한 규칙이다.

여기서 한 가지 더 챙긴 건 **fallback**이다. 태그가 하나도 안 겹치면 추천 영역이 비어버리는데, 빈 화면 대신 최신 글이라도 보여주는 게 낫다.

```typescript
// src/components/RecentPosts.tsx
const hasRelated = relatedPosts[0].score > 0;
// hasRelated가 true면 "관련 포스트", false면 "다른 포스트"
```

상위 결과의 점수가 0보다 크면 제목을 "관련 포스트"로, 전부 0이면 "다른 포스트"로 바꾼다. 추천이 빈약할 때 거짓으로 "관련"이라 우기지 않으면서도, 독자가 다음에 읽을 글은 항상 두 개 노출된다. 포스트 20개 규모에선 코사인 유사도까지 갈 이유가 없었다. 태그를 성실히 달아둔 것만으로 추천이 충분히 그럴듯해졌다.

***

## 이미지: 클릭하면 확대

이미지 라이트박스는 컴포넌트마다 이미지 래퍼를 두지 않고 **이벤트 위임 하나로** 본문 전체 이미지를 처리한다. `document` 레벨에 클릭 리스너를 하나 걸고, 클릭된 대상이 조건에 맞으면 오버레이를 띄운다.

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

조건은 세 가지를 모두 만족해야 한다. 클릭 대상이 `IMG`이고, `.prose` 본문 안에 있으며, `pre`(코드 블록) 안이 아니어야 한다. 마크다운으로 들어온 본문 이미지만 확대하고, 코드 블록 안에 우연히 들어간 이미지나 본문 밖 UI 아이콘은 건드리지 않는다. 새 이미지를 추가할 때마다 컴포넌트를 손볼 필요가 없다 — 본문 `.prose` 안에 들어오기만 하면 자동으로 라이트박스가 붙는다.

오버레이는 `bg-black/80 backdrop-blur-sm`으로 배경을 어둡게 깔고 뒤를 흐린다. 닫는 방법은 세 가지 — 이미지 클릭, 배경 클릭, 오른쪽 위 X 버튼. 여기에 Escape 키도 추가했다.

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

키보드 리스너는 라이트박스가 열려 있을 때(`src`가 있을 때)만 등록한다. 닫혀 있는 동안엔 불필요한 전역 리스너를 두지 않는다.

***

## 정리

| 기능 | 핵심 기법 | 디테일 |
| --- | --- | --- |
| 진행률 바 | `scrollTop / (scrollHeight - clientHeight)` | 상단에선 숨김, passive 리스너 |
| 목차 + 스크롤 스파이 | DOM 쿼리 + `IntersectionObserver` | 한글 id 슬러그, 상단 띠 마진 |
| 시리즈 네비게이션 | `seriesOrder` 정렬 + 반응형 분기 | 데스크탑 호버 화살표 / 모바일 하단 바 |
| 관련 포스트 | 태그 교집합 카운트 | 점수 0이면 "다른 포스트" fallback |
| 스크롤 탑 | `savedPosition` 토글 | 맨 위 ↔ 읽던 위치 왕복 |
| 이미지 라이트박스 | `document` 클릭 이벤트 위임 | `.prose` 안 IMG만, Escape로 닫기 |

여섯 기능 중 외부 라이브러리를 쓴 건 없다. 진행률 바도, 목차도, 추천도 전부 브라우저 API와 작은 정렬 로직으로 풀렸다. 작은 블로그에서 탐색 UX는 무거운 도구가 아니라 디테일의 합으로 만들어진다. 정작 시간이 가장 많이 든 건 한글 id 슬러그와 스크롤 스파이의 `rootMargin` 값을 맞추는 일이었다.

다음 편에서는 본문에 Mermaid 다이어그램을 렌더링하는 작업을 다룬다.
