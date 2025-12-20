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
        <div className="flex items-center gap-4">
          {links.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            const baseClasses =
              "hover:text-gray-900 dark:hover:text-white transition-colors";
            const activeClasses = isActive ? "font-semibold" : "font-normal";
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${baseClasses} ${activeClasses}`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
      <a
        href="https://www.bakerlab.org/wp-content/uploads/2025/11/Zhang-Science-Predicting-protein-protein-interactions-in-the-human-proteome-3.pdf"
        target="_blank"
        rel="noreferrer"
        className="hidden sm:block text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2 hover:underline"
      >
        Dataset by Baker Lab, September 2025
      </a>
    </nav>
  );
}




