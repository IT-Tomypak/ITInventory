"use client";
// /help — USER_GUIDE.md as a page. The content is compiled at build time by
// tools/build-help.mjs into guideContent.js (committed), so this page cannot
// drift from the printed guide and works offline. Printing drops the app
// chrome and the contents rail, so a print is the document.
//
// The HTML comes from our own USER_GUIDE.md through build-help's escaping
// converter, never from user input, which is why dangerouslySetInnerHTML is fine.
import { useEffect, useMemo, useState } from "react";
import { Printer, Search } from "lucide-react";
import { GUIDE_SECTIONS } from "./guideContent";
import { inputCls } from "../components/AssetForm";
import { Card, EmptyState, PageHeader, cn } from "../components/ui";

export default function HelpPage() {
  const [q, setQ] = useState("");

  // The guide renders after the auth gate, so the browser's own jump to
  // #slug has already happened (and missed). Do it once the sections exist.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  // A match on a part heading (##) keeps the whole part; a match inside a
  // section keeps that section and the heading of its part, for context.
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return GUIDE_SECTIONS;
    const hit = (s) => words.every((w) => `${s.title} ${s.text}`.toLowerCase().includes(w));
    const keep = new Set();
    let part = null, partHit = false;
    for (const s of GUIDE_SECTIONS) {
      if (s.level === 2) { part = s; partHit = hit(s); if (partHit) keep.add(s); continue; }
      if (partHit || hit(s)) { keep.add(s); if (part) keep.add(part); }
    }
    return GUIDE_SECTIONS.filter((s) => keep.has(s));
  }, [q]);

  return (
    <>
      <PageHeader title="Help & User Guide" subtitle="How to use ITrack, for requesters, IT officers and administrators."
        actions={<button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
          <Printer className="h-4 w-4" /> Print</button>} />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Contents" className="no-print lg:sticky lg:top-20 lg:w-64 lg:shrink-0">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guide"
              aria-label="Search the guide" className={cn(inputCls, "pl-9")} />
          </label>
          <ul className="mt-3 hidden max-h-[70vh] overflow-y-auto text-sm lg:block">
            {shown.map((s) => (
              <li key={s.slug}>
                <a href={`#${s.slug}`} className={cn("block rounded-md px-2 py-1 hover:bg-brand/10",
                  s.level === 2 ? "mt-2 font-medium" : "pl-4 text-muted hover:text-fg")}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <Card className="guide min-w-0 flex-1 p-4 sm:p-6">
          {shown.length ? shown.map((s) => {
            const H = s.level === 2 ? "h2" : "h3";
            return (
              <section key={s.slug}>
                <H id={s.slug} className="scroll-mt-20">{s.title}</H>
                <div dangerouslySetInnerHTML={{ __html: s.html }} />
              </section>
            );
          }) : <EmptyState icon={Search} title="Nothing in the guide matches" message="Try fewer or different words." />}
        </Card>
      </div>
    </>
  );
}
