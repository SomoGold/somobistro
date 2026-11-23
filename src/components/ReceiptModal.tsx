import { useState } from 'react';
import { Printer, X, CheckCircle2, Download } from 'lucide-react';
import { Order, ReceiptPaperSize, StoreSettings } from '../types/pos';
import {
  formatVND,
  getItemDiscountAmount,
  getItemNetTotal,
  getItemUnitPrice,
  getPaymentMethodLabel,
} from '../lib/format';
import {
  build80mmReceiptHtml,
  buildA5InvoiceHtml,
  downloadPrintableHtml,
  triggerHtmlPrint,
} from '../lib/print';

interface ReceiptModalProps {
  order: Order;
  settings: StoreSettings | null;
  isProvisional?: boolean;
  onClose: () => void;
}

type Receipt80ScaleKey = 'small' | 'medium' | 'large';

const SCALE_STORAGE_KEY = 'somo_pos_80mm_scale';
const SCALE_OPTIONS: { key: Receipt80ScaleKey; label: string; factor: number }[] = [
  { key: 'small', label: 'Nhỏ', factor: 0.85 },
  { key: 'medium', label: 'Vừa', factor: 1 },
  { key: 'large', label: 'Lớn', factor: 1.15 },
];

function loadSaved80Scale(): Receipt80ScaleKey {
  try {
    const raw = window.localStorage.getItem(SCALE_STORAGE_KEY);
    if (raw === 'small' || raw === 'medium' || raw === 'large') return raw;
  } catch {
    // Ignore storage read errors in restricted frames
  }
  return 'medium';
}

