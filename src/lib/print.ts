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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
      width: 104px;
      height: 104px;
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
                  `<div class="r80-sub">+ ${escapeHtml(t.name)} x${item.qty} = ${escapeHtml(
                    formatVND(t.price * item.qty),
                  )}</div>`,
              )
              .join('')
          : '';
      const noteHtml = item.note
        ? `<div class="r80-sub">Ghi chú: ${escapeHtml(item.note)}</div>`
        : '';
      const discHtml =
        itemDiscount > 0
          ? `<div class="r80-disc">Chiết khấu món: ${
              item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                ? `-${item.discountValue}% (-${escapeHtml(formatVND(itemDiscount))})`
                : `-${escapeHtml(formatVND(itemDiscount))}`
            }</div>`
          : '';

      return `
      <div class="r80-item">
        <div class="r80-item-name">${idx + 1}. ${escapeHtml(item.name)}</div>
        ${toppingsHtml}
        ${noteHtml}
        <div class="r80-calc">
          <span>${item.qty} × ${escapeHtml(formatVND(unitPrice))}</span>
          <span class="r80-bold">${escapeHtml(formatVND(netTotal))}</span>
        </div>
        ${discHtml}
      </div>
    `;
    })
    .join('');

  const bankDetailsHtml =
    settings?.bankName || settings?.bankAccount || settings?.bankOwner
      ? `
        <div class="r80-bank">
          <div class="r80-bank-title">Thông tin chuyển khoản:</div>
          ${settings?.bankName ? `<div>Ngân hàng: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
          ${settings?.bankAccount ? `<div>STK: <strong class="r80-tabular">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
          ${settings?.bankOwner ? `<div>Chủ TK: <strong>${escapeHtml(settings.bankOwner)}</strong></div>` : ''}
        </div>
      `
      : '';

  const qrBlockHtml = qrDataUrl
    ? `
      <div class="r80-qr-section">
        <div class="r80-qr-heading">QUÉT MÃ QR THANH TOÁN</div>
        <img src="${qrDataUrl}" alt="Mã QR thanh toán" class="r80-qr-img" />
        <div class="r80-qr-amount">${escapeHtml(formatVND(order.total))}</div>
      </div>
      ${bankDetailsHtml}
    `
    : bankDetailsHtml;

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} 80mm - ${escapeHtml(order.orderNumber)}</title>
  <style>
    @page {
      margin: 0;
    }
    .r80-sheet {
      --u: 1vw;
      box-sizing: border-box;
      width: 100%;
      margin: 0;
      padding: calc(var(--u) * 1.8) calc(var(--u) * 3);
      background: #ffffff;
      color: #000000;
      font-family: Arial, Helvetica, "Roboto", "Segoe UI", sans-serif;
      font-size: calc(var(--u) * 4.8);
      line-height: 1.32;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      word-break: break-word;
      overflow-wrap: break-word;
      -webkit-text-size-adjust: 100%;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .r80-sheet * {
      box-sizing: border-box;
    }
    /* Screen-only preview sizing when opened as a standalone .html file */
    @media screen {
      .r80-sheet {
        --u: 3.02px;
        width: 80mm;
        margin: 0 auto;
      }
    }
    .r80-tabular { font-variant-numeric: tabular-nums; }
    .r80-center { text-align: center; }
    .r80-brand {
      font-size: calc(var(--u) * 7.2);
      font-weight: 800;
      letter-spacing: -0.01em;
      line-height: 1.18;
      color: #000000;
    }
    .r80-muted {
      font-size: calc(var(--u) * 4.2);
      font-weight: 600;
      color: #000000;
      margin-top: calc(var(--u) * 0.4);
    }
    .r80-title {
      font-size: calc(var(--u) * 5.6);
      font-weight: 800;
      margin-top: calc(var(--u) * 1.6);
      padding-top: calc(var(--u) * 1.6);
      border-top: calc(var(--u) * 0.45) dashed #000000;
      color: #000000;
    }
    .r80-divider {
      border-top: calc(var(--u) * 0.45) dashed #000000;
      margin: calc(var(--u) * 1.8) 0;
    }
    .r80-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      font-size: calc(var(--u) * 4.5);
      font-weight: 600;
      padding: calc(var(--u) * 0.35) 0;
      color: #000000;
    }
    .r80-meta > span:first-child { flex-shrink: 0; }
    .r80-meta > span:last-child,
    .r80-meta > strong {
      text-align: right;
      font-weight: 800;
    }
    .r80-item {
      padding: calc(var(--u) * 1.3) 0;
      border-bottom: calc(var(--u) * 0.35) dotted #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r80-item:last-child { border-bottom: none; }
    .r80-item-name {
      font-weight: 800;
      font-size: calc(var(--u) * 5.2);
      line-height: 1.26;
      color: #000000;
    }
    .r80-sub {
      font-size: calc(var(--u) * 4.3);
      font-weight: 600;
      color: #000000;
      padding-left: calc(var(--u) * 2.4);
      margin-top: calc(var(--u) * 0.35);
    }
    .r80-disc {
      font-size: calc(var(--u) * 4.3);
      font-weight: 700;
      color: #000000;
      padding-left: calc(var(--u) * 2.4);
      margin-top: calc(var(--u) * 0.35);
    }
    .r80-calc {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      padding-left: calc(var(--u) * 2.4);
      margin-top: calc(var(--u) * 0.5);
      font-size: calc(var(--u) * 4.8);
      font-weight: 700;
      color: #000000;
    }
    .r80-bold { font-weight: 800; }
    .r80-tot {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      padding: calc(var(--u) * 0.5) 0;
      font-size: calc(var(--u) * 4.8);
      font-weight: 700;
      color: #000000;
    }
    .r80-grand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      padding: calc(var(--u) * 1.5) 0 calc(var(--u) * 0.8);
      margin-top: calc(var(--u) * 1);
      border-top: calc(var(--u) * 0.6) solid #000000;
      font-size: calc(var(--u) * 6.2);
      font-weight: 800;
      color: #000000;
    }
    .r80-qr-section {
      text-align: center;
      margin-top: calc(var(--u) * 2);
      padding-top: calc(var(--u) * 1.8);
      border-top: calc(var(--u) * 0.45) dashed #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r80-qr-heading {
      font-size: calc(var(--u) * 4.6);
      font-weight: 800;
      margin-bottom: calc(var(--u) * 1.2);
      color: #000000;
    }
    .r80-qr-img {
      width: calc(var(--u) * 32);
      height: calc(var(--u) * 32);
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .r80-qr-amount {
      font-size: calc(var(--u) * 5.2);
      font-weight: 800;
      margin-top: calc(var(--u) * 1);
      color: #000000;
    }
    .r80-bank {
      margin-top: calc(var(--u) * 1.8);
      padding: calc(var(--u) * 1.6) calc(var(--u) * 2);
      border: calc(var(--u) * 0.45) dashed #000000;
      border-radius: calc(var(--u) * 1);
      font-size: calc(var(--u) * 4.3);
      line-height: 1.35;
      font-weight: 600;
      color: #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r80-bank-title {
      font-weight: 800;
      margin-bottom: calc(var(--u) * 0.5);
    }
    .r80-note {
      margin-top: calc(var(--u) * 1.4);
      font-size: calc(var(--u) * 4.3);
      font-weight: 600;
      color: #000000;
    }
    .r80-footer {
      text-align: center;
      margin-top: calc(var(--u) * 2);
      padding-top: calc(var(--u) * 1.6);
      padding-bottom: calc(var(--u) * 2);
      border-top: calc(var(--u) * 0.45) dashed #000000;
      font-size: calc(var(--u) * 4.2);
      font-weight: 600;
      font-style: italic;
      color: #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div class="r80-sheet">
    <div class="r80-center">
      <div class="r80-brand">${storeName}</div>
      ${address ? `<div class="r80-muted">${address}</div>` : ''}
      ${phone ? `<div class="r80-muted">ĐT: ${phone}</div>` : ''}
      <div class="r80-title">${title}</div>
    </div>

    <div class="r80-divider"></div>

    <div class="r80-meta"><span>Số HĐ:</span><strong>${escapeHtml(order.orderNumber)}</strong></div>
    <div class="r80-meta"><span>Thời gian:</span><span>${escapeHtml(order.displayTime)}</span></div>
    <div class="r80-meta"><span>Khách hàng:</span><span>${escapeHtml(order.customerName || 'Khách lẻ')}</span></div>
    <div class="r80-meta"><span>Thanh toán:</span><span>${escapeHtml(isProvisional ? 'Chưa thanh toán' : getPaymentMethodLabel(order.paymentMethod))}</span></div>

    <div class="r80-divider"></div>

    <div>${itemsHtml}</div>

    <div class="r80-divider"></div>

    <div class="r80-tot"><span>Tạm tính (${totalQty} món):</span><span class="r80-bold">${escapeHtml(formatVND(order.subtotal))}</span></div>
    ${
      order.discountAmount > 0
        ? `<div class="r80-tot"><span>Giảm giá${order.discountType === 'percent' ? ` (${order.discountValue}%)` : ''}:</span><span>-${escapeHtml(formatVND(order.discountAmount))}</span></div>`
        : ''
    }
    ${
      order.vatRate > 0
        ? `<div class="r80-tot"><span>Thuế VAT (${order.vatRate}%):</span><span>${escapeHtml(formatVND(order.vatAmount))}</span></div>`
        : ''
    }
    <div class="r80-grand"><span>TỔNG CỘNG:</span><span>${escapeHtml(formatVND(order.total))}</span></div>

    ${order.note ? `<div class="r80-note"><strong>Ghi chú:</strong> ${escapeHtml(order.note)}</div>` : ''}
    ${wifiInfo ? `<div class="r80-note">Wi-Fi: ${wifiInfo}</div>` : ''}

    ${qrBlockHtml}

    <div class="r80-footer">${footerText}</div>
  </div>
</body>
</html>`;
}

/**
 * Prints standalone HTML cleanly via a top-level #pos-print-root container + window.print().
 * Why top-level instead of iframe.contentWindow.print()?
 * Android Chrome / WebView (used by iMinPrinterPlugin) ignores iframe print isolation
 * and prints the parent document instead. Printing directly from #pos-print-root with
 * #root hidden during @media print guarantees identical crisp output on Android POS
 * terminals (iMin, Sunmi), iOS, and desktop browsers with zero page overlap.
 */
export function triggerHtmlPrint(
  html: string,
  paperSize: 'a5' | '80mm' | 'a4' = 'a5',
): Promise<{ printed: boolean }> {
  return new Promise((resolve) => {
    // Remove any previous injected print artifacts
    document.getElementById('pos-print-root')?.remove();
    document.getElementById('pos-dynamic-print-style')?.remove();
    document.body.classList.remove('pos-printing');

    const parsed = new DOMParser().parseFromString(html, 'text/html');

    // Strip any script tags for safety before mounting into the print portal
    parsed.querySelectorAll('script').forEach((s) => s.remove());

    // Extract styles from the standalone HTML and wrap non-@page rules inside @media print
    // so they never affect the live POS interface on screen.
    const rawCss = Array.from(parsed.querySelectorAll('style'))
      .map((el) => el.textContent || '')
      .join('\n');

    // Strip @page and @media screen blocks so injected CSS has zero nested @media queries
    // (critical for older Android WebView / iMin Chrome builds).
    const flatPrintCss = rawCss
      .replace(/@page\s*\{[^}]*\}/g, '')
      .replace(/@media\s+screen\s*\{[\s\S]*?\}\s*\}/g, '');
    const pageRule =
      paperSize === '80mm'
        ? '@page { margin: 0; }'
        : paperSize === 'a4'
          ? '@page { size: A4 portrait; margin: 10mm; }'
          : '@page { size: A5 portrait; margin: 8mm; }';

    const styleEl = document.createElement('style');
    styleEl.id = 'pos-dynamic-print-style';
    styleEl.textContent = `${pageRule}\n@media print {\n${flatPrintCss}\n}`;
    document.head.appendChild(styleEl);

    const printRoot = document.createElement('div');
    printRoot.id = 'pos-print-root';
    Array.from(parsed.body.childNodes).forEach((node) => {
      printRoot.appendChild(document.importNode(node, true));
    });
    document.body.appendChild(printRoot);
    document.body.classList.add('pos-printing');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('pos-printing');
      printRoot.remove();
      styleEl.remove();
    };

    const onAfterPrint = () => {
      window.setTimeout(cleanup, 300);
    };
    window.addEventListener('afterprint', onAfterPrint);
    // Safety cleanup after 2 minutes in case afterprint does not fire on an embedded browser
    window.setTimeout(cleanup, 120_000);

    const runPrint = () => {
      try {
        const started = Date.now();
        window.print();
        const elapsed = Date.now() - started;
        resolve({ printed: elapsed >= 25 || window.top === window.self });
      } catch {
        cleanup();
        resolve({ printed: false });
      }
    };

    // Wait for any QR image inside #pos-print-root to finish loading before printing
    const images = Array.from(printRoot.querySelectorAll('img'));
    if (images.length === 0 || images.every((img) => img.complete)) {
      window.setTimeout(runPrint, 120);
    } else {
      let triggered = false;
      const triggerOnce = () => {
        if (triggered) return;
        triggered = true;
        window.setTimeout(runPrint, 100);
      };
      let remaining = images.filter((img) => !img.complete).length;
      images.forEach((img) => {
        if (img.complete) return;
        const done = () => {
          remaining -= 1;
          if (remaining <= 0) triggerOnce();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
      window.setTimeout(triggerOnce, 900);
    }
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
