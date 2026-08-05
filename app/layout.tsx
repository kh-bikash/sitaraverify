import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "vellum.local";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  return {
    title: "Sitaara Verify — Property Verification Intelligence",
    description: "Three-source property verification across deed OCR, government land records, and technical valuation reports.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Sitaara Verify — Property Verification Intelligence",
      description: "Verify the deed, land record, valuation and parcel in one decision workspace.",
      type: "website",
      images: [{ url: `${baseUrl}/og-v2.png`, width: 1672, height: 941, alt: "Sitaara property verification workspace" }],
    },
    twitter: { card: "summary_large_image", title: "Sitaara Verify", description: "Three-source property verification intelligence.", images: [`${baseUrl}/og-v2.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