export function ReceiptModal({
  order,
  settings,
  isProvisional = false,
  onClose,
}: ReceiptModalProps) {
  const [paperSize, setPaperSize] = useState<ReceiptPaperSize>(
    settings?.defaultPrintSize === '80mm' ? '80mm' : 'a5',
  );
  const [scaleKey, setScaleKey] = useState<Receipt80ScaleKey>(loadSaved80Scale);
  const [printing, setPrinting] = useState(false);
  const [sandboxHint, setSandboxHint] = useState(false);

  const scaleFactor =
    SCALE_OPTIONS.find((opt) => opt.key === scaleKey)?.factor ?? 1;

  const handleSelectScale = (next: Receipt80ScaleKey) => {
    setScaleKey(next);
    try {
      window.localStorage.setItem(SCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors
    }
  };

  const storeName = settings?.storeName || 'Somo Bistro';
  const address = settings?.address || '42 Nguyễn Đình Chiểu, Quận 1, TP. Hồ Chí Minh';
  const phone = settings?.phone || '0908 456 789';
  const wifiInfo = settings?.wifiInfo || '';
  const footerText =
    settings?.receiptFooter || 'Cảm ơn quý khách đã ghé thăm Somo Bistro! Hẹn gặp lại.';
  const qrDataUrl = settings?.qrImageUrl || '';
  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);

  const buildCurrentHtml = () =>
    paperSize === '80mm'
      ? build80mmReceiptHtml(order, settings, isProvisional, qrDataUrl, scaleFactor)
      : buildA5InvoiceHtml(order, settings, isProvisional, qrDataUrl);

  const handlePrint = async () => {
    setPrinting(true);
    setSandboxHint(false);
    const html = buildCurrentHtml();
    const { printed } = await triggerHtmlPrint(html, paperSize);
    setPrinting(false);
    if (!printed) {
      setSandboxHint(true);
    }
  };

  const handleDownloadPrintFile = () => {
    const html = buildCurrentHtml();
    const suffix = paperSize === '80mm' ? '80mm' : 'A5';
    downloadPrintableHtml(`hoa-don-${suffix}-${order.orderNumber}.html`, html);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-4 print:static print:inset-auto print:bg-white print:backdrop-blur-none print:p-0 print:block"
      role="dialog"
      aria-modal="true"
      aria-label="Xem trước và in hóa đơn"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl print:border-0 print:rounded-none print:shadow-none print:max-w-none print:max-h-none print:overflow-visible">
        {/* Modal Header + Paper Size Switcher (Hidden on Print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {!isProvisional && <CheckCircle2 className="w-4 h-4 text-cyan-600 shrink-0" />}
            <h3 className="text-sm font-bold text-slate-900">
              {isProvisional ? 'Phiếu tạm tính' : 'Hóa đơn bán hàng'}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {/* Segmented Paper Size Toggle: A5 vs 80mm */}
            <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setPaperSize('a5')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                  paperSize === 'a5'
                    ? 'bg-[#091d4f] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Khổ A5
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('80mm')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors whitespace-nowrap ${
                  paperSize === '80mm'
                    ? 'bg-[#091d4f] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Khổ 80mm (K80)
              </button>
            </div>

            {paperSize === '80mm' && (
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 border border-slate-200">
                <span className="px-1.5 text-[11px] font-semibold text-slate-500">Cỡ chữ:</span>
                {SCALE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleSelectScale(opt.key)}
                    className={`px-2 py-1 text-[11px] font-bold rounded-md transition-colors whitespace-nowrap ${
                      scaleKey === opt.key
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Preview Body */}
        <div className="flex-1 overflow-y-auto pos-scroll bg-slate-100/80 p-5 flex justify-center print:bg-white print:p-0 print:overflow-visible print:block">
          {paperSize === 'a5' ? (
            /* -------------------- A5 PORTRAIT PREVIEW -------------------- */
            <div className="print-receipt-root w-full max-w-[560px] bg-white border border-slate-200 px-7 py-7 text-slate-900 text-[13px] leading-relaxed flex flex-col justify-between min-h-[660px] shadow-xs">
              <div>
                {/* Store & Invoice Header */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-300">
                  <div className="space-y-1">
                    <div className="text-xl font-bold tracking-tight text-slate-900">{storeName}</div>
                    {address && <div className="text-xs text-slate-600">{address}</div>}
                    {phone && (
                      <div className="text-xs text-slate-600 tabular-nums">Hotline: {phone}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold tracking-tight text-cyan-700">
                      {isProvisional ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN'}
                    </div>
                    <div className="text-xs font-semibold text-slate-700 tabular-nums mt-1">
                      Số HĐ: {order.orderNumber}
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">{order.displayTime}</div>
                  </div>
                </div>

                {/* Order Meta Grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 py-3.5 border-b border-slate-200 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Khách hàng:</span>
                    <span className="font-medium text-slate-900">
                      {order.customerName || 'Khách lẻ'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Hình thức TT:</span>
                    <span className="font-medium text-slate-900">
                      {isProvisional ? 'Chưa thanh toán' : getPaymentMethodLabel(order.paymentMethod)}
                    </span>
                  </div>
                </div>

                {/* Full A5 Itemized Table */}
                <div className="mt-4">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-y border-slate-300 bg-slate-50 text-slate-700 font-semibold">
                        <th className="py-2 px-1.5 w-9 text-center">STT</th>
                        <th className="py-2 px-1.5">Tên món</th>
                        <th className="py-2 px-1.5 w-10 text-center">SL</th>
                        <th className="py-2 px-1.5 w-20 text-right">Đơn giá</th>
                        <th className="py-2 px-1.5 w-20 text-right">Chiết khấu</th>
                        <th className="py-2 px-1.5 w-24 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {order.items.map((item, index) => {
                        const unitPrice = getItemUnitPrice(item);
                        const itemDiscount = getItemDiscountAmount(item);
                        const netTotal = getItemNetTotal(item);
                        return (
                          <tr key={`${item.itemId}_${index}`}>
                            <td className="py-2 px-1.5 text-center tabular-nums text-slate-500">
                              {index + 1}
                            </td>
                            <td className="py-2 px-1.5">
                              <div className="font-medium text-slate-900">{item.name}</div>
                              {item.toppings && item.toppings.length > 0 && (
                                <div className="space-y-0.5 mt-1">
                                  {item.toppings.map((t, idx) => (
                                    <div key={idx} className="pl-3 text-[11px] text-cyan-700 tabular-nums">
                                      + {t.name} x{item.qty} = {formatVND(t.price * item.qty)}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {item.note && (
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Ghi chú: {item.note}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-1.5 text-center tabular-nums font-medium text-slate-900">
                              {item.qty}
                            </td>
                            <td className="py-2 px-1.5 text-right tabular-nums text-slate-700 whitespace-nowrap">
                              {formatVND(unitPrice)}
                            </td>
                            <td className="py-2 px-1.5 text-right tabular-nums whitespace-nowrap">
                              {itemDiscount > 0 ? (
                                <div className="text-amber-700 font-medium leading-tight">
                                  {item.discountType === 'percent' && (item.discountValue ?? 0) > 0 ? (
                                    <>
                                      <div>-{item.discountValue}%</div>
                                      <div className="text-[10px] text-amber-800/80">
                                        (-{formatVND(itemDiscount)})
                                      </div>
                                    </>
                                  ) : (
                                    <div>-{formatVND(itemDiscount)}</div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="py-2 px-1.5 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {formatVND(netTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary & Uploaded QR Section */}
                <div className="mt-5 pt-4 border-t border-slate-300 grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
                  <div className="sm:col-span-6 space-y-2 text-xs">
                    {qrDataUrl && (
                      <div className="space-y-2">
                        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center gap-3">
                          <img
                            src={qrDataUrl}
                            alt="Mã QR thanh toán chuyển khoản"
                            className="w-24 h-24 object-contain rounded border border-slate-200 bg-white p-1 shrink-0"
                          />
                          <div className="space-y-1 min-w-0">
                            <div className="font-bold text-cyan-700">Quét mã QR thanh toán</div>
                            <div className="text-slate-600 truncate">{storeName}</div>
                            <div className="font-bold tabular-nums text-slate-900">
                              {formatVND(order.total)}
                            </div>
                          </div>
                        </div>
                        {(settings?.bankName || settings?.bankAccount || settings?.bankOwner) && (
                          <div className="text-xs border border-slate-200 rounded-lg p-2.5 bg-slate-50 space-y-0.5">
                            <div className="font-bold text-cyan-800">Thông tin chuyển khoản:</div>
                            {settings?.bankName && <div>Ngân hàng: <strong>{settings.bankName}</strong></div>}
                            {settings?.bankAccount && <div>STK: <strong className="tabular-nums">{settings.bankAccount}</strong></div>}
                            {settings?.bankOwner && <div>Chủ TK: <strong>{settings.bankOwner}</strong></div>}
                          </div>
                        )}
                      </div>
                    )}
                    {order.note && (
                      <div className="text-slate-600">
                        <span className="font-medium text-slate-800">Ghi chú đơn:</span> {order.note}
                      </div>
                    )}
                    {wifiInfo && <div className="text-slate-600">Wi-Fi: {wifiInfo}</div>}
                  </div>

                  <div className="sm:col-span-6 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Tạm tính ({totalQty} món):</span>
                      <span className="tabular-nums font-medium text-slate-900">
                        {formatVND(order.subtotal)}
                      </span>
                    </div>
                    {order.discountAmount > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>
                          Giảm giá
                          {order.discountType === 'percent' ? ` (${order.discountValue}%)` : ''}:
                        </span>
                        <span className="tabular-nums font-medium">
                          -{formatVND(order.discountAmount)}
                        </span>
                      </div>
                    )}
                    {order.vatRate > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Thuế VAT ({order.vatRate}%):</span>
                        <span className="tabular-nums font-medium text-slate-900">
                          {formatVND(order.vatAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-baseline pt-2 border-t border-slate-300 text-base font-bold text-slate-900">
                      <span>TỔNG CỘNG:</span>
                      <span className="tabular-nums text-cyan-700">{formatVND(order.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-dashed border-slate-300 text-center text-xs text-slate-600">
                <div className="italic text-slate-800">{footerText}</div>
              </div>
            </div>
          ) : (
            /* -------------------- 80MM THERMAL ROLL PREVIEW -------------------- */
            <div
              className={`print-receipt-root print-receipt-80mm w-[304px] bg-white border border-slate-300 px-3.5 py-3.5 text-black leading-snug shadow-sm self-start ${
                scaleKey === 'small'
                  ? 'text-[10.5px]'
                  : scaleKey === 'large'
                    ? 'text-[13px]'
                    : 'text-[11.5px]'
              }`}
            >
              <div className="text-center space-y-0.5">
                <div className="text-[1.35em] font-bold tracking-tight text-black">{storeName}</div>
                {address && <div className="text-[0.9em] font-medium text-black">{address}</div>}
                {phone && <div className="text-[0.9em] font-medium text-black tabular-nums">ĐT: {phone}</div>}
                <div className="pt-1.5 mt-1.5 border-t border-dashed border-black text-[1.12em] font-bold text-black">
                  {isProvisional ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN'}
                </div>
              </div>

              <div className="my-2 py-1.5 border-y border-dashed border-black space-y-0.5 text-[0.95em] font-medium text-black">
                <div className="flex justify-between gap-2">
                  <span>Số HĐ:</span>
                  <span className="font-bold tabular-nums">{order.orderNumber}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Thời gian:</span>
                  <span className="font-bold tabular-nums">{order.displayTime}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Khách hàng:</span>
                  <span className="font-bold">{order.customerName || 'Khách lẻ'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Thanh toán:</span>
                  <span className="font-bold">
                    {isProvisional ? 'Chưa thanh toán' : getPaymentMethodLabel(order.paymentMethod)}
                  </span>
                </div>
              </div>

              <div className="divide-y divide-dotted divide-black">
                {order.items.map((item, idx) => {
                  const unitPrice = getItemUnitPrice(item);
                  const itemDiscount = getItemDiscountAmount(item);
                  const netTotal = getItemNetTotal(item);
                  return (
                    <div key={`${item.itemId}_${idx}`} className="py-1.5">
                      <div className="font-bold text-[1.06em] text-black">
                        {idx + 1}. {item.name}
                      </div>
                      {item.toppings && item.toppings.length > 0 && (
                        <div className="space-y-0.5 pl-2.5 mt-0.5">
                          {item.toppings.map((t, tIdx) => (
                            <div key={tIdx} className="text-[0.9em] font-medium text-black tabular-nums">
                              + {t.name} x{item.qty} = {formatVND(t.price * item.qty)}
                            </div>
                          ))}
                        </div>
                      )}
                      {item.note && (
                        <div className="text-[0.9em] font-medium text-black pl-2.5 italic">
                          Ghi chú: {item.note}
                        </div>
                      )}
                      <div className="flex justify-between pl-2.5 mt-0.5 tabular-nums text-[1em] font-medium text-black">
                        <span>
                          {item.qty} × {formatVND(unitPrice)}
                        </span>
                        <span className="font-bold">{formatVND(netTotal)}</span>
                      </div>
                      {itemDiscount > 0 && (
                        <div className="text-[0.9em] text-black pl-2.5 tabular-nums font-semibold">
                          Chiết khấu món:{' '}
                          {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                            ? `-${item.discountValue}% (-${formatVND(itemDiscount)})`
                            : `-${formatVND(itemDiscount)}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 pt-1.5 border-t border-dashed border-black space-y-0.5 text-[1em] font-medium text-black">
                <div className="flex justify-between">
                  <span>Tạm tính ({totalQty} món):</span>
                  <span className="font-bold tabular-nums">{formatVND(order.subtotal)}</span>
                </div>
                {order.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span>
                      Giảm giá
                      {order.discountType === 'percent' ? ` (${order.discountValue}%)` : ''}:
                    </span>
                    <span className="tabular-nums">-{formatVND(order.discountAmount)}</span>
                  </div>
                )}
                {order.vatRate > 0 && (
                  <div className="flex justify-between">
                    <span>Thuế VAT ({order.vatRate}%):</span>
                    <span className="tabular-nums">{formatVND(order.vatAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-baseline pt-1.5 mt-1 border-t border-black text-[1.28em] font-extrabold text-black">
                  <span>TỔNG CỘNG:</span>
                  <span className="tabular-nums">{formatVND(order.total)}</span>
                </div>
              </div>

              {order.note && (
                <div className="mt-1.5 text-[0.92em] font-medium text-black">
                  <strong>Ghi chú:</strong> {order.note}
                </div>
              )}
              {wifiInfo && (
                <div className="mt-1 text-[0.92em] font-medium text-black">Wi-Fi: {wifiInfo}</div>
              )}

              {qrDataUrl && (
                <div className="mt-2.5 pt-2.5 border-t border-dashed border-black text-center space-y-1">
                  <div className="text-[0.95em] font-bold text-black">QUÉT MÃ QR THANH TOÁN</div>
                  <img
                    src={qrDataUrl}
                    alt="Mã QR thanh toán"
                    className="w-[88px] h-[88px] object-contain mx-auto bg-white"
                  />
                  <div className="text-[1.08em] font-bold tabular-nums text-black">
                    {formatVND(order.total)}
                  </div>
                </div>
              )}

              {(settings?.bankName || settings?.bankAccount || settings?.bankOwner) && (
                <div className="mt-2 text-[0.92em] text-left border border-dashed border-black rounded p-2 space-y-0.5 text-black bg-white">
                  <div className="font-bold">Thông tin chuyển khoản:</div>
                  {settings?.bankName && (
                    <div>
                      Ngân hàng: <strong>{settings.bankName}</strong>
                    </div>
                  )}
                  {settings?.bankAccount && (
                    <div>
                      STK: <strong className="tabular-nums">{settings.bankAccount}</strong>
                    </div>
                  )}
                  {settings?.bankOwner && (
                    <div>
                      Chủ TK: <strong>{settings.bankOwner}</strong>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-2.5 pt-2 border-t border-dashed border-black text-center text-[0.92em] font-medium italic text-black">
                {footerText}
              </div>
            </div>
          )}
        </div>

        {/* Sandbox Notice */}
        {sandboxHint && (
          <div className="no-print px-5 py-2.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
            Khung xem trước đang chặn hộp thoại in trực tiếp. Bạn hãy nhấn{' '}
            <strong>Tải file in ({paperSize === '80mm' ? '80mm' : 'A5'})</strong> rồi mở file đó để
            in ngay, hoặc mở ứng dụng ở tab mới.
          </div>
        )}

        {/* Footer Actions */}
        <div className="no-print px-5 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleDownloadPrintFile}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Tải file in {paperSize === '80mm' ? '80mm' : 'A5'} (.html)
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              {printing
                ? 'Đang mở hộp thoại in...'
                : paperSize === '80mm'
                  ? 'In hóa đơn (Khổ 80mm)'
                  : 'In hóa đơn (Khổ A5)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
