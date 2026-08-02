import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FamilyChef — Your week, well fed",
  description: "Practical weekly meal planning for real life.",
  icons: {
    icon: "/preview/assets/brand/favicon.png",
    apple: "/preview/assets/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
