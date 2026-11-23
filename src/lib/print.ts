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

  const hasBankDetails = Boolean(
    settings?.bankName || settings?.bankAccount || settings?.bankOwner,
  );

  const bankDetailsHtml = hasBankDetails
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
          <div class="qr-title">Thông tin chuyển khoản</div>
          ${settings?.bankName ? `<div>NH: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
          ${settings?.bankAccount ? `<div>STK: <strong style="font-variant-numeric: tabular-nums;">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
          ${settings?.bankOwner ? `<div>Chủ TK: <strong>${escapeHtml(settings.bankOwner)}</strong></div>` : ''}
          <div class="font-semibold">Số tiền: ${escapeHtml(formatVND(order.total))}</div>
        </div>
      </div>
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

  const hasBankInfo = Boolean(
    settings?.bankName || settings?.bankAccount || settings?.bankOwner,
  );

  const qrBlockHtml =
    qrDataUrl && hasBankInfo
      ? `
        <div class="r80-pay-section">
          <div class="r80-qr-heading">QUÉT MÃ QR CHUYỂN KHOẢN</div>
          <div class="r80-pay-row">
            <div class="r80-pay-qr">
              <img src="${qrDataUrl}" alt="Mã QR thanh toán" class="r80-qr-img" />
            </div>
            <div class="r80-pay-info">
              <div class="r80-bank-title">Thông tin chuyển khoản:</div>
              ${settings?.bankName ? `<div>NH: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
              ${settings?.bankAccount ? `<div>STK: <strong class="r80-tabular">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
              ${settings?.bankOwner ? `<div>Chủ TK: <strong>${escapeHtml(settings.bankOwner)}</strong></div>` : ''}
              <div class="r80-pay-amount">Số tiền: <strong>${escapeHtml(formatVND(order.total))}</strong></div>
            </div>
          </div>
        </div>
      `
      : qrDataUrl
        ? `
          <div class="r80-pay-section r80-center">
            <div class="r80-qr-heading">QUÉT MÃ QR THANH TOÁN</div>
            <img src="${qrDataUrl}" alt="Mã QR thanh toán" class="r80-qr-img r80-qr-center" />
            <div class="r80-qr-amount">${escapeHtml(formatVND(order.total))}</div>
          </div>
        `
        : hasBankInfo
          ? `
            <div class="r80-bank">
              <div class="r80-bank-title">Thông tin chuyển khoản:</div>
              ${settings?.bankName ? `<div>Ngân hàng: <strong>${escapeHtml(settings.bankName)}</strong></div>` : ''}
              ${settings?.bankAccount ? `<div>STK: <strong class="r80-tabular">${escapeHtml(settings.bankAccount)}</strong></div>` : ''}
              ${settings?.bankOwner ? `<div>Chủ TK: <strong>${escapeHtml(settings.bankOwner)}</strong></div>` : ''}
            </div>
          `
          : '';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${title} 80mm - ${escapeHtml(order.orderNumber)}</title>
  <style>
    @page {
      margin: 0;
      background: #ffffff;
    }
    html,
    body {
      color-scheme: light !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      background-color: #ffffff !important;
      color: #000000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .r80-sheet {
      /* Locked to calibrated "Nhỏ" (0.85) thermal scale for iMinPrinterPlugin */
      --s: 0.85;
      --u: calc(1vw * var(--s));
      box-sizing: border-box;
      width: 100%;
      margin: 0;
      padding: 2vw 4.5vw 3.5vw;
      background: #ffffff !important;
      background-color: #ffffff !important;
      color: #000000 !important;
      color-scheme: light !important;
      border: none !important;
      box-shadow: none !important;
      font-family: Arial, Helvetica, "Roboto", "Segoe UI", sans-serif;
      font-size: calc(var(--u) * 3.15);
      line-height: 1.35;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      word-break: break-word;
      overflow-wrap: break-word;
      -webkit-text-size-adjust: 100%;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .r80-sheet * {
      box-sizing: border-box;
      box-shadow: none !important;
    }
    /* Screen-only preview sizing when opened as a standalone .html file */
    @media screen {
      .r80-sheet {
        --u: calc(3.02px * var(--s));
        width: 80mm;
        padding: 6px 14px 12px;
        margin: 0 auto;
      }
    }
    .r80-tabular { font-variant-numeric: tabular-nums; }
    .r80-center { text-align: center; }
    .r80-brand {
      font-size: calc(var(--u) * 4.6);
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.2;
      color: #000000;
    }
    .r80-muted {
      font-size: calc(var(--u) * 2.85);
      font-weight: 500;
      color: #000000;
      margin-top: calc(var(--u) * 0.35);
    }
    .r80-title {
      font-size: calc(var(--u) * 3.65);
      font-weight: 700;
      margin-top: calc(var(--u) * 1.4);
      padding-top: calc(var(--u) * 1.3);
      border-top: 1px dashed #000000;
      color: #000000;
    }
    .r80-divider {
      border-top: 1px dashed #000000;
      margin: calc(var(--u) * 1.4) 0;
    }
    .r80-meta {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 1.8);
      font-size: calc(var(--u) * 3.0);
      font-weight: 500;
      padding: calc(var(--u) * 0.3) 0;
      color: #000000;
    }
    .r80-meta > span:first-child { flex-shrink: 0; }
    .r80-meta > span:last-child,
    .r80-meta > strong {
      text-align: right;
      font-weight: 700;
    }
    .r80-item {
      padding: calc(var(--u) * 1.0) 0;
      border-bottom: 1px dotted #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r80-item:last-child { border-bottom: none; }
    .r80-item-name {
      font-weight: 700;
      font-size: calc(var(--u) * 3.4);
      line-height: 1.28;
      color: #000000;
    }
    .r80-sub {
      font-size: calc(var(--u) * 2.85);
      font-weight: 500;
      color: #000000;
      padding-left: calc(var(--u) * 2.0);
      margin-top: calc(var(--u) * 0.3);
    }
    .r80-disc {
      font-size: calc(var(--u) * 2.85);
      font-weight: 600;
      color: #000000;
      padding-left: calc(var(--u) * 2.0);
      margin-top: calc(var(--u) * 0.3);
    }
    .r80-calc {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 1.8);
      padding-left: calc(var(--u) * 2.0);
      margin-top: calc(var(--u) * 0.4);
      font-size: calc(var(--u) * 3.15);
      font-weight: 500;
      color: #000000;
    }
    .r80-bold { font-weight: 700; }
    .r80-tot {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 1.8);
      padding: calc(var(--u) * 0.4) 0;
      font-size: calc(var(--u) * 3.15);
      font-weight: 500;
      color: #000000;
    }
    .r80-grand {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--u) * 1.8);
      padding: calc(var(--u) * 1.2) 0 calc(var(--u) * 0.6);
      margin-top: calc(var(--u) * 0.8);
      border-top: 1.5px solid #000000;
      font-size: calc(var(--u) * 4.15);
      font-weight: 800;
      color: #000000;
    }
    .r80-pay-section {
      margin-top: calc(var(--u) * 1.6);
      padding-top: calc(var(--u) * 1.4);
      border-top: 1px dashed #000000;
      background: #ffffff !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r80-qr-heading {
      text-align: center;
      font-size: calc(var(--u) * 3.0);
      font-weight: 700;
      margin-bottom: calc(var(--u) * 1.1);
      color: #000000;
    }
    .r80-pay-row {
      display: flex;
      align-items: center;
      gap: calc(var(--u) * 2.4);
    }
    .r80-pay-qr {
      flex: 0 0 auto;
    }
    .r80-qr-img {
      width: calc(var(--u) * 28);
      height: calc(var(--u) * 28);
      object-fit: contain;
      display: block;
      padding: 0.6vw;
      background: #ffffff !important;
      background-color: #ffffff !important;
      border: none !important;
    }
    .r80-qr-center {
      margin: 0 auto;
    }
    .r80-pay-info {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
      font-size: calc(var(--u) * 2.8);
      line-height: 1.42;
      font-weight: 500;
      color: #000000;
    }
    .r80-pay-amount {
      margin-top: calc(var(--u) * 0.45);
      font-size: calc(var(--u) * 3.05);
      color: #000000;
    }
    .r80-qr-amount {
      font-size: calc(var(--u) * 3.5);
      font-weight: 700;
      margin-top: calc(var(--u) * 0.8);
      color: #000000;
    }
    .r80-bank {
      margin-top: calc(var(--u) * 1.4);
      padding: calc(var(--u) * 1.2) calc(var(--u) * 1.6);
      border: 1px dashed #000000;
      border-radius: 3px;
      background: #ffffff !important;
      font-size: calc(var(--u) * 2.85);
      line-height: 1.38;
      font-weight: 500;
      color: #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r80-bank-title {
      font-weight: 700;
      margin-bottom: calc(var(--u) * 0.35);
    }
    .r80-note {
      margin-top: calc(var(--u) * 1.1);
      font-size: calc(var(--u) * 2.85);
      font-weight: 500;
      color: #000000;
    }
    .r80-footer {
      text-align: center;
      margin-top: calc(var(--u) * 1.6);
      padding-top: calc(var(--u) * 1.3);
      padding-bottom: calc(var(--u) * 1.6);
      border-top: 1px dashed #000000;
      font-size: calc(var(--u) * 2.85);
      font-weight: 500;
      font-style: italic;
      color: #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#000000;color-scheme:light;">
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
 * To guarantee Android Chrome / iMinPrinterPlugin NEVER captures the POS screen (#root) on Page 1
 * and pushes the receipt onto Page 2, we directly hide every sibling of #pos-print-root in <body>
 * via inline display:none!important, prepend #pos-print-root as the sole rendered DOM element,
 * wait 2 animation frames for layout/paint to flush, and restore everything once printing ends.
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

    // Extract styles from the standalone HTML so they apply cleanly during printing
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
        ? '@page { margin: 0; background: #ffffff; }'
        : paperSize === 'a4'
          ? '@page { size: A4 portrait; margin: 10mm; background: #ffffff; }'
          : '@page { size: A5 portrait; margin: 8mm; background: #ffffff; }';

    // Apply both in @media print AND scoped under body.pos-printing so the sole visible DOM
    // matches the printed receipt immediately before window.print() snapshots the page.
    const styleEl = document.createElement('style');
    styleEl.id = 'pos-dynamic-print-style';
    styleEl.textContent = `${pageRule}
body.pos-printing > *:not(#pos-print-root) { display: none !important; }
body.pos-printing > #pos-print-root { display: block !important; background: #ffffff !important; }
${flatPrintCss}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; background: #ffffff !important; color-scheme: light !important; }
  body.pos-printing > *:not(#pos-print-root) { display: none !important; }
  body.pos-printing > #pos-print-root { display: block !important; position: static !important; width: 100% !important; height: auto !important; min-height: 0 !important; background: #ffffff !important; }
${flatPrintCss}
}`;
    document.head.appendChild(styleEl);

    // Explicitly hide all existing direct element children of <body> (including #root)
    // via inline style so NO cached CSS or Android WebView quirk can ever render #root on Page 1.
    const hiddenSiblings: { el: HTMLElement; prevDisplay: string; prevPriority: string }[] = [];
    Array.from(document.body.children).forEach((child) => {
      if (child instanceof HTMLElement && child.id !== 'pos-print-root') {
        hiddenSiblings.push({
          el: child,
          prevDisplay: child.style.getPropertyValue('display'),
          prevPriority: child.style.getPropertyPriority('display'),
        });
        child.style.setProperty('display', 'none', 'important');
      }
    });

    const printRoot = document.createElement('div');
    printRoot.id = 'pos-print-root';
    Array.from(parsed.body.childNodes).forEach((node) => {
      printRoot.appendChild(document.importNode(node, true));
    });
    // Prepend so #pos-print-root is the very first element in <body> (y = 0, Page 1)
    document.body.prepend(printRoot);
    document.body.classList.add('pos-printing');

    // Reset scroll position to top so Page 1 always starts at y = 0
    const prevScrollX = window.scrollX;
    const prevScrollY = window.scrollY;
    window.scrollTo(0, 0);

    let cleaned = false;
    let afterPrintFired = false;
    let wasHiddenForPrint = false;
    let cleanupTimer: number | null = null;
    let fallbackRestoreTimer: number | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
      if (fallbackRestoreTimer !== null) window.clearTimeout(fallbackRestoreTimer);
      window.removeEventListener('afterprint', onAfterPrint);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onWindowFocus);
      document.body.classList.remove('pos-printing');
      printRoot.remove();
      styleEl.remove();
      hiddenSiblings.forEach(({ el, prevDisplay, prevPriority }) => {
        if (prevDisplay) {
          el.style.setProperty('display', prevDisplay, prevPriority);
        } else {
          el.style.removeProperty('display');
        }
      });
      window.scrollTo(prevScrollX, prevScrollY);
    };

    const scheduleVisibleCleanup = (delayMs: number) => {
      if (cleaned) return;
      if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
      cleanupTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          cleanup();
        }
      }, delayMs);
    };

    // On Android Chrome + iMinPrinterPlugin, opening Print Spooler moves Chrome to background
    // (visibilityState === 'hidden'). Keep #pos-print-root as the sole element while Print Spooler
    // is active, then restore #root cleanly as soon as the user returns to Chrome.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHiddenForPrint = true;
        if (cleanupTimer !== null) {
          window.clearTimeout(cleanupTimer);
          cleanupTimer = null;
        }
      } else if (wasHiddenForPrint || afterPrintFired) {
        scheduleVisibleCleanup(180);
      }
    };

    const onWindowFocus = () => {
      if (wasHiddenForPrint || afterPrintFired) {
        scheduleVisibleCleanup(180);
      }
    };

    const onAfterPrint = () => {
      afterPrintFired = true;
      if (document.visibilityState === 'visible') {
        scheduleVisibleCleanup(350);
      }
    };

    window.addEventListener('afterprint', onAfterPrint);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onWindowFocus);
    // Safety cleanup after 3 minutes in case an embedded browser never fires lifecycle events
    window.setTimeout(cleanup, 180_000);

    const runPrint = () => {
      // Wait 2 animation frames so hiding #root and painting #pos-print-root is fully committed
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          try {
            const started = Date.now();
            window.print();
            const elapsed = Date.now() - started;
            const likelyPrinted = elapsed >= 25 || window.top === window.self;
            if (!likelyPrinted) {
              cleanup();
              resolve({ printed: false });
              return;
            }
            // If a non-standard browser returned without firing afterprint or hiding the tab
            // after 4 seconds, restore the POS UI cleanly so the user is never stuck.
            fallbackRestoreTimer = window.setTimeout(() => {
              if (!wasHiddenForPrint && !afterPrintFired && document.visibilityState === 'visible') {
                cleanup();
              }
            }, 4000);
            resolve({ printed: true });
          } catch {
            cleanup();
            resolve({ printed: false });
          }
        });
      });
    };

    // Wait for any QR image inside #pos-print-root to finish loading before printing
    const images = Array.from(printRoot.querySelectorAll('img'));
    if (images.length === 0 || images.every((img) => img.complete)) {
      window.setTimeout(runPrint, 80);
    } else {
      let triggered = false;
      const triggerOnce = () => {
        if (triggered) return;
        triggered = true;
        window.setTimeout(runPrint, 80);
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
