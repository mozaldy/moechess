"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/components/workspace/Providers";
import type { Side } from "@/lib/chess/position";

const LINKS = [
  { href: "/", label: "Courses", matches: (path: string) => path === "/" || path.startsWith("/course") },
  { href: "/review", label: "Review", matches: (path: string) => path.startsWith("/review") },
  { href: "/assessment", label: "Assessment", matches: (path: string) => path.startsWith("/assessment") },
  { href: "/settings", label: "Settings", matches: (path: string) => path.startsWith("/settings") },
];

const SIDES: { value: Side; label: string }[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
];

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const { settings, updateSettings } = useWorkspace();

  return (
    <header className="mc-topbar">
      <Link href="/" className="mc-wordmark">Moechess</Link>
      <nav className="mc-topbar-nav" aria-label="Main">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} aria-current={link.matches(pathname) ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <fieldset className="mc-side-toggle">
        <legend className="mc-sr-only">Play as</legend>
        {SIDES.map((side) => (
          <label key={side.value}>
            <input
              type="radio"
              name="moechess-side"
              value={side.value}
              checked={settings.side === side.value}
              onChange={() => updateSettings({ side: side.value })}
            />
            {side.label}
          </label>
        ))}
      </fieldset>
    </header>
  );
}
