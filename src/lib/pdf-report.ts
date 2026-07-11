import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import { formatNaira, formatNumber } from "./format";

export type ReportData = {
  period: "week" | "month" | "day";
  storeName: string;
  since: Date;
  until: Date;
  revenue: number;
  profit: number;
  txCount: number;
  itemsSold: number;
  payments: Record<string, number>;
  rows: { name: string; qty: number; total: number }[];
  daily: { date: string; revenue: number; profit: number; tx: number }[];
  lowStock: { name: string; quantity: number; min_stock: number }[];
};

function periodLabel(p: ReportData["period"]) {
  return p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly";
}

async function captureChart(el: HTMLElement): Promise<string | null> {
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function generateReportPdf(
  data: ReportData,
  chartEls: HTMLElement[] = [],
): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const primary: [number, number, number] = [22, 163, 74];

  // Header band
  doc.setFillColor(...primary);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(data.storeName, margin, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`${periodLabel(data.period)} sales report`, margin, 60);
  doc.text(
    `${data.since.toLocaleDateString()} – ${data.until.toLocaleDateString()}`,
    margin,
    76,
  );

  doc.setTextColor(17, 24, 39);
  let y = 120;

  // Stat cards
  const stats = [
    { label: "Revenue", value: formatNaira(data.revenue) },
    { label: "Profit", value: formatNaira(data.profit) },
    { label: "Transactions", value: formatNumber(data.txCount) },
    { label: "Items sold", value: formatNumber(data.itemsSold) },
  ];
  const cardW = (pageWidth - margin * 2 - 24) / 4;
  stats.forEach((s, i) => {
    const x = margin + i * (cardW + 8);
    doc.setDrawColor(229, 231, 235);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(x, y, cardW, 60, 8, 8, "FD");
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(s.label.toUpperCase(), x + 10, y + 18);
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.text(s.value, x + 10, y + 42);
    doc.setFont("helvetica", "normal");
  });
  y += 80;

  // Charts
  for (const el of chartEls) {
    const img = await captureChart(el);
    if (!img) continue;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (el.offsetHeight / el.offsetWidth) * imgWidth;
    if (y + imgHeight > 780) {
      doc.addPage();
      y = margin;
    }
    doc.addImage(img, "PNG", margin, y, imgWidth, imgHeight);
    y += imgHeight + 16;
  }

  // Daily breakdown table
  if (data.daily.length) {
    if (y > 680) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Daily breakdown", margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Date", "Transactions", "Revenue", "Profit"]],
      body: data.daily.map((d) => [
        d.date,
        formatNumber(d.tx),
        formatNaira(d.revenue),
        formatNaira(d.profit),
      ]),
      headStyles: { fillColor: primary, textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    // @ts-expect-error jspdf-autotable augments doc
    y = (doc.lastAutoTable?.finalY ?? y) + 20;
  }

  // Top products
  if (data.rows.length) {
    if (y > 680) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Top products", margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Product", "Qty sold", "Revenue"]],
      body: data.rows
        .slice(0, 25)
        .map((r) => [r.name, formatNumber(r.qty), formatNaira(r.total)]),
      headStyles: { fillColor: primary, textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    // @ts-expect-error jspdf-autotable augments doc
    y = (doc.lastAutoTable?.finalY ?? y) + 20;
  }

  // Payment breakdown
  if (Object.keys(data.payments).length) {
    if (y > 680) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Payment methods", margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Method", "Total"]],
      body: Object.entries(data.payments).map(([k, v]) => [
        k.charAt(0).toUpperCase() + k.slice(1),
        formatNaira(v),
      ]),
      headStyles: { fillColor: primary, textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    // @ts-expect-error jspdf-autotable augments doc
    y = (doc.lastAutoTable?.finalY ?? y) + 20;
  }

  // Low stock snapshot
  if (data.lowStock.length) {
    if (y > 680) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Low-stock snapshot", margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [["Product", "In stock", "Min"]],
      body: data.lowStock.map((p) => [
        p.name,
        formatNumber(p.quantity),
        formatNumber(p.min_stock),
      ]),
      headStyles: { fillColor: primary, textColor: 255 },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
  }

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(
      `Generated ${new Date().toLocaleString()} — My Spot`,
      margin,
      doc.internal.pageSize.getHeight() - 20,
    );
    doc.text(
      `Page ${i} / ${pages}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" },
    );
  }

  const fname = `my-spot-${data.period}-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
