import { Suspense } from "react";
import { getAllPostMetas } from "@/lib/posts";
import HomeContent from "@/components/HomeContent";
import PostCard from "@/components/PostCard";
import { getDictionary, type Locale } from "@/lib/i18n";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  const posts = getAllPostMetas(locale as Locale);

  const seriesCounts: Record<string, number> = {};
  posts.forEach((post) => {
    if (post.series) {
      seriesCounts[post.series] = (seriesCounts[post.series] || 0) + 1;
    }
  });
  const seriesList = Object.entries(seriesCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const tagCounts: Record<string, number> = {};
  posts.forEach((post) => {
    post.tags.forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCounts).sort(
    (a, b) => b[1] - a[1]
  ) as [string, number][];

  const loc = locale as Locale;
  const dict = getDictionary(loc);

  return (
    <Suspense fallback={
      <div className="flex gap-0 lg:-mx-4">
        <div className="flex-1 min-w-0 px-0 sm:px-4 lg:px-8">
          <div className="space-y-2 pb-3 pt-2">
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl lg:text-4xl">
              {dict.home.latest}
            </h1>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {posts.slice(0, 5).map((post) => (
              <PostCard key={post.slug} post={post} locale={loc} />
            ))}
          </div>
        </div>
      </div>
    }>
      <HomeContent
        posts={posts}
        tags={sortedTags}
        series={seriesList}
        locale={loc}
      />
    </Suspense>
  );
}
