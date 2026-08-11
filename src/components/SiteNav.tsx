"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="site-nav" aria-label="Primary">
      <Link href="/" className={pathname === "/" ? "nav-link active" : "nav-link"}>
        Edges
      </Link>
      <Link
        href="/suggested"
        className={pathname?.startsWith("/suggested") ? "nav-link active" : "nav-link"}
      >
        Suggested
      </Link>
      <Link
        href="/best"
        className={pathname?.startsWith("/best") ? "nav-link active" : "nav-link"}
      >
        Best
      </Link>
      <Link
        href="/props"
        className={pathname?.startsWith("/props") ? "nav-link active" : "nav-link"}
      >
        Props
      </Link>
      <Link
        href="/calendar"
        className={pathname?.startsWith("/calendar") ? "nav-link active" : "nav-link"}
      >
        Calendar
      </Link>
      <Link
        href="/picks"
        className={pathname?.startsWith("/picks") ? "nav-link active" : "nav-link"}
      >
        Picks
      </Link>
      <Link
        href="/performance"
        className={pathname?.startsWith("/performance") ? "nav-link active" : "nav-link"}
      >
        Perf
      </Link>
      <Link
        href="/info"
        className={pathname?.startsWith("/info") ? "nav-link active" : "nav-link"}
      >
        Info
      </Link>
      <form method="POST" action="/api/auth/logout" className="nav-signout-form">
        <input type="hidden" name="scope" value="all" />
        <button type="submit" className="nav-link nav-signout">
          Log out
        </button>
      </form>
    </nav>
  );
}
