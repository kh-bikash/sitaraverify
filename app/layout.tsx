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
    title: "Vellum — Document & Land Intelligence",
    description: "Private CPU document restoration and precise land parcel overlays.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Vellum — Document & Land Intelligence",
      description: "Restore the record. Trace the truth.",
      type: "website",
      images: [{ url: `${baseUrl}/og.png`, width: 1672, height: 941, alt: "Vellum document restoration and parcel mapping" }],
    },
    twitter: { card: "summary_large_image", title: "Vellum", description: "Restore the record. Trace the truth.", images: [`${baseUrl}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
