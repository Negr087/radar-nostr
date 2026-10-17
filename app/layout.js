import "./globals.css";

const description = "Live activity of Nostr apps and clients: what people are using, right now.";

// The preview image comes from app/opengraph-image.js (Next links it automatically).
export const metadata = {
  metadataBase: new URL("https://radarnostr.vercel.app"),
  title: "Radar Nostr",
  description,
  openGraph: {
    title: "Radar Nostr",
    description,
    url: "/",
    siteName: "Radar Nostr",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Radar Nostr",
    description,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
