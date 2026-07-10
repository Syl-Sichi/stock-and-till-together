export function formatNaira(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "₦0";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  })
    .format(n)
    .replace("NGN", "₦")
    .replace(/^\s+/, "");
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-NG").format(n ?? 0);
}

export function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
