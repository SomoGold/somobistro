import * as XLSX from 'xlsx';
import { DiscountType, Order, OrderItem, PaymentMethod } from '../types/pos';

export function resolveAssetUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('/src/assets/')) {
    const base = import.meta.env.BASE_URL || '/';
    return `${base.replace(/\/$/, '')}${url}`;
  }
  return url;
}

export function formatVND(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return new Intl.NumberFormat('vi-VN').format(safe) + ' ₫';
}

export function formatDotNumber(value: number | string): string {
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return '';
  const num = Number(digits);
  if (!Number.isFinite(num)) return '';
  return new Intl.NumberFormat('vi-VN').format(num);
}

export function parseDotNumber(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return 0;
  const num = Number(digits);
  return Number.isFinite(num) ? num : 0;
}

export function formatShortVND(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (Math.abs(safe) >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1).replace(/\.0$/, '')}tr`;
  }
  if (Math.abs(safe) >= 1_000) {
    return `${Math.round(safe / 1_000)}k`;
  }
  return `${Math.round(safe)}`;
}

export function getDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMonthKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatDateVN(dateKey: string): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatMonthVN(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  return `Tháng ${Number(parts[1])}/${parts[0]}`;
}

export function formatDisplayTime(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

export function generateDocId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function generateOrderNumber(
  date: Date = new Date(),
  existingOrders: ReadonlyArray<Pick<Order, 'dateKey' | 'orderNumber'>> = [],
): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const prefix = `HD${yy}${mm}${dd}-`;
  const todayKey = getDateKey(date);

  const todayOrders = existingOrders.filter(
    (o) => o.dateKey === todayKey || o.orderNumber.startsWith(prefix),
  );
  const usedNumbers = new Set(todayOrders.map((o) => o.orderNumber));

  let nextSeq = todayOrders.length + 1;
  while (usedNumbers.has(`${prefix}${String(nextSeq).padStart(3, '0')}`)) {
    nextSeq += 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

export function getItemToppingTotal(item: OrderItem): number {
  if (!item.toppings || item.toppings.length === 0) return 0;
  return item.toppings.reduce((sum, t) => sum + (Number.isFinite(t.price) ? Math.max(0, t.price) : 0), 0);
}

export function getItemUnitPrice(item: OrderItem): number {
  const basePrice = Number.isFinite(item.price) ? Math.max(0, item.price) : 0;
  return basePrice + getItemToppingTotal(item);
}

export function getItemGrossTotal(item: OrderItem): number {
  const safeQty = Number.isFinite(item.qty) ? Math.min(999, Math.max(1, Math.round(item.qty))) : 1;
  return getItemUnitPrice(item) * safeQty;
}

export function getItemDiscountAmount(item: OrderItem): number {
  const gross = getItemGrossTotal(item);
  const type = item.discountType ?? 'percent';
  const rawVal = item.discountValue ?? 0;
  const val = Number.isFinite(rawVal) ? rawVal : 0;
  if (val <= 0) {
    const rawAmt = item.discountAmount ?? 0;
    if (Number.isFinite(rawAmt) && rawAmt > 0) {
      return Math.min(gross, Math.max(0, Math.round(rawAmt)));
    }
    return 0;
  }
  if (type === 'percent') {
    const pct = Math.min(100, Math.max(0, val));
    return Math.round((gross * pct) / 100);
  }
  return Math.min(gross, Math.max(0, Math.round(val)));
}

export function getItemNetTotal(item: OrderItem): number {
  return Math.max(0, getItemGrossTotal(item) - getItemDiscountAmount(item));
}

function safeInt(value: unknown, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function normalizeOrderItemForSave(item: OrderItem): OrderItem {
  const safePrice = safeInt(item.price, 0, 100_000_000);
  const safeCost = safeInt(item.cost, 0, 100_000_000);
  const safeQty = safeInt(item.qty, 1, 999);
  const safeToppings = (item.toppings ?? [])
    .filter((t) => t && String(t.id ?? '').trim().length > 0 && String(t.name ?? '').trim().length > 0)
    .slice(0, 15)
    .map((t) => ({
      id: String(t.id).trim().slice(0, 128),
      name: String(t.name).trim().slice(0, 80),
      price: safeInt(t.price, 0, 100_000_000),
    }));

  const discountType: DiscountType = item.discountType === 'fixed' ? 'fixed' : 'percent';
  const discountValue = safeInt(
    item.discountValue ?? 0,
    0,
    discountType === 'percent' ? 100 : 1_000_000_000,
  );

  const normalized: OrderItem = {
    itemId: (String(item.itemId ?? '').trim() || 'item').slice(0, 128),
    name: (String(item.name ?? '').trim() || 'Món').slice(0, 120),
    category: (String(item.category ?? '').trim() || 'Khác').slice(0, 40),
    price: safePrice,
    cost: safeCost,
    qty: safeQty,
    note: String(item.note ?? '').slice(0, 150),
  };

  const discountAmount = safeInt(
    getItemDiscountAmount({
      ...normalized,
      toppings: safeToppings,
      discountType,
      discountValue,
    }),
    0,
    1_000_000_000,
  );

  if (safeToppings.length > 0) {
    normalized.toppings = safeToppings;
  }

  if (discountValue > 0 || discountAmount > 0) {
    normalized.discountType = discountType;
    normalized.discountValue = discountValue;
    normalized.discountAmount = discountAmount;
  }

  return normalized;
}

export function calculateOrderTotals(
  items: OrderItem[],
  discountType: DiscountType,
  discountValue: number,
  vatRate: number,
) {
  const grossSubtotal = safeInt(
    items.reduce((sum, item) => sum + getItemGrossTotal(item), 0),
    0,
    1_000_000_000,
  );
  const itemDiscountTotal = safeInt(
    items.reduce((sum, item) => sum + getItemDiscountAmount(item), 0),
    0,
    1_000_000_000,
  );
  const subtotal = safeInt(
    items.reduce((sum, item) => sum + getItemNetTotal(item), 0),
    0,
    1_000_000_000,
  );
  const costTotal = safeInt(
    items.reduce((sum, item) => {
      const unitCost = Number.isFinite(item.cost) ? Math.max(0, item.cost) : 0;
      const qty = Number.isFinite(item.qty) ? Math.max(1, Math.round(item.qty)) : 1;
      return sum + unitCost * qty;
    }, 0),
    0,
    1_000_000_000,
  );

  const safeDiscountValue = Number.isFinite(discountValue) ? Math.max(0, discountValue) : 0;
  let discountAmount = 0;
  if (discountType === 'percent') {
    const clampedPct = Math.min(100, safeDiscountValue);
    discountAmount = Math.round((subtotal * clampedPct) / 100);
  } else {
    discountAmount = Math.min(subtotal, Math.round(safeDiscountValue));
  }
  discountAmount = safeInt(discountAmount, 0, 1_000_000_000);

  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const safeVatRate = Number.isFinite(vatRate) ? Math.min(30, Math.max(0, vatRate)) : 0;
  const vatAmount = safeInt(Math.round((afterDiscount * safeVatRate) / 100), 0, 1_000_000_000);
  const total = safeInt(afterDiscount + vatAmount, 0, 1_000_000_000);

  return {
    grossSubtotal,
    itemDiscountTotal,
    subtotal,
    costTotal,
    discountAmount,
    vatAmount,
    total,
  };
}

export function getPaymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case 'cash':
      return 'Tiền mặt';
    case 'transfer':
      return 'Chuyển khoản QR';
    case 'card':
      return 'Thẻ ngân hàng';
    default:
      return 'Chưa thanh toán';
  }
}

export interface ExcelSheetSpec {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

export function downloadExcel(filename: string, sheets: ExcelSheetSpec[]) {
  const wb = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const aoa: (string | number)[][] = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Auto-calculate clean column widths based on content length
    ws['!cols'] = sheet.headers.map((header, colIdx) => {
      const maxLen = Math.max(
        header.length,
        ...sheet.rows.map((row) => String(row[colIdx] ?? '').length),
      );
      return { wch: Math.min(42, Math.max(12, maxLen + 4)) };
    });

    const safeSheetName = sheet.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '');
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName || 'BaoCao');
  });

  const finalName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, finalName);
}
