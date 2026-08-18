import "./globals.css";

export const metadata = {
  title: "Boys Weeb Trip 2026 — Tokyo",
  description: "Itinerary, ideas, and photos for the Tokyo boys trip",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f0f14",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
