import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
} from 'recharts';
import {
  downloadExcel,
  formatDateVN,
  formatMonthVN,
  formatShortVND,
  formatVND,
  getDateKey,
  getItemNetTotal,
  getMonthKey,
  getPaymentMethodLabel,
} from '../lib/format';
import { downloadPrintableHtml, triggerHtmlPrint } from '../lib/print';
import { Order } from '../types/pos';

interface ReportsViewProps {
  orders: Order[];
  storeName: string;
  onNotify?: (message: string, tone?: 'success' | 'error') => void;
}

type ReportMode = 'daily' | 'monthly' | 'summary';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summarizeByCustomer(orderList: Order[]) {
  const map = new Map<string, { customer: string; ordersCount: number; totalSpent: number }>();
  orderList.forEach((o) => {
    const label = o.customerName?.trim() || 'Khách lẻ';
    const cur = map.get(label) || { customer: label, ordersCount: 0, totalSpent: 0 };
    cur.ordersCount += 1;
    cur.totalSpent += o.total;
    map.set(label, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}

export function ReportsView({ orders, storeName, onNotify }: ReportsViewProps) {
  const [mode, setMode] = useState<ReportMode>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(() => getDateKey(new Date()));
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getMonthKey(new Date()));
  const [printing, setPrinting] = useState(false);
  const [printFallbackHint, setPrintFallbackHint] = useState(false);

  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'completed' && !o.id.startsWith('seedord')),
    [orders],
  );

  // ---------------- DAILY REPORT DATA ----------------
  const dailyData = useMemo(() => {
    const dayOrders = completedOrders.filter((o) => o.dateKey === selectedDate);
    const revenue = dayOrders.reduce((s, o) => s + o.total, 0);
    const discount = dayOrders.reduce((s, o) => s + o.discountAmount, 0);
    const vat = dayOrders.reduce((s, o) => s + o.vatAmount, 0);
    const totalItemsSold = dayOrders.reduce(
      (s, o) => s + o.items.reduce((acc, it) => acc + it.qty, 0),
      0,
    );
    const avgOrder = dayOrders.length > 0 ? Math.round(revenue / dayOrders.length) : 0;

    const hourlyMap = new Map<number, { hour: string; revenue: number; count: number }>();
    for (let h = 6; h <= 23; h++) {
      hourlyMap.set(h, { hour: `${String(h).padStart(2, '0')}h`, revenue: 0, count: 0 });
    }
    dayOrders.forEach((o) => {
      const h = Math.min(23, Math.max(6, o.hourOfDay));
      const cur = hourlyMap.get(h)!;
      cur.revenue += o.total;
      cur.count += 1;
    });

    const paymentSplit = {
      cash: 0,
      transfer: 0,
      card: 0,
    };
    dayOrders.forEach((o) => {
      if (o.paymentMethod === 'cash') paymentSplit.cash += o.total;
      else if (o.paymentMethod === 'transfer') paymentSplit.transfer += o.total;
      else if (o.paymentMethod === 'card') paymentSplit.card += o.total;
    });

    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    dayOrders.forEach((o) => {
      o.items.forEach((it) => {
        const cur = itemMap.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
        cur.qty += it.qty;
        cur.revenue += getItemNetTotal(it);
        itemMap.set(it.name, cur);
      });
    });

    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    return {
      orders: dayOrders.sort((a, b) => b.displayTime.localeCompare(a.displayTime)),
      revenue,
      totalItemsSold,
      discount,
      vat,
      avgOrder,
      hourly: Array.from(hourlyMap.values()),
      paymentSplit,
      topItems,
    };
  }, [completedOrders, selectedDate]);

  // ---------------- MONTHLY REPORT DATA ----------------
  const monthlyData = useMemo(() => {
    const monthOrders = completedOrders
      .filter((o) => o.monthKey === selectedMonth)
      .sort((a, b) => {
        const cmpDate = b.dateKey.localeCompare(a.dateKey);
        if (cmpDate !== 0) return cmpDate;
        return b.displayTime.localeCompare(a.displayTime);
      });
    const revenue = monthOrders.reduce((s, o) => s + o.total, 0);
    const avgOrder = monthOrders.length > 0 ? Math.round(revenue / monthOrders.length) : 0;

    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = Number(yearStr) || new Date().getFullYear();
    const month = Number(monthStr) || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    const byDay = new Map<
      string,
      {
        dateKey: string;
        label: string;
        ordersCount: number;
        discount: number;
        vat: number;
        revenue: number;
      }
    >();

    for (let d = 1; d <= daysInMonth; d++) {
      const dd = String(d).padStart(2, '0');
      const dk = `${year}-${String(month).padStart(2, '0')}-${dd}`;
      byDay.set(dk, {
        dateKey: dk,
        label: dd,
        ordersCount: 0,
        discount: 0,
        vat: 0,
        revenue: 0,
      });
    }

    monthOrders.forEach((o) => {
      const row = byDay.get(o.dateKey);
      if (row) {
        row.ordersCount += 1;
        row.discount += o.discountAmount;
        row.vat += o.vatAmount;
        row.revenue += o.total;
      }
    });

    const dailySeries = Array.from(byDay.values());
    const activeDays = dailySeries.filter((d) => d.ordersCount > 0);
    const bestDay = activeDays.reduce(
      (best, cur) => (cur.revenue > best.revenue ? cur : best),
      { dateKey: '', label: '-', revenue: 0, ordersCount: 0, discount: 0, vat: 0 },
    );

    const catMap = new Map<string, { category: string; qty: number; revenue: number }>();
    monthOrders.forEach((o) => {
      o.items.forEach((it) => {
        const cur = catMap.get(it.category) || {
          category: it.category,
          qty: 0,
          revenue: 0,
        };
        cur.qty += it.qty;
        cur.revenue += getItemNetTotal(it);
        catMap.set(it.category, cur);
      });
    });

    return {
      orders: monthOrders,
      ordersCount: monthOrders.length,
      revenue,
      avgOrder,
      bestDay,
      dailySeries,
      activeDays: activeDays.sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
      categories: Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue),
      customers: summarizeByCustomer(monthOrders),
    };
  }, [completedOrders, selectedMonth]);

  // ---------------- SUMMARY / EXECUTIVE OVERVIEW ----------------
  const summaryData = useMemo(() => {
    const totalRevenue = completedOrders.reduce((s, o) => s + o.total, 0);
    const avgOrder =
      completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0;
    const totalItemsSold = completedOrders.reduce(
      (s, o) => s + o.items.reduce((acc, it) => acc + it.qty, 0),
      0,
    );

    const monthMap = new Map<
      string,
      { monthKey: string; label: string; revenue: number; count: number }
    >();
    completedOrders.forEach((o) => {
      const cur = monthMap.get(o.monthKey) || {
        monthKey: o.monthKey,
        label: formatMonthVN(o.monthKey),
        revenue: 0,
        count: 0,
      };
      cur.revenue += o.total;
      cur.count += 1;
      monthMap.set(o.monthKey, cur);
    });
    const monthlyTrend = Array.from(monthMap.values()).sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey),
    );

    const itemMap = new Map<
      string,
      { name: string; category: string; qty: number; revenue: number }
    >();
    completedOrders.forEach((o) => {
      o.items.forEach((it) => {
        const cur = itemMap.get(it.name) || {
          name: it.name,
          category: it.category,
          qty: 0,
          revenue: 0,
        };
        cur.qty += it.qty;
        cur.revenue += getItemNetTotal(it);
        itemMap.set(it.name, cur);
      });
    });

    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const payments = [
      {
        label: 'Tiền mặt',
        amount: completedOrders
          .filter((o) => o.paymentMethod === 'cash')
          .reduce((s, o) => s + o.total, 0),
      },
      {
        label: 'Chuyển khoản QR',
        amount: completedOrders
          .filter((o) => o.paymentMethod === 'transfer')
          .reduce((s, o) => s + o.total, 0),
      },
      {
        label: 'Thẻ ngân hàng',
        amount: completedOrders
          .filter((o) => o.paymentMethod === 'card')
          .reduce((s, o) => s + o.total, 0),
      },
    ];

    const sortedOrders = [...completedOrders].sort((a, b) => {
      const cmpDate = b.dateKey.localeCompare(a.dateKey);
      if (cmpDate !== 0) return cmpDate;
      return b.displayTime.localeCompare(a.displayTime);
    });

    return {
      orders: sortedOrders,
      totalOrders: completedOrders.length,
      totalRevenue,
      avgOrder,
      totalItemsSold,
      monthlyTrend,
      topItems,
      payments,
      customers: summarizeByCustomer(completedOrders),
    };
  }, [completedOrders]);

  const handleExportExcel = () => {
    if (mode === 'daily') {
      downloadExcel(`bao-cao-ngay-${selectedDate}.xlsx`, [
        {
          name: 'HoaDonNgay',
          headers: [
            'Mã HĐ',
            'Thời gian',
            'Khu vực / Bàn',
            'Khách hàng',
            'Hình thức TT',
            'Tạm tính',
            'Giảm giá',
            'Thuế VAT',
            'Tổng cộng',
          ],
          rows: dailyData.orders.map((o) => [
            o.orderNumber,
            o.displayTime,
            o.tableName,
            o.customerName?.trim() || 'Khách lẻ',
            getPaymentMethodLabel(o.paymentMethod),
            o.subtotal,
            o.discountAmount,
            o.vatAmount,
            o.total,
          ]),
        },
        {
          name: 'TongQuanNgay',
          headers: ['Chỉ tiêu', 'Giá trị'],
          rows: [
            ['Ngày báo cáo', formatDateVN(selectedDate)],
            ['Doanh thu ngày', dailyData.revenue],
            ['Số hóa đơn hoàn thành', dailyData.orders.length],
            ['Tổng số món đã bán', dailyData.totalItemsSold],
            ['Giá trị trung bình / hóa đơn', dailyData.avgOrder],
            ['Tổng giảm giá', dailyData.discount],
            ['Tổng thuế VAT', dailyData.vat],
            ['Tiền mặt', dailyData.paymentSplit.cash],
            ['Chuyển khoản QR', dailyData.paymentSplit.transfer],
            ['Thẻ ngân hàng', dailyData.paymentSplit.card],
          ],
        },
      ]);
      onNotify?.(`Đã xuất file Excel báo cáo ngày ${formatDateVN(selectedDate)}.`);
    } else if (mode === 'monthly') {
      downloadExcel(`bao-cao-thang-${selectedMonth}.xlsx`, [
        {
          name: 'DoanhThuTheoNgay',
          headers: ['Ngày', 'Số hóa đơn', 'Giảm giá', 'Thuế VAT', 'Doanh thu'],
          rows: monthlyData.activeDays.map((d) => [
            formatDateVN(d.dateKey),
            d.ordersCount,
            d.discount,
            d.vat,
            d.revenue,
          ]),
        },
        {
          name: 'ChiTietHoaDonThang',
          headers: [
            'Mã HĐ',
            'Ngày',
            'Thời gian',
            'Khu vực / Bàn',
            'Khách hàng',
            'Hình thức TT',
            'Tạm tính',
            'Giảm giá',
            'Thuế VAT',
            'Tổng cộng',
          ],
          rows: monthlyData.orders.map((o) => [
            o.orderNumber,
            formatDateVN(o.dateKey),
            o.displayTime,
            o.tableName,
            o.customerName?.trim() || 'Khách lẻ',
            getPaymentMethodLabel(o.paymentMethod),
            o.subtotal,
            o.discountAmount,
            o.vatAmount,
            o.total,
          ]),
        },
        {
          name: 'TheoKhachHang',
          headers: ['Khách hàng', 'Số hóa đơn', 'Tổng chi tiêu'],
          rows: monthlyData.customers.map((c) => [c.customer, c.ordersCount, c.totalSpent]),
        },
        {
          name: 'TheoNhomMon',
          headers: ['Nhóm món', 'Số lượng bán', 'Doanh thu'],
          rows: monthlyData.categories.map((c) => [c.category, c.qty, c.revenue]),
        },
      ]);
      onNotify?.(`Đã xuất file Excel báo cáo ${formatMonthVN(selectedMonth)}.`);
    } else {
      downloadExcel(`bao-cao-tong-hop-${getDateKey()}.xlsx`, [
        {
          name: 'TheoThang',
          headers: ['Tháng', 'Số hóa đơn', 'Doanh thu'],
          rows: summaryData.monthlyTrend.map((m) => [m.label, m.count, m.revenue]),
        },
        {
          name: 'TopMonBanChay',
          headers: ['Hạng', 'Tên món', 'Danh mục', 'SL bán', 'Doanh thu'],
          rows: summaryData.topItems.map((it, idx) => [
            idx + 1,
            it.name,
            it.category,
            it.qty,
            it.revenue,
          ]),
        },
        {
          name: 'TheoKhachHang',
          headers: ['Khách hàng', 'Số hóa đơn', 'Tổng chi tiêu'],
          rows: summaryData.customers.map((c) => [c.customer, c.ordersCount, c.totalSpent]),
        },
        {
          name: 'ChiTietHoaDon',
          headers: [
            'Mã HĐ',
            'Ngày',
            'Thời gian',
            'Khu vực / Bàn',
            'Khách hàng',
            'Hình thức TT',
            'Tổng cộng',
          ],
          rows: summaryData.orders.map((o) => [
            o.orderNumber,
            formatDateVN(o.dateKey),
            o.displayTime,
            o.tableName,
            o.customerName?.trim() || 'Khách lẻ',
            getPaymentMethodLabel(o.paymentMethod),
            o.total,
          ]),
        },
        {
          name: 'CoCauThanhToan',
          headers: ['Phương thức thanh toán', 'Doanh thu'],
          rows: summaryData.payments.map((p) => [p.label, p.amount]),
        },
      ]);
      onNotify?.('Đã xuất file Excel báo cáo tổng hợp kinh doanh.');
    }
  };

  const buildReportPrintHtml = () => {
    const title =
      mode === 'daily'
        ? `Báo cáo doanh thu ngày ${formatDateVN(selectedDate)}`
        : mode === 'monthly'
          ? `Báo cáo doanh thu ${formatMonthVN(selectedMonth)}`
          : 'Báo cáo tổng hợp kinh doanh';

    let kpiHtml = '';
    let tableHtml = '';

    if (mode === 'daily') {
      kpiHtml = `
        <div class="kpi-grid">
          <div class="kpi"><div class="lbl">Doanh thu ngày</div><div class="val accent">${escapeHtml(formatVND(dailyData.revenue))}</div></div>
          <div class="kpi"><div class="lbl">Số hóa đơn</div><div class="val">${dailyData.orders.length}</div></div>
          <div class="kpi"><div class="lbl">TB / hóa đơn</div><div class="val">${escapeHtml(formatVND(dailyData.avgOrder))}</div></div>
          <div class="kpi"><div class="lbl">Tổng món đã bán</div><div class="val">${dailyData.totalItemsSold}</div></div>
        </div>
      `;
      const rows =
        dailyData.orders.length === 0
          ? `<tr><td colspan="8" class="empty">Chưa có hóa đơn thanh toán trong ngày ${escapeHtml(formatDateVN(selectedDate))}.</td></tr>`
          : dailyData.orders
              .map(
                (o) => `<tr>
                  <td><strong>${escapeHtml(o.orderNumber)}</strong></td>
                  <td>${escapeHtml(o.displayTime)}</td>
                  <td>${escapeHtml(o.tableName)}</td>
                  <td>${escapeHtml(o.customerName?.trim() || 'Khách lẻ')}</td>
                  <td>${escapeHtml(getPaymentMethodLabel(o.paymentMethod))}</td>
                  <td class="right">${o.discountAmount > 0 ? `-${escapeHtml(formatVND(o.discountAmount))}` : '—'}</td>
                  <td class="right">${escapeHtml(formatVND(o.vatAmount))}</td>
                  <td class="right"><strong>${escapeHtml(formatVND(o.total))}</strong></td>
                </tr>`,
              )
              .join('');
      tableHtml = `
        <h3>Bảng kê hóa đơn</h3>
        <table>
          <thead>
            <tr>
              <th>Mã HĐ</th><th>Giờ</th><th>Khu vực</th><th>Khách hàng</th><th>Thanh toán</th>
              <th class="right">Giảm giá</th><th class="right">VAT</th><th class="right">Tổng tiền</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else if (mode === 'monthly') {
      kpiHtml = `
        <div class="kpi-grid">
          <div class="kpi"><div class="lbl">Doanh thu tháng</div><div class="val accent">${escapeHtml(formatVND(monthlyData.revenue))}</div></div>
          <div class="kpi"><div class="lbl">Tổng hóa đơn</div><div class="val">${monthlyData.ordersCount}</div></div>
          <div class="kpi"><div class="lbl">TB / hóa đơn</div><div class="val">${escapeHtml(formatVND(monthlyData.avgOrder))}</div></div>
          <div class="kpi"><div class="lbl">Ngày cao nhất</div><div class="val">${monthlyData.bestDay.revenue > 0 ? escapeHtml(formatVND(monthlyData.bestDay.revenue)) : '—'}</div></div>
        </div>
      `;
      const rows =
        monthlyData.activeDays.length === 0
          ? `<tr><td colspan="5" class="empty">Chưa có dữ liệu phát sinh trong ${escapeHtml(formatMonthVN(selectedMonth))}.</td></tr>`
          : monthlyData.activeDays
              .map(
                (d) => `<tr>
                  <td><strong>${escapeHtml(formatDateVN(d.dateKey))}</strong></td>
                  <td class="right">${d.ordersCount}</td>
                  <td class="right">${d.discount > 0 ? escapeHtml(formatVND(d.discount)) : '—'}</td>
                  <td class="right">${escapeHtml(formatVND(d.vat))}</td>
                  <td class="right accent"><strong>${escapeHtml(formatVND(d.revenue))}</strong></td>
                </tr>`,
              )
              .join('');
      tableHtml = `
        <h3>Tổng hợp doanh thu theo ngày</h3>
        <table>
          <thead>
            <tr>
              <th>Ngày</th><th class="right">Số hóa đơn</th><th class="right">Giảm giá</th>
              <th class="right">Thuế VAT</th><th class="right">Doanh thu</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      kpiHtml = `
        <div class="kpi-grid">
          <div class="kpi"><div class="lbl">Tổng doanh thu lũy kế</div><div class="val accent">${escapeHtml(formatVND(summaryData.totalRevenue))}</div></div>
          <div class="kpi"><div class="lbl">Tổng hóa đơn đã thu</div><div class="val">${summaryData.totalOrders}</div></div>
          <div class="kpi"><div class="lbl">Giá trị TB / hóa đơn</div><div class="val">${escapeHtml(formatVND(summaryData.avgOrder))}</div></div>
          <div class="kpi"><div class="lbl">Tổng món bán ra</div><div class="val">${summaryData.totalItemsSold}</div></div>
        </div>
      `;
      const rows =
        summaryData.topItems.length === 0
          ? `<tr><td colspan="5" class="empty">Chưa có dữ liệu thống kê món bán chạy.</td></tr>`
          : summaryData.topItems
              .map(
                (it, idx) => `<tr>
                  <td>${String(idx + 1).padStart(2, '0')}</td>
                  <td><strong>${escapeHtml(it.name)}</strong></td>
                  <td>${escapeHtml(it.category)}</td>
                  <td class="right">${it.qty}</td>
                  <td class="right accent"><strong>${escapeHtml(formatVND(it.revenue))}</strong></td>
                </tr>`,
              )
              .join('');
      tableHtml = `
        <h3>Top 10 món đóng góp doanh thu cao nhất</h3>
        <table>
          <thead>
            <tr>
              <th>Hạng</th><th>Tên món</th><th>Danh mục</th>
              <th class="right">SL bán</th><th class="right">Doanh thu</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} - ${escapeHtml(storeName)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; font-family: Tahoma, "Tahoma", Geneva, Verdana, sans-serif; }
    body { margin: 0; font-family: Tahoma, "Tahoma", Geneva, Verdana, sans-serif; color: #0f172a; font-size: 12px; font-variant-numeric: tabular-nums; }
    .head { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 10px; border-bottom: 1.5px solid #cbd5e1; margin-bottom: 14px; }
    .brand { font-size: 18px; font-weight: 700; color: #0e7490; }
    .sub { font-size: 13px; font-weight: 600; color: #334155; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .lbl { font-size: 11px; color: #64748b; }
    .val { font-size: 15px; font-weight: 700; margin-top: 4px; }
    .accent { color: #0e7490; }
    h3 { font-size: 13px; margin: 0 0 8px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { background: #f8fafc; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; color: #334155; }
    td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
    .right { text-align: right; white-space: nowrap; }
    .empty { text-align: center; color: #64748b; padding: 18px; }
  </style>
</head>
<body>
  <div class="head">
    <div class="brand">${escapeHtml(storeName)}</div>
    <div class="sub">${escapeHtml(title)}</div>
  </div>
  ${kpiHtml}
  ${tableHtml}
</body>
</html>`;
  };

  const handlePrintReport = async () => {
    setPrinting(true);
    setPrintFallbackHint(false);
    const html = buildReportPrintHtml();
    const result = await triggerHtmlPrint(html, 'a4');
    setPrinting(false);
    if (!result.printed) {
      setPrintFallbackHint(true);
    }
  };

  const handleDownloadPrintableReport = () => {
    const html = buildReportPrintHtml();
    const suffix =
      mode === 'daily' ? selectedDate : mode === 'monthly' ? selectedMonth : getDateKey();
    downloadPrintableHtml(`in-bao-cao-${mode}-${suffix}.html`, html);
    onNotify?.('Đã tải file báo cáo sẵn sàng in (.html).');
  };

  return (
    <div className="print-report-root p-5 sm:p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-zinc-200/75 rounded-xl no-print">
            {(
              [
                { id: 'daily', label: 'Báo cáo ngày' },
                { id: 'monthly', label: 'Báo cáo tháng' },
                { id: 'summary', label: 'Tổng hợp kinh doanh' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                  mode === tab.id
                    ? 'bg-white text-zinc-950 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'daily' && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono tabular-nums border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-emerald-700 no-print"
            />
          )}

          {mode === 'monthly' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono tabular-nums border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-emerald-700 no-print"
            />
          )}
        </div>

        <div className="flex items-center gap-2 no-print">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            Xuất Excel
          </button>
          <button
            type="button"
            onClick={handlePrintReport}
            disabled={printing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            {printing ? 'Đang mở cửa sổ in...' : 'In báo cáo'}
          </button>
        </div>
      </div>

      {printFallbackHint && (
        <div className="no-print bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-950">
          <span>
            Trình duyệt đang chặn cửa sổ in trong khung xem trước. Bạn có thể tải nhanh file báo cáo
            về và mở để hộp thoại in bật tự động.
          </span>
          <button
            type="button"
            onClick={handleDownloadPrintableReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Tải file in (.html)
          </button>
        </div>
      )}

      {/* Print-only Header */}
      <div className="hidden print:block pb-3 border-b border-zinc-300">
        <div className="text-lg font-bold">{storeName}</div>
        <div className="text-sm text-zinc-600">
          {mode === 'daily' && `Báo cáo doanh thu ngày ${formatDateVN(selectedDate)}`}
          {mode === 'monthly' && `Báo cáo doanh thu ${formatMonthVN(selectedMonth)}`}
          {mode === 'summary' && 'Báo cáo tổng hợp kinh doanh'}
        </div>
      </div>

      {/* ==================== DAILY VIEW ==================== */}
      {mode === 'daily' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">
                Doanh thu ngày {formatDateVN(selectedDate)}
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {formatVND(dailyData.revenue)}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Số hóa đơn hoàn thành</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-zinc-950">
                {dailyData.orders.length}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Giá trị TB / hóa đơn</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-zinc-950">
                {formatVND(dailyData.avgOrder)}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Tổng số món đã bán</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {dailyData.totalItemsSold}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Hourly Revenue Chart */}
            <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-zinc-950">
                  Doanh thu theo khung giờ ({formatDateVN(selectedDate)})
                </h3>
                <span className="text-xs text-zinc-500">Đơn vị: VNĐ</span>
              </div>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData.hourly} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={formatShortVND}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      formatter={(val) => [formatVND(Number(val ?? 0)), 'Doanh thu']}
                      contentStyle={{
                        borderRadius: '10px',
                        border: '1px solid #e4e4e7',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="revenue" fill="#047857" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Payment Split & Top Items Today */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col justify-between gap-5">
              <div>
                <h3 className="text-sm font-bold text-zinc-950 mb-3">
                  Phân bổ phương thức thanh toán
                </h3>
                <div className="space-y-2.5 text-xs">
                  {(
                    [
                      {
                        label: 'Tiền mặt',
                        val: dailyData.paymentSplit.cash,
                        bar: 'bg-emerald-700',
                      },
                      {
                        label: 'Chuyển khoản QR',
                        val: dailyData.paymentSplit.transfer,
                        bar: 'bg-zinc-900',
                      },
                      {
                        label: 'Thẻ ngân hàng',
                        val: dailyData.paymentSplit.card,
                        bar: 'bg-amber-600',
                      },
                    ] as const
                  ).map((row) => {
                    const pct =
                      dailyData.revenue > 0 ? Math.round((row.val / dailyData.revenue) * 100) : 0;
                    return (
                      <div key={row.label} className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-zinc-600">{row.label}</span>
                          <span className="font-mono tabular-nums font-semibold text-zinc-950">
                            {formatVND(row.val)} ({pct}%)
                          </span>
                        </div>
                        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${row.bar} rounded-full`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100">
                <h3 className="text-sm font-bold text-zinc-950 mb-2.5">Món bán chạy trong ngày</h3>
                {dailyData.topItems.length === 0 ? (
                  <p className="text-xs text-zinc-400">Chưa có giao dịch trong ngày này.</p>
                ) : (
                  <div className="space-y-2">
                    {dailyData.topItems.map((it) => (
                      <div key={it.name} className="flex items-center justify-between text-xs gap-2">
                        <span className="text-zinc-700 truncate">
                          {it.name}{' '}
                          <span className="font-mono tabular-nums text-zinc-400">×{it.qty}</span>
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-zinc-950 shrink-0">
                          {formatVND(it.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Daily Bill Ledger */}
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-950">
                Bảng kê hóa đơn ngày {formatDateVN(selectedDate)}
              </h3>
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {dailyData.orders.length} hóa đơn
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-600 font-semibold">
                    <th className="py-2.5 px-4">Mã HĐ</th>
                    <th className="py-2.5 px-4">Giờ</th>
                    <th className="py-2.5 px-4">Khu vực</th>
                    <th className="py-2.5 px-4">Khách hàng</th>
                    <th className="py-2.5 px-4">Thanh toán</th>
                    <th className="py-2.5 px-4 text-right">Giảm giá</th>
                    <th className="py-2.5 px-4 text-right">VAT</th>
                    <th className="py-2.5 px-4 text-right">Tổng tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {dailyData.orders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-zinc-500">
                        Chưa có hóa đơn thanh toán trong ngày {formatDateVN(selectedDate)}.
                      </td>
                    </tr>
                  ) : (
                    dailyData.orders.map((o) => (
                      <tr key={o.id} className="hover:bg-zinc-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-zinc-950">
                          {o.orderNumber}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-zinc-600">
                          {o.displayTime}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-700">{o.tableName}</td>
                        <td className="py-2.5 px-4 text-zinc-700">
                          {o.customerName?.trim() || 'Khách lẻ'}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-600">
                          {getPaymentMethodLabel(o.paymentMethod)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                          {o.discountAmount > 0 ? `-${formatVND(o.discountAmount)}` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-zinc-600">
                          {formatVND(o.vatAmount)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-zinc-950">
                          {formatVND(o.total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MONTHLY VIEW ==================== */}
      {mode === 'monthly' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">
                Doanh thu {formatMonthVN(selectedMonth)}
              </div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {formatVND(monthlyData.revenue)}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Tổng hóa đơn trong tháng</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-zinc-950">
                {monthlyData.ordersCount}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Giá trị TB / hóa đơn</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {formatVND(monthlyData.avgOrder)}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Ngày doanh thu cao nhất</div>
              <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-zinc-950">
                {monthlyData.bestDay.revenue > 0 ? formatVND(monthlyData.bestDay.revenue) : '—'}
              </div>
              {monthlyData.bestDay.dateKey && (
                <div className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
                  {formatDateVN(monthlyData.bestDay.dateKey)}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-zinc-950">
                  Biểu đồ doanh thu từng ngày — {formatMonthVN(selectedMonth)}
                </h3>
                <span className="text-xs text-zinc-500">Đơn vị: VNĐ</span>
              </div>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={monthlyData.dailySeries}
                    margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="emeraldRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={formatShortVND}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      formatter={(val) => [formatVND(Number(val ?? 0)), 'Doanh thu']}
                      labelFormatter={(label) => `Ngày ${label}/${selectedMonth.split('-')[1]}`}
                      contentStyle={{
                        borderRadius: '10px',
                        border: '1px solid #e4e4e7',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#047857"
                      strokeWidth={2}
                      fill="url(#emeraldRevenueGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-zinc-950 mb-3.5">Doanh thu theo nhóm món</h3>
              {monthlyData.categories.length === 0 ? (
                <p className="text-xs text-zinc-400">Chưa có dữ liệu bán hàng trong tháng này.</p>
              ) : (
                <div className="space-y-3 text-xs">
                  {monthlyData.categories.map((cat) => {
                    const totalCatRev = monthlyData.categories.reduce((s, c) => s + c.revenue, 0);
                    const pct = totalCatRev > 0 ? Math.round((cat.revenue / totalCatRev) * 100) : 0;
                    return (
                      <div key={cat.category} className="space-y-1">
                        <div className="flex justify-between">
                          <span className="font-semibold text-zinc-800">
                            {cat.category}{' '}
                            <span className="font-mono tabular-nums text-zinc-400">
                              ({cat.qty})
                            </span>
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-zinc-950">
                            {formatVND(cat.revenue)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-700 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Daily Summary Table for the Month */}
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-950">
                Tổng hợp doanh thu theo ngày — {formatMonthVN(selectedMonth)}
              </h3>
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {monthlyData.activeDays.length} ngày có doanh thu
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-600 font-semibold">
                    <th className="py-2.5 px-4">Ngày</th>
                    <th className="py-2.5 px-4 text-right">Số hóa đơn</th>
                    <th className="py-2.5 px-4 text-right">Giảm giá</th>
                    <th className="py-2.5 px-4 text-right">Thuế VAT</th>
                    <th className="py-2.5 px-4 text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {monthlyData.activeDays.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-zinc-500">
                        Chưa có dữ liệu phát sinh trong {formatMonthVN(selectedMonth)}.
                      </td>
                    </tr>
                  ) : (
                    monthlyData.activeDays.map((d) => (
                      <tr key={d.dateKey} className="hover:bg-zinc-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-zinc-950">
                          {formatDateVN(d.dateKey)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-zinc-700">
                          {d.ordersCount}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                          {d.discount > 0 ? formatVND(d.discount) : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-zinc-600">
                          {formatVND(d.vat)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                          {formatVND(d.revenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== EXECUTIVE SUMMARY VIEW ==================== */}
      {mode === 'summary' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Tổng doanh thu lũy kế</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {formatVND(summaryData.totalRevenue)}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Tổng hóa đơn đã thu</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-zinc-950">
                {summaryData.totalOrders}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Giá trị TB / hóa đơn</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {formatVND(summaryData.avgOrder)}
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="text-xs font-medium text-zinc-500">Tổng số lượng món bán ra</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-zinc-950">
                {summaryData.totalItemsSold}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Multi-month Revenue Chart */}
            <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-zinc-950">Biểu đồ doanh thu theo tháng</h3>
                <span className="text-xs text-zinc-500">Đơn vị: VNĐ</span>
              </div>
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={summaryData.monthlyTrend}
                    margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={formatShortVND}
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      formatter={(val) => [formatVND(Number(val ?? 0)), 'Doanh thu']}
                      contentStyle={{
                        borderRadius: '10px',
                        border: '1px solid #e4e4e7',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="revenue" fill="#047857" radius={[4, 4, 0, 0]} maxBarSize={42} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Payment Mix All-time */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-zinc-950">Cơ cấu dòng tiền thanh toán</h3>
              <div className="space-y-3.5 text-xs">
                {summaryData.payments.map((p) => {
                  const pct =
                    summaryData.totalRevenue > 0
                      ? Math.round((p.amount / summaryData.totalRevenue) * 100)
                      : 0;
                  return (
                    <div key={p.label} className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-zinc-600">{p.label}</span>
                        <span className="font-mono tabular-nums font-semibold text-zinc-950">
                          {formatVND(p.amount)} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-700 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Top 10 Best-Selling Items Table */}
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-950">
                Top 10 món đóng góp doanh thu cao nhất
              </h3>
              <span className="text-xs text-zinc-500">Toàn thời gian</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-600 font-semibold">
                    <th className="py-2.5 px-4 w-12">Hạng</th>
                    <th className="py-2.5 px-4">Tên món</th>
                    <th className="py-2.5 px-4">Danh mục</th>
                    <th className="py-2.5 px-4 text-right">SL bán</th>
                    <th className="py-2.5 px-4 text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {summaryData.topItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-zinc-500">
                        Chưa có dữ liệu thống kê món bán chạy.
                      </td>
                    </tr>
                  ) : (
                    summaryData.topItems.map((it, idx) => (
                      <tr key={it.name} className="hover:bg-zinc-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-zinc-500">
                          {String(idx + 1).padStart(2, '0')}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-zinc-950">{it.name}</td>
                        <td className="py-2.5 px-4 text-zinc-600">{it.category}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-zinc-800">
                          {it.qty}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                          {formatVND(it.revenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
