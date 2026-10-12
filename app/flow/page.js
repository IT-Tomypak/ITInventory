"use client";
// Process Flow — IT's procedure flowcharts, for reading. Reference only: this
// page changes nothing and no workflow here is enforced by the system.
import { Printer } from "lucide-react";
import { HANDOVER, LOAN, LOAN_RETURN, REQUEST, RETURN } from "../../lib/flowcharts";
import Flowchart from "../components/Flowchart";
import { Card, PageHeader } from "../components/ui";

// [section title, purpose, [[caption, chart]...], [[link label, href]...]]
const SECTIONS = [
  ["10.1.2 IT Hardware Request System",
    "Used by requester to fill in system for IT hardware request from IT department.",
    [["Flowchart 8", REQUEST]], [["Open Equipment Request", "/entry/"]]],
  ["10.2 IT Hardware Handover and Return System",
    "Used by IT department for IT accessories including laptop and PC during handover or return to user.",
    [["Flowchart 15: hardware handover or loan to user", HANDOVER], ["Flowchart 16: hardware return from user", RETURN]],
    [["Open Allocate / Return", "/allocate/"]]],
  ["10.5 IT Loan Accessories",
    "Used by IT department to issue accessories loan record and maintaining IT Accessories availability.",
    [["Flowchart 18: Loan", LOAN], ["Flowchart 18: Return", LOAN_RETURN]],
    [["Open Allocate / Return", "/allocate/"], ["Open IT Accessories", "/accessories/"]]],
];

export default function FlowPage() {
  return (
    <>
      <PageHeader title="Process Flow" help="process-flow"
        subtitle="IT's procedure flowcharts for requests, handover and return, and accessory loans. For reference."
        actions={
          <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <Printer className="h-4 w-4" /> Print
          </button>
        } />
      {SECTIONS.map(([title, purpose, charts, links]) => (
        <Card key={title} className="mb-4 p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">Purpose: {purpose}</p>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              {links.map(([label, href]) => (
                <a key={href} href={href} className="rounded-lg border border-border px-3 py-2 text-sm hover:border-brand/60">{label}</a>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-6">
            {charts.map(([caption, chart]) => (
              <figure key={caption} className="min-w-0 max-w-full">
                <div className="overflow-x-auto"><Flowchart {...chart} /></div>
                <figcaption className="mt-2 text-center text-xs text-muted">{caption}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}
