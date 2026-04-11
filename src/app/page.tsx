import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: {
    canonical: "https://jinwonmin.github.io/ko/",
  },
};

export default function RootPage() {
  return (
    <>
      <meta httpEquiv="refresh" content="0;url=/ko" />
      <p>
        Redirecting to <a href="/ko">minsnote</a>...
      </p>
    </>
  );
}
