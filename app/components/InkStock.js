"use client";
// Printer ink: a count per brand and colour (public.ink_stock), not tagged assets.
import { useCallback, useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { Card, cn, toast } from "./ui";

const SWATCH = { Black: "bg-black", Cyan: "bg-cyan-400", Magenta: "bg-fuchsia-500", Yellow: "bg-yellow-400" };

export default function InkStock({ canEdit }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    supabase.from("ink_stock").select("brand, color, qty").order("brand").order("color")
      .then(({ data, error }) => (error ? toast.error(error.message) : setRows(data)));
  }, []);
  useEffect(load, [load]);

  async function adjust(r, delta) {
    const { error } = await supabase.rpc("adjust_ink", { p_brand: r.brand, p_color: r.color, p_delta: delta });
    if (error) return toast.error(error.message.includes("qty_check") ? `No ${r.brand} ${r.color} left.` : error.message);
    toast.success(`${r.brand} ${r.color}: ${delta < 0 ? "took 1" : "added 1"}.`);
    load();
  }

  if (!rows) return null;
  const brands = [...new Set(rows.map((r) => r.brand))];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {brands.map((b) => (
        <Card key={b} className="p-4">
          <h3 className="mb-2 font-semibold">{b}</h3>
          <ul className="space-y-1.5">
            {rows.filter((r) => r.brand === b).map((r) => (
              <li key={r.color} className="flex items-center gap-2 text-sm">
                <span className={cn("h-3 w-3 rounded-full border border-border", SWATCH[r.color])} />
                <span className="flex-1">{r.color}</span>
                <span className={cn("w-8 text-right font-semibold", r.qty === 0 && "text-danger")}>{r.qty}</span>
                {canEdit && <>
                  <button onClick={() => adjust(r, -1)} disabled={r.qty === 0} aria-label={`Take one ${b} ${r.color}`}
                    className="rounded-lg border border-border p-1 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                  <button onClick={() => adjust(r, 1)} aria-label={`Add one ${b} ${r.color}`}
                    className="rounded-lg border border-border p-1"><Plus className="h-3.5 w-3.5" /></button>
                </>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
