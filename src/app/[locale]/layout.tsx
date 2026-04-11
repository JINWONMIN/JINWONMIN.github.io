import { Suspense } from "react";
import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ScrollTopButton from "@/components/ScrollTopButton";
import ScrollRestore from "@/components/ScrollRestore";
import { getDictionary, locales, type Locale } from "@/lib/i18n";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale as Locale);
  return {
    description: dict.site.description,
    openGraph: {
      type: "website",
      siteName: "minsnote",
      locale: dict.site.locale,
    },
    alternates: {
      canonical: `https://jinwonmin.github.io/${locale}/`,
      types: {
        "application/rss+xml": `/${locale}/rss.xml`,
      },
      languages: {
        ko: "/ko",
        en: "/en",
      },
    },
    twitter: {
      card: "summary",
      site: "@minsnote",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <>
      <Suspense>
        <Header locale={locale as Locale} />
      </Suspense>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-12">
        {children}
      </main>
      <Footer locale={locale as Locale} />
      <ScrollTopButton />
      <ScrollRestore />
    </>
  );
}
