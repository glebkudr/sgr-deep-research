import Link from "next/link";
import "../styles/globals.css";
import { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <h1>GraphRAG 1C Console</h1>
            <nav>
              <Link href="/upload">Upload &amp; Index</Link>
              <Link href="/qa">Q&amp;A</Link>
            </nav>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
