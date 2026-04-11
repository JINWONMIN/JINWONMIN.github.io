import type { Metadata } from "next";
import AboutProfile from "@/components/AboutProfile";
import { locales, type Locale } from "@/lib/i18n";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: "About",
    description: "minsnote 블로그 소개 — 웹 개발과 인프라 모니터링에 대한 개발 노트",
    alternates: {
      canonical: `https://jinwonmin.github.io/${locale}/about/`,
      languages: {
        ko: "/ko/about/",
        en: "/en/about/",
      },
    },
    openGraph: {
      title: "About",
      description: "minsnote 블로그 소개 — 웹 개발과 인프라 모니터링에 대한 개발 노트",
    },
  };
}

export default function AboutPage() {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      <div className="space-y-2 pb-8 pt-6">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl md:text-5xl">
          About
        </h1>
      </div>

      <div className="pt-10">
        <div className="flex flex-col sm:flex-row gap-10">
          <AboutProfile />

          {/* Bio */}
          <div className="prose prose-gray dark:prose-invert max-w-none flex-1">
            <p>

            </p>
            <p>

            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
