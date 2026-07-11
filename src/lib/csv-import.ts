import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

export type CsvRow = {
  name: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  cost_price?: number;
  selling_price: number;
  quantity?: number;
  min_stock?: number;
  expiry_date?: string;
};

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

function num(v: unknown, fallback = 0): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

export async function parseCsv(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (r) => resolve(r.data),
      error: (e) => reject(e),
    });
  });
}

export async function importProducts(rows: Record<string, string>[]): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  // Preload existing products keyed by sku (non-empty)
  const skus = rows.map((r) => str(r.sku)).filter(Boolean);
  const existing = new Map<string, string>();
  if (skus.length) {
    const { data } = await supabase
      .from("products")
      .select("id,sku")
      .in("sku", skus);
    data?.forEach((p) => {
      if (p.sku) existing.set(p.sku, p.id);
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = str(r.name);
    const selling = num(r.selling_price ?? r.price);
    if (!name || selling <= 0) {
      result.skipped++;
      result.errors.push({
        row: i + 2,
        message: !name ? "Missing name" : "Missing/invalid selling_price",
      });
      continue;
    }
    const payload = {
      name,
      sku: str(r.sku) || null,
      barcode: str(r.barcode) || null,
      brand: str(r.brand) || null,
      cost_price: num(r.cost_price),
      selling_price: selling,
      quantity: num(r.quantity),
      min_stock: num(r.min_stock, 5),
      expiry_date: str(r.expiry_date) || null,
    };

    const sku = payload.sku;
    const existingId = sku ? existing.get(sku) : undefined;
    if (existingId) {
      const { error } = await supabase.from("products").update(payload).eq("id", existingId);
      if (error) {
        result.errors.push({ row: i + 2, message: error.message });
        result.skipped++;
      } else result.updated++;
    } else {
      const { error } = await supabase.from("products").insert(payload);
      if (error) {
        result.errors.push({ row: i + 2, message: error.message });
        result.skipped++;
      } else result.created++;
    }
  }
  return result;
}

export function downloadSampleCsv() {
  const csv =
    "name,sku,barcode,brand,cost_price,selling_price,quantity,min_stock,expiry_date\n" +
    "Peak Milk 400g,PM400,6009880012345,Peak,1200,1500,50,10,2027-01-31\n" +
    "Indomie Chicken,IND-CHK,,Indomie,150,200,120,20,\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-spot-products-sample.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
