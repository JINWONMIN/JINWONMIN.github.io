import { getAllPostMetas } from "@/lib/posts";
import PostCard from "@/components/PostCard";
import Link from "next/link";
import { getDictionary, locales, type Locale } from "@/lib/i18n";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ locale: string; tag: string }>;
}

export async function generateStaticParams() {
  const params: { locale: string; tag: string }[] = [];
  for (const locale of locales) {
    const posts = getAllPostMetas(locale);
    const tags = new Set<string>();
    posts.forEach((post) => post.tags.forEach((tag) => tags.add(tag)));
    for (const tag of tags) {
      const encoded = encodeURIComponent(tag);
      params.push({ locale, tag: encoded });
      if (encoded !== tag) {
        params.push({ locale, tag });
      }
    }
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  return {
    title: `Tag: ${decodedTag}`,
    alternates: {
      canonical: `https://jinwonmin.github.io/${locale}/tags/${encodeURIComponent(tag)}/`,
      languages: {
        ko: `/ko/tags/${encodeURIComponent(tag)}/`,
        en: `/en/tags/${encodeURIComponent(tag)}/`,
      },
    },
  };
}

export default async function TagPage({ params }: Props) {
  const { locale, tag } = await params;
  const loc = locale as Locale;
  const dict = getDictionary(loc);
  const decodedTag = decodeURIComponent(tag);
  const allPosts = getAllPostMetas(loc);
  const posts = allPosts.filter((post) => post.tags.includes(decodedTag));

  return (
    <div>
      <div className="space-y-2 pb-8 pt-6">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl">
          {dict.tags.tagPrefix}
          <span className="text-primary-500">{decodedTag}</span>
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          {posts.length}{dict.home.postCount}
        </p>
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-800">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} locale={loc} />
        ))}
      </div>

      <div className="pt-8">
        <Link
          href={`/${locale}/tags`}
          className="text-sm font-medium text-primary-500 hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
        >
          {dict.tags.allTags}
        </Link>
      </div>
    </div>
  );
}
