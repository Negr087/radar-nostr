import "./globals.css";

export const metadata = {
  title: "Radar Nostr",
  description: "Actividad en vivo de las apps y clientes de Nostr",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
