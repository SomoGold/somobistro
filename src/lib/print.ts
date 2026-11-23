import { Order, StoreSettings } from '../types/pos';
import {
  formatVND,
  getItemDiscountAmount,
  getItemNetTotal,
  getItemUnitPrice,
  getPaymentMethodLabel,
} from './format';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildA5InvoiceHtml(
  order: Order,
  settings: StoreSettings | null,
  isProvisional: boolean,
  qrDataUrl: string,
): string {
  const storeName = escapeHtml(settings?.storeName || 'Somo Bistro');
  const address = escapeHtml(settings?.address || '');
  const phone = escapeHtml(settings?.phone || '');
  const wifiInfo = escapeHtml(settings?.wifiInfo || '');
  const footerText = escapeHtml(
    settings?.receiptFooter || 'Cảm ơn quý khách đã ghé thăm Somo Bistro! Hẹn gặp lại.',
  );
  const title = isProvisional ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN';
  const totalQty = order.items.reduce((sum, item) => sum + item.qty, 0);

  const rowsHtml = order.items
    .map((item, idx) => {
      const unitPrice = getItemUnitPrice(item);
      const itemDiscount = getItemDiscountAmount(item);
      const netTotal = getItemNetTotal(item);
      const toppingsHtml =
        item.toppings && item.toppings.length > 0
          ? item.toppings
              .map(
                (t) =>
                  `<div class="item-topping">+ ${escapeHtml(t.name)} x${item.qty} = ${escapeHtml(
                    formatVND(t.price * item.qty),
                  )}</div>`,
              )
              .join('')
          : '';
      const discountLabel =
        itemDiscount > 0
          ? item.discountType === 'percent' && (item.discountValue ?? 0) > 0
            ? `-${item.discountValue}%<div class="item-disc-sub">(-${escapeHtml(formatVND(itemDiscount))})</div>`
            : `-${escapeHtml(formatVND(itemDiscount))}`
          : '—';

      return `
      <tr>
        <td class="col-center">${idx + 1}</td>
        <td>
          <div class="item-name">${escapeHtml(item.name)}</div>
          ${toppingsHtml}
          ${item.note ? `<div class="item-note">Ghi chú: ${escapeHtml(item.note)}</div>` : ''}
        </td>
        <td class="col-center">${item.qty}</td>
        <td class="col-right">${escapeHtml(formatVND(unitPrice))}</td>
        <td class="col-right item-disc">${discountLabel}</td>
        <td class="col-right font-semibold">${escapeHtml(formatVND(netTotal))}</td>
      </tr>
    `;
    })
    .join('');

  const bankDetailsHtml =
    settings?.bankName || settings?.bankAccount || settings?.bankOwner
      ? `
        <div style="margin-top: 6px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; font-size: 11px; line-height: 1.4;">
          <div style="font-weight: 700; color: #0e7490; margin-bottom: 2px;">Thông tin chuyển khoản:</div>
          ${settings?.bankName ? `<div>Ngân hàng: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
          ${settings?.bankAccount ? `<div>STK: <strong style="font-variant-numeric: tabular-nums;">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
          ${settings?.bankOwner ? `<div>Chủ TK: <strong>${escapeHtml(settings.bankOwner)}</strong></div>` : ''}
        </div>
      `
      : '';

  const qrBlockHtml = qrDataUrl
    ? `
      <div class="qr-box">
        <img src="${qrDataUrl}" alt="Mã QR chuyển khoản" class="qr-img" />
        <div class="qr-details">
          <div class="qr-title">Quét mã QR thanh toán</div>
          <div>${storeName}</div>
          <div class="font-semibold">Tổng tiền: ${escapeHtml(formatVND(order.total))}</div>
        </div>
      </div>
      ${bankDetailsHtml}
    `
    : bankDetailsHtml;

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>${title} - ${escapeHtml(order.orderNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: A5 portrait;
      margin: 8mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 12px;
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 100%;
      max-width: 148mm;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding-bottom: 10px;
      border-bottom: 1.5px solid #cbd5e1;
    }
    .brand {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2px;
    }
    .muted { color: #475569; font-size: 11px; }
    .invoice-title {
      font-size: 15px;
      font-weight: 700;
      color: #0e7490;
      text-align: right;
    }
    .invoice-meta {
      text-align: right;
      font-size: 11px;
      color: #334155;
      margin-top: 2px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 20px;
      padding: 10px 0;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11.5px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 11.5px;
    }
    thead th {
      background: #f8fafc;
      border-top: 1px solid #cbd5e1;
      border-bottom: 1px solid #cbd5e1;
      padding: 7px 6px;
      text-align: left;
      font-weight: 600;
      color: #334155;
    }
    tbody td {
      padding: 7px 6px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    .col-center { text-align: center; }
    .col-right { text-align: right; white-space: nowrap; }
    .font-semibold { font-weight: 600; }
    .item-name { font-weight: 500; color: #0f172a; }
    .item-topping { font-size: 10.5px; color: #0e7490; margin-top: 2px; }
    .item-note { font-size: 10.5px; color: #64748b; margin-top: 2px; }
    .item-disc { color: #b45309; font-size: 11px; }
    .item-disc-sub { font-size: 10px; color: #92400e; }
    .bottom-grid {
      display: grid;
      grid-template-columns: 1.05fr 1fr;
      gap: 16px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1.5px solid #cbd5e1;
      align-items: start;
    }
    .qr-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
    }
    .qr-img {
      width: 140px;
      height: 140px;
      object-fit: contain;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      padding: 4px;
      flex-shrink: 0;
    }
    .qr-details { font-size: 11px; color: #334155; line-height: 1.5; }
    .qr-title { font-weight: 700; color: #0e7490; margin-bottom: 2px; }
    .totals { font-size: 11.5px; }
    .tot-row {
      display: flex;
      justify-content: space-between;
      padding: 2.5px 0;
      color: #334155;
    }
    .tot-grand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid #cbd5e1;
      font-size: 14px;
      font-weight: 700;
      color: #0e7490;
    }
    .extra-info { margin-top: 8px; font-size: 11px; color: #475569; }
    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
      text-align: center;
      font-size: 11px;
      color: #475569;
    }
    .footer-italic { font-style: italic; color: #1e293b; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="brand">${storeName}</div>
        ${address ? `<div class="muted">${address}</div>` : ''}
        ${phone ? `<div class="muted">Hotline: ${phone}</div>` : ''}
      </div>
      <div>
        <div class="invoice-title">${title}</div>
        <div class="invoice-meta"><strong>Số HĐ:</strong> ${escapeHtml(order.orderNumber)}</div>
        <div class="invoice-meta">${escapeHtml(order.displayTime)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-row"><span class="muted">Khu vực / Bàn:</span><strong>${escapeHtml(order.tableName)}</strong></div>
      <div class="meta-row"><span class="muted">Thu ngân:</span><span>${escapeHtml(order.cashierName || 'Thu ngân')}</span></div>
      <div class="meta-row"><span class="muted">Khách hàng:</span><span>${escapeHtml(order.customerName || 'Khách lẻ')}</span></div>
      <div class="meta-row"><span class="muted">Thanh toán:</span><span>${escapeHtml(isProvisional ? 'Chưa thanh toán' : getPaymentMethodLabel(order.paymentMethod))}</span></div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:30px" class="col-center">STT</th>
          <th>Tên món</th>
          <th style="width:34px" class="col-center">SL</th>
          <th style="width:74px" class="col-right">Đơn giá</th>
          <th style="width:74px" class="col-right">Chiết khấu</th>
          <th style="width:84px" class="col-right">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="bottom-grid">
      <div>
        ${qrBlockHtml}
        ${order.note ? `<div class="extra-info"><strong>Ghi chú đơn:</strong> ${escapeHtml(order.note)}</div>` : ''}
        ${wifiInfo ? `<div class="extra-info">Wi-Fi: ${wifiInfo}</div>` : ''}
      </div>
      <div class="totals">
        <div class="tot-row"><span>Tạm tính (${totalQty} món):</span><span class="font-semibold">${escapeHtml(formatVND(order.subtotal))}</span></div>
        ${
          order.discountAmount > 0
            ? `<div class="tot-row"><span>Giảm giá${order.discountType === 'percent' ? ` (${order.discountValue}%)` : ''}:</span><span>-${escapeHtml(formatVND(order.discountAmount))}</span></div>`
            : ''
        }
        ${
          order.vatRate > 0
            ? `<div class="tot-row"><span>Thuế VAT (${order.vatRate}%):</span><span>${escapeHtml(formatVND(order.vatAmount))}</span></div>`
            : ''
        }
        <div class="tot-grand"><span>TỔNG CỘNG:</span><span>${escapeHtml(formatVND(order.total))}</span></div>
        ${
          !isProvisional && order.paymentMethod === 'cash'
            ? `
          <div class="tot-row" style="margin-top:4px"><span>Tiền khách đưa:</span><span>${escapeHtml(formatVND(order.cashReceived))}</span></div>
          <div class="tot-row"><span>Tiền thối lại:</span><span class="font-semibold">${escapeHtml(formatVND(order.changeAmount))}</span></div>
        `
            : ''
        }
      </div>
    </div>

    <div class="footer">
      <div class="footer-italic">${footerText}</div>
    </div>
  </div>
</body>
</html>`;
}

export function build80mmReceiptHtml(
  order: Order,
  settings: StoreSettings | null,
  isProvisional: boolean,
  qrDataUrl: string,
): string {
  const storeName = escapeHtml(settings?.storeName || 'Somo Bistro');
  const address = escapeHtml(settings?.address || '');
  const phone = escapeHtml(settings?.phone || '');
  const wifiInfo = escapeHtml(settings?.wifiInfo || '');
  const footerText = escapeHtml(
    settings?.receiptFooter || 'Cảm ơn quý khách đã ghé thăm Somo Bistro! Hẹn gặp lại.',
  );
  const title = isProvisional ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN';
  const totalQty = order.items.reduce((sum, item) => sum + item.qty, 0);

  const itemsHtml = order.items
    .map((item, idx) => {
      const unitPrice = getItemUnitPrice(item);
      const itemDiscount = getItemDiscountAmount(item);
      const netTotal = getItemNetTotal(item);
      const toppingsHtml =
        item.toppings && item.toppings.length > 0
          ? item.toppings
              .map(
                (t) =>
                  `<div class="sub-line">+ ${escapeHtml(t.name)} x${item.qty} = ${escapeHtml(
                    formatVND(t.price * item.qty),
                  )}</div>`,
              )
              .join('')
          : '';
      const noteHtml = item.note
        ? `<div class="sub-line">Ghi chú: ${escapeHtml(item.note)}</div>`
        : '';
      const discHtml =
        itemDiscount > 0
          ? `<div class="disc-line">Chiết khấu món: ${
              item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                ? `-${item.discountValue}% (-${escapeHtml(formatVND(itemDiscount))})`
                : `-${escapeHtml(formatVND(itemDiscount))}`
            }</div>`
          : '';

      return `
      <div class="item-block">
        <div class="item-name">${idx + 1}. ${escapeHtml(item.name)}</div>
        ${toppingsHtml}
        ${noteHtml}
        <div class="item-calc">
          <span>${item.qty} × ${escapeHtml(formatVND(unitPrice))}</span>
          <span class="font-bold">${escapeHtml(formatVND(netTotal))}</span>
        </div>
        ${discHtml}
      </div>
    `;
    })
    .join('');

  const bankDetailsHtml =
    settings?.bankName || settings?.bankAccount || settings?.bankOwner
      ? `
        <div style="margin-top: 6px; padding: 5px; border: 1px dashed #000000; border-radius: 4px; font-size: 10.5px; line-height: 1.4;">
          <div style="font-weight: 700; margin-bottom: 2px;">Thông tin chuyển khoản:</div>
          ${settings?.bankName ? `<div>Ngân hàng: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
          ${settings?.bankAccount ? `<div>STK: <strong style="font-variant-numeric: tabular-nums;">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
          ${settings?.bankOwner ? `<div>Chủ TK: <strong>${escapeHtml(settings.bankOwner)}</strong></div>` : ''}
        </div>
      `
      : '';

  const qrBlockHtml = qrDataUrl
    ? `
      <div class="qr-section">
        <div class="qr-heading">QUÉT MÃ QR THANH TOÁN</div>
        <img src="${qrDataUrl}" alt="Mã QR thanh toán" class="qr-img-80" />
        <div class="qr-amount">${escapeHtml(formatVND(order.total))}</div>
      </div>
      ${bankDetailsHtml}
    `
    : bankDetailsHtml;

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>${title} 80mm - ${escapeHtml(order.orderNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: 80mm auto;
      margin: 2mm 3mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      width: 74mm;
      margin-left: auto;
      margin-right: auto;
      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #000000;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .brand { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
    .muted { font-size: 10px; color: #222222; }
    .title {
      font-size: 13px;
      font-weight: 800;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #000000;
    }
    .divider { border-top: 1px dashed #000000; margin: 7px 0; }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      font-size: 10.5px;
      padding: 1px 0;
    }
    .item-block {
      padding: 4px 0;
      border-bottom: 1px dotted #94a3b8;
    }
    .item-name { font-weight: 700; font-size: 11.5px; }
    .sub-line { font-size: 10px; color: #334155; padding-left: 8px; }
    .disc-line { font-size: 10px; color: #92400e; padding-left: 8px; font-weight: 600; }
    .item-calc {
      display: flex;
      justify-content: space-between;
      padding-left: 8px;
      margin-top: 1px;
      font-size: 11px;
    }
    .font-bold { font-weight: 700; }
    .tot-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      font-size: 11px;
    }
    .tot-grand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 5px 0 3px;
      margin-top: 4px;
      border-top: 1px solid #000000;
      font-size: 14px;
      font-weight: 800;
    }
    .qr-section {
      text-align: center;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #000000;
    }
    .qr-heading { font-size: 10.5px; font-weight: 700; margin-bottom: 4px; }
    .qr-img-80 {
      width: 150px;
      height: 150px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .qr-amount { font-size: 12px; font-weight: 800; margin-top: 3px; }
    .footer {
      text-align: center;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px dashed #000000;
      font-size: 10.5px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="center">
    <div class="brand">${storeName}</div>
    ${address ? `<div class="muted">${address}</div>` : ''}
    ${phone ? `<div class="muted">ĐT: ${phone}</div>` : ''}
    <div class="title">${title}</div>
  </div>

  <div class="divider"></div>

  <div class="meta-row"><span>Số HĐ:</span><strong>${escapeHtml(order.orderNumber)}</strong></div>
  <div class="meta-row"><span>Thời gian:</span><span>${escapeHtml(order.displayTime)}</span></div>
  <div class="meta-row"><span>Bàn / Khu:</span><strong>${escapeHtml(order.tableName)}</strong></div>
  <div class="meta-row"><span>Khách hàng:</span><span>${escapeHtml(order.customerName || 'Khách lẻ')}</span></div>
  <div class="meta-row"><span>Thu ngân:</span><span>${escapeHtml(order.cashierName || 'Thu ngân')}</span></div>
  <div class="meta-row"><span>Thanh toán:</span><span>${escapeHtml(isProvisional ? 'Chưa thanh toán' : getPaymentMethodLabel(order.paymentMethod))}</span></div>

  <div class="divider"></div>

  ${itemsHtml}

  <div class="divider"></div>

  <div class="tot-row"><span>Tạm tính (${totalQty} món):</span><span class="font-bold">${escapeHtml(formatVND(order.subtotal))}</span></div>
  ${
    order.discountAmount > 0
      ? `<div class="tot-row"><span>Giảm giá${order.discountType === 'percent' ? ` (${order.discountValue}%)` : ''}:</span><span>-${escapeHtml(formatVND(order.discountAmount))}</span></div>`
      : ''
  }
  ${
    order.vatRate > 0
      ? `<div class="tot-row"><span>Thuế VAT (${order.vatRate}%):</span><span>${escapeHtml(formatVND(order.vatAmount))}</span></div>`
      : ''
  }
  <div class="tot-grand"><span>TỔNG CỘNG:</span><span>${escapeHtml(formatVND(order.total))}</span></div>
  ${
    !isProvisional && order.paymentMethod === 'cash'
      ? `
    <div class="tot-row"><span>Khách đưa:</span><span>${escapeHtml(formatVND(order.cashReceived))}</span></div>
    <div class="tot-row"><span>Tiền thối lại:</span><span class="font-bold">${escapeHtml(formatVND(order.changeAmount))}</span></div>
  `
      : ''
  }

  ${order.note ? `<div class="muted" style="margin-top:6px"><strong>Ghi chú:</strong> ${escapeHtml(order.note)}</div>` : ''}
  ${wifiInfo ? `<div class="muted" style="margin-top:3px">Wi-Fi: ${wifiInfo}</div>` : ''}

  ${qrBlockHtml}

  <div class="footer">${footerText}</div>
</body>
</html>`;
}

/**
 * Triggers the native browser Print dialog via a dedicated hidden iframe containing
 * clean standalone HTML/CSS (works reliably across desktop browsers & modals without
 * layout clipping). Returns true if invoked cleanly, or false if the host sandbox suppressed it.
 */
export function triggerHtmlPrint(html: string): Promise<{ printed: boolean }> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1000);
    };

    const runPrint = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          cleanup();
          resolve({ printed: false });
          return;
        }
        win.focus();
        const started = Date.now();
        win.print();
        const elapsed = Date.now() - started;
        cleanup();
        // If print() returned synchronously in < 25ms inside a sandboxed iframe, the
        // browser may have suppressed the native print popup due to iframe sandbox policy.
        resolve({ printed: elapsed >= 25 || window.top === window.self });
      } catch {
        cleanup();
        try {
          window.print();
          resolve({ printed: true });
        } catch {
          resolve({ printed: false });
        }
      }
    };

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      cleanup();
      resolve({ printed: false });
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Wait briefly for inline image/layout paint before invoking print
    window.setTimeout(runPrint, 220);
  });
}

export function downloadPrintableHtml(filename: string, html: string) {
  const printable = html.replace(
    '</body>',
    '<script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 250); });</script></body>',
  );
  const blob = new Blob([printable], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
