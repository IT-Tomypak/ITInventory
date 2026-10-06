"use client";
// The full record of one asset: fields, photos, current and past holders,
// requests allocated against it, and every audited change. Shared by the
// register's expanded row and /assets so the two can never show different facts.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { splitPhotos } from "../../lib/photos";
import { fmtDate, fmtDateTime, fmtRM } from "../../lib/assets";
import { StatusBadge, TableSkeleton } from "./ui";

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words text-sm">{children || "—"}</dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

// asset: an enriched row from loadRegister(), or null for a deleted asset
// (then only its history, which outlives it by design, is shown).
export default function AssetDetail({ asset, assetId, lookups, showCost }) {
  const id = asset?.asset_id ?? assetId;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    Promise.all([
      supabase.from("asset_assignment").select("*").eq("asset_id", id).order("issued_on", { ascending: false }),
      supabase.from("asset_audit").select("*").eq("asset_id", id).order("changed_at", { ascending: false }).limit(500),
      supabase.from("equipment_request").select("request_id, requested_by_name, department, status, created_at")
        .eq("asset_id", id).order("created_at", { ascending: false }),
    ]).then(([a, h, r]) => {
      if (!live) return;
      const err = a.error || h.error || r.error;
      if (err) setError(err.message);
      else setData({ assignments: a.data, history: h.data, requests: r.data });
    });
    return () => { live = false; };
  }, [id]);

  const holderName = (row) => lookups.staffById.get(row.staff_id)?.full_name
    || lookups.locationName.get(row.location_id)?.name || "—";
  const photos = splitPhotos(asset?.photo_path);
  const current = data?.assignments.find((x) => !x.returned_on);
  const past = data?.assignments.filter((x) => x.returned_on) ?? [];

  return (
    <div className="text-sm">
      {asset ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Asset tag"><span className="font-medium">{asset.asset_tag}</span></Field>
          <Field label="Type">{asset.asset_type}</Field>
          <Field label="Make / model">{[asset.make, asset.model].filter(Boolean).join(" ")}</Field>
          <Field label="Serial no">{asset.serial_no}</Field>
          <Field label="Status"><StatusBadge status={asset.status} /></Field>
          <Field label="Location">{asset.location}</Field>
          <Field label="Owning department">{asset.department}</Field>
          <Field label="Vendor">{asset.vendor}</Field>
          <Field label="Purchase date">{asset.purchase_date && fmtDate(asset.purchase_date)}</Field>
          <Field label="PO / invoice">{[asset.po_no, asset.invoice_no].filter(Boolean).join(" / ")}</Field>
          <Field label="Warranty end">{asset.warranty_end && `${fmtDate(asset.warranty_end)} · ${asset.warranty}`}</Field>
          <Field label="Refresh due">{asset.refresh_due && `${fmtDate(asset.refresh_due)} (${asset.refresh_years ?? "?"} yr cycle)`}</Field>
          {showCost && <Field label="Purchase cost">{fmtRM(asset.purchase_cost_rm)}</Field>}
          {showCost && <Field label="Book value today">{fmtRM(asset.book_value)}</Field>}
          <Field label="Registered">{asset.created_at && `${fmtDate(asset.created_at)} by ${asset.created_by_name || "—"}`}</Field>
          {!asset.active && <Field label="Active">No</Field>}
          <div className="col-span-full"><Field label="Spec notes"><span className="whitespace-pre-line">{asset.spec_notes}</span></Field></div>
        </dl>
      ) : (
        <p className="text-muted">This asset has been deleted. Its history is kept below.</p>
      )}

      {photos.length > 0 && (
        <Section title="Photos">
          <div className="flex flex-wrap gap-2">
            {photos.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="Asset photo" loading="lazy" className="h-24 w-24 rounded-lg border border-border object-cover" />
              </a>
            ))}
          </div>
        </Section>
      )}

      {error && <p role="alert" className="mt-4 text-danger">Error loading data: {error}</p>}
      {!data && !error && <div className="mt-4"><TableSkeleton rows={3} cols={4} /></div>}

      {data && (
        <>
          {asset && (
            <Section title="Current holder">
              {current
                ? <p><span className="font-medium">{holderName(current)}</span> since {fmtDate(current.issued_on)}
                    {current.due_back_on && <> · on loan, due back {fmtDate(current.due_back_on)}</>}
                    {current.condition_out && <> · issued {current.condition_out}</>}</p>
                : <p className="text-muted">Not held by anyone.</p>}
            </Section>
          )}

          <Section title={`Past holders (${past.length})`}>
            {past.length === 0 ? <p className="text-muted">None.</p> : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {past.map((x) => (
                  <li key={x.assignment_id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-2.5">
                    <span className="font-medium">{holderName(x)}</span>
                    <span className="text-muted">{fmtDate(x.issued_on)} → {fmtDate(x.returned_on)}</span>
                    <span className="w-full text-xs text-muted">
                      Out: {x.condition_out || "—"}{x.notes_out && ` (${x.notes_out})`} · In: {x.condition_in || "—"}{x.notes_in && ` (${x.notes_in})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.requests.length > 0 && (
            <Section title="Allocated against requests">
              <ul className="space-y-1">
                {data.requests.map((r) => (
                  <li key={r.request_id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">#{r.request_id}</span> {r.requested_by_name} · {r.department}
                    <StatusBadge status={r.status} /> <span className="text-muted">{fmtDate(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`History (${data.history.length})`}>
            {data.history.length === 0 ? <p className="text-muted">No recorded changes.</p> : (
              <ol className="space-y-1.5">
                {data.history.map((h) => (
                  <li key={h.audit_id} className="flex flex-wrap gap-x-2 border-l-2 border-border pl-3">
                    <span className="text-muted">{fmtDateTime(h.changed_at)}</span>
                    <span className="font-medium">{h.changed_by_name || "—"}</span>
                    <span>{describe(h)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function describe(h) {
  if (h.action === "created") return `registered ${h.new_value}`;
  if (h.action === "deleted") return `deleted ${h.old_value}`;
  if (h.action === "assigned") return `issued to ${h.new_value}`;
  if (h.action === "returned") return `returned by ${h.old_value}`;
  return `${h.field}: ${h.old_value ?? "(empty)"} → ${h.new_value ?? "(empty)"}`;
}
