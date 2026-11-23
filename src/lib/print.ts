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
        <div class="bank-box">
          <div class="bank-title">Thông tin chuyển khoản:</div>
          ${settings?.bankName ? `<div>Ngân hàng: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
          ${settings?.bankAccount ? `<div>STK: <strong class="tabular">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} 80mm - ${escapeHtml(order.orderNumber)}</title>
  <style>
    :root {
      /* On screen preview: 1% of 80mm (~302px) */
      --u: 3.02px;
    }
    @page {
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: Arial, Helvetica, "Roboto", "Segoe UI", sans-serif;
      font-variant-numeric: tabular-nums;
      -webkit-text-size-adjust: 100%;
    }
    body {
      width: 80mm;
      margin: 0 auto;
      padding: calc(var(--u) * 2.5) calc(var(--u) * 4);
      font-size: calc(var(--u) * 4.5);
      line-height: 1.38;
      font-weight: 500;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    @media print {
      :root {
        /* Dynamically fills 100% of whatever page width Android Print / iMinPrinterPlugin or K80 driver uses (80mm, 72mm, A4-scaled-to-80mm...) */
        --u: 1vw;
      }
      html, body {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
      }
    }
    .tabular { font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    .brand {
      font-size: calc(var(--u) * 6.8);
      font-weight: 800;
      letter-spacing: -0.01em;
      line-height: 1.2;
      color: #000000;
    }
    .muted {
      font-size: calc(var(--u) * 4.1);
      font-weight: 600;
      color: #000000;
      margin-top: calc(var(--u) * 0.6);
    }
    .title {
      font-size: calc(var(--u) * 5.6);
      font-weight: 800;
      margin-top: calc(var(--u) * 2.2);
      padding-top: calc(var(--u) * 2.2);
      border-top: calc(var(--u) * 0.45) dashed #000000;
      color: #000000;
    }
    .divider {
      border-top: calc(var(--u) * 0.45) dashed #000000;
      margin: calc(var(--u) * 2.4) 0;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      font-size: calc(var(--u) * 4.3);
      font-weight: 500;
      padding: calc(var(--u) * 0.5) 0;
      color: #000000;
    }
    .meta-row > span:first-child {
      flex-shrink: 0;
    }
    .meta-row > span:last-child,
    .meta-row > strong {
      text-align: right;
      font-weight: 700;
    }
    .item-block {
      padding: calc(var(--u) * 1.8) 0;
      border-bottom: calc(var(--u) * 0.35) dotted #000000;
    }
    .item-block:last-child {
      border-bottom: none;
    }
    .item-name {
      font-weight: 800;
      font-size: calc(var(--u) * 4.9);
      line-height: 1.3;
      color: #000000;
    }
    .sub-line {
      font-size: calc(var(--u) * 4.1);
      font-weight: 600;
      color: #000000;
      padding-left: calc(var(--u) * 2.8);
      margin-top: calc(var(--u) * 0.5);
    }
    .disc-line {
      font-size: calc(var(--u) * 4.1);
      font-weight: 700;
      color: #000000;
      padding-left: calc(var(--u) * 2.8);
      margin-top: calc(var(--u) * 0.5);
    }
    .item-calc {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      padding-left: calc(var(--u) * 2.8);
      margin-top: calc(var(--u) * 0.8);
      font-size: calc(var(--u) * 4.5);
      font-weight: 600;
      color: #000000;
    }
    .font-bold { font-weight: 800; }
    .tot-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      padding: calc(var(--u) * 0.7) 0;
      font-size: calc(var(--u) * 4.6);
      font-weight: 600;
      color: #000000;
    }
    .tot-grand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 2);
      padding: calc(var(--u) * 2) 0 calc(var(--u) * 1.2);
      margin-top: calc(var(--u) * 1.5);
      border-top: calc(var(--u) * 0.6) solid #000000;
      font-size: calc(var(--u) * 6.0);
      font-weight: 800;
      color: #000000;
    }
    .qr-section {
      text-align: center;
      margin-top: calc(var(--u) * 2.8);
      padding-top: calc(var(--u) * 2.8);
      border-top: calc(var(--u) * 0.45) dashed #000000;
    }
    .qr-heading {
      font-size: calc(var(--u) * 4.5);
      font-weight: 800;
      margin-bottom: calc(var(--u) * 1.6);
      color: #000000;
    }
    .qr-img-80 {
      width: calc(var(--u) * 46);
      height: calc(var(--u) * 46);
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .qr-amount {
      font-size: calc(var(--u) * 5.2);
      font-weight: 800;
      margin-top: calc(var(--u) * 1.4);
      color: #000000;
    }
    .bank-box {
      margin-top: calc(var(--u) * 2.4);
      padding: calc(var(--u) * 2.2);
      border: calc(var(--u) * 0.45) dashed #000000;
      border-radius: calc(var(--u) * 1.2);
      font-size: calc(var(--u) * 4.2);
      line-height: 1.42;
      font-weight: 500;
      color: #000000;
    }
    .bank-title {
      font-weight: 800;
      margin-bottom: calc(var(--u) * 0.8);
    }
    .note-line {
      margin-top: calc(var(--u) * 2);
      font-size: calc(var(--u) * 4.2);
      font-weight: 600;
      color: #000000;
    }
    .footer {
      text-align: center;
      margin-top: calc(var(--u) * 3);
      padding-top: calc(var(--u) * 2.4);
      padding-bottom: calc(var(--u) * 4);
      border-top: calc(var(--u) * 0.45) dashed #000000;
      font-size: calc(var(--u) * 4.2);
      font-weight: 600;
      font-style: italic;
      color: #000000;
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

  <div>${itemsHtml}</div>

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

  ${order.note ? `<div class="note-line"><strong>Ghi chú:</strong> ${escapeHtml(order.note)}</div>` : ''}
  ${wifiInfo ? `<div class="note-line">Wi-Fi: ${wifiInfo}</div>` : ''}

  ${qrBlockHtml}

  <div class="footer">${footerText}</div>
</body>
</html>`;
}

/**
 * Triggers the native browser/Android Print dialog via a dedicated off-screen iframe
 * sized cleanly (never 0x0, avoiding Android WebView / iMinPrinterPlugin scale bugs)
 * and preserved until printing finishes.
 */
export function triggerHtmlPrint(
  html: string,
  paperSize: 'a5' | '80mm' = 'a5',
): Promise<{ printed: boolean }> {
  return new Promise((resolve) => {
    // Clean up any leftover previous print frame
    document.querySelectorAll('iframe[data-pos-print-frame="true"]').forEach((el) => el.remove());

    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-pos-print-frame', 'true');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.left = '-10000px';
    iframe.style.top = '0';
    iframe.style.width = paperSize === '80mm' ? '302px' : '560px';
    iframe.style.height = '900px';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    const runPrint = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          cleanup();
          resolve({ printed: false });
          return;
        }
        // Keep iframe alive until afterprint (critical for async Android Print / iMinPrinterPlugin)
        win.addEventListener('afterprint', () => {
          window.setTimeout(cleanup, 1500);
        });
        // Fallback cleanup after 2 minutes if afterprint doesn't fire
        window.setTimeout(cleanup, 120_000);

        win.focus();
        const started = Date.now();
        win.print();
        const elapsed = Date.now() - started;
        // On Android Chrome, win.print() may return asynchronously in < 25ms when opening the native print spooler,
        // so treat top-level browsing contexts as printed.
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

    // Wait for any inline QR image to finish decoding before printing
    const images = Array.from(doc.images);
    if (images.length === 0 || images.every((img) => img.complete)) {
      window.setTimeout(runPrint, 200);
    } else {
      let triggered = false;
      const triggerOnce = () => {
        if (triggered) return;
        triggered = true;
        window.setTimeout(runPrint, 150);
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
