"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function Nav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <button className="btn-secondary mx-4 mb-3 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Close menu" : "Menu"}
      </button>
      <nav className={`${open ? "block" : "hidden"} px-2 pb-3 md:block`}>
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setOpen(false)}
            className={`block rounded-md px-3 py-1.5 text-sm ${active(i.href) ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
