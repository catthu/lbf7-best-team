"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Graph" },
  { href: "/locality", label: "Locality" },
  { href: "/pathways", label: "Pathways" },
  { href: "/write-up", label: "Write-up" },
];

export default function MainNav() {
  const pathname = usePathname() || "/";

  return (
    <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
      <div className="flex items-center gap-6 text-sm">
        {links.map((link) => {
          const isActive =
            link.href === "/"
              ? pathname === "/"
              : pathname === link.href || pathname.startsWith(`${link.href}/`);
          const baseClasses = "hover:text-white transition-colors";
          const activeClasses = isActive ? "font-semibold" : "font-normal";
          return (
            <Link key={link.href} href={link.href} className={`${baseClasses} ${activeClasses}`}>
              {link.label}
            </Link>
          );
        })}
      </div>
      <div />
    </nav>
  );
}



