import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import "../styles/globals.css";
import "katex/dist/katex.min.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const playfair = Outfit({ subsets: ["latin"], variable: "--font-display" });
const themeInitScript = `try {
  const theme = localStorage.getItem("coros-theme") === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch (error) {
  console.warn("theme_preference_load_failed", { error });
}`;

export const metadata: Metadata = {
  title: "COROS Core — Personal Performance",
  description: "Personal analytics dashboard for COROS watch data. Track training load, recovery, sleep, HRV, and fitness progression.",
  icons: {
    icon: { url: "/icon.svg?v=2", type: "image/svg+xml" },
    shortcut: "/icon.svg?v=2",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
