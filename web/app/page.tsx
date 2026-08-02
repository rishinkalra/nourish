import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FamilyChef — Your week, well fed",
  description:
    "A staging preview of practical weekly meal planning, groceries, prep, and intentional leftovers.",
  openGraph: {
    title: "FamilyChef",
    description: "Your week, well fed.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "FamilyChef weekly meal planning" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FamilyChef",
    description: "Your week, well fed.",
    images: ["/og.png"],
  },
};

export default function Home() {
  return (
    <main className="preview-frame-shell">
      <iframe
        className="preview-frame"
        src="/preview/index.html"
        title="FamilyChef staging preview"
      />
    </main>
  );
}
