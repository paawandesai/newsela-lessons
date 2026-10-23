import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Lesson Studio" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
