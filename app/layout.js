import "./globals.css";

const description = "Actividad en vivo de las apps y clientes de Nostr: qué se usa, ahora.";

// La imagen de vista previa sale de app/opengraph-image.js (Next la enlaza sola).
export const metadata = {
  metadataBase: new URL("https://radarnostr.vercel.app"),
  title: "Radar Nostr",
  description,
  openGraph: {
    title: "Radar Nostr",
    description,
    url: "/",
    siteName: "Radar Nostr",
    locale: "es_AR",
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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
