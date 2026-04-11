import { getPostBySlug, getAllPostSlugs, getAllPostMetas } from "@/lib/posts";
import { formatDate } from "@/lib/formatDate";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import TableOfContents from "@/components/TableOfContents";
import RecentPosts from "@/components/RecentPosts";
import PostStats from "@/components/PostStats";
import Comments from "@/components/Comments";
import CopyProtection from "@/components/CopyProtection";
import CodeCopyButton from "@/components/CodeCopyButton";
import ReadingProgress from "@/components/ReadingProgress";
import ImageLightbox from "@/components/ImageLightbox";
import MermaidRenderer from "@/components/MermaidRenderer";
import SeriesNav from "@/components/SeriesNav";
import SeriesArrows from "@/components/SeriesArrows";
import { getDictionary, locales, type Locale } from "@/lib/i18n";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateStaticParams() {
  const params: { locale: string; slug: string }[] = [];
  for (const locale of locales) {
    const slugs = getAllPostSlugs(locale);
    for (const slug of slugs) {
      params.push({ locale, slug });
    }
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getPostBySlug(slug, locale as Locale);
  const url = `https://jinwonmin.github.io/${locale}/posts/${slug}/`;
  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: url,
      languages: {
        ko: `/ko/posts/${slug}/`,
        en: `/en/posts/${slug}/`,
      },
    },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: new Date(post.date).toISOString(),
      tags: post.tags,
    },
    twitter: {
      card: "summary",
      title: post.title,
      description: post.description,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { locale, slug } = await params;
  const loc = locale as Locale;
  const dict = getDictionary(loc);
  const post = await getPostBySlug(slug, loc);
  const allPosts = getAllPostMetas(loc);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: new Date(post.date).toISOString(),
    dateModified: new Date(post.date).toISOString(),
    author: { "@type": "Person", name: "minsnote" },
    publisher: {
      "@type": "Person",
      name: "minsnote",
    },
    url: `https://jinwonmin.github.io/${locale}/posts/${slug}/`,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://jinwonmin.github.io/${locale}/posts/${slug}/`,
    },
    keywords: post.tags.join(", "),
  };

  return (
    <div className="flex gap-0 lg:-mx-4">
      <ReadingProgress />
      {post.series && (
        <SeriesArrows series={post.series} currentSlug={slug} posts={allPosts} locale={loc} />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Left Sidebar - TOC */}
      <Sidebar>
        <nav>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
            {dict.post.onThisPage}
          </h3>
          <TableOfContents dict={dict} />
        </nav>
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {dict.post.backToBlog}
          </Link>
        </div>
      </Sidebar>

      {/* Main Content */}
      <div className="flex-1 min-w-0 px-0 sm:px-4 lg:px-8">
        <article>
          <header className="space-y-4 border-b border-gray-200 dark:border-gray-800 pb-10 pt-2">
            <div>
              <time
                dateTime={post.date}
                className="text-sm text-gray-500 dark:text-gray-400"
              >
                {formatDate(post.date, loc)}
              </time>
            </div>
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl lg:text-4xl">
              {post.title}
            </h1>
            <div className="flex items-center gap-4">
              {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/${locale}/tags/${encodeURIComponent(tag)}`}
                      className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {post.readingTime}
              </span>
              <PostStats slug={slug} />
            </div>
          </header>

          <CopyProtection />
          <ImageLightbox />
          <CodeCopyButton />
          <MermaidRenderer />
          <div
            className="prose prose-gray dark:prose-invert max-w-none pt-10 prose-a:text-primary-500 prose-a:no-underline hover:prose-a:underline"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />

          {post.series && (
            <SeriesNav series={post.series} currentSlug={slug} posts={allPosts} locale={loc} dict={dict} />
          )}
        </article>

        <Comments slug={slug} locale={loc} />

        {/* Recent Posts */}
        <RecentPosts posts={allPosts} currentSlug={slug} currentTags={post.tags} locale={loc} dict={dict} />
      </div>
    </div>
  );
}
