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

export function ReceiptModal({
  order,
  settings,
  isProvisional = false,
  onClose,
}: ReceiptModalProps) {
  const [paperSize, setPaperSize] = useState<ReceiptPaperSize>(
    settings?.defaultPrintSize === '80mm' ? '80mm' : 'a5',
  );
  const [printing, setPrinting] = useState(false);
  const [sandboxHint, setSandboxHint] = useState(false);

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
      ? build80mmReceiptHtml(order, settings, isProvisional, qrDataUrl)
      : buildA5InvoiceHtml(order, settings, isProvisional, qrDataUrl);

  const handlePrint = async () => {
    setPrinting(true);
    setSandboxHint(false);
    const html = buildCurrentHtml();
    const { printed } = await triggerHtmlPrint(html);
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
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Xem trước và in hóa đơn"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Modal Header + Paper Size Switcher (Hidden on Print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {!isProvisional && <CheckCircle2 className="w-4 h-4 text-cyan-600 shrink-0" />}
            <h3 className="text-sm font-bold text-slate-900">
              {isProvisional ? 'Phiếu tạm tính' : 'Hóa đơn bán hàng'}
            </h3>
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
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
        <div className="flex-1 overflow-y-auto pos-scroll bg-slate-100/80 p-5 flex justify-center">
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
                    <span className="text-slate-500">Khu vực / Bàn:</span>
                    <span className="font-semibold text-slate-900">{order.tableName}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Thu ngân:</span>
                    <span className="font-medium text-slate-900">
                      {order.cashierName || 'Thu ngân'}
                    </span>
                  </div>
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
                            className="w-32 h-32 object-contain rounded border border-slate-200 bg-white p-1 shrink-0"
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
                    {!isProvisional && order.paymentMethod === 'cash' && (
                      <div className="pt-1.5 space-y-1 text-slate-600">
                        <div className="flex justify-between">
                          <span>Tiền khách đưa:</span>
                          <span className="tabular-nums">{formatVND(order.cashReceived)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tiền thối lại:</span>
                          <span className="tabular-nums font-semibold text-slate-900">
                            {formatVND(order.changeAmount)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-dashed border-slate-300 text-center text-xs text-slate-600">
                <div className="italic text-slate-800">{footerText}</div>
              </div>
            </div>
          ) : (
            /* -------------------- 80MM THERMAL ROLL PREVIEW -------------------- */
            <div className="print-receipt-root w-[312px] bg-white border border-slate-300 px-4 py-5 text-slate-950 text-[12px] leading-snug shadow-sm self-start">
              <div className="text-center space-y-0.5">
                <div className="text-base font-extrabold tracking-tight">{storeName}</div>
                {address && <div className="text-[11px] text-slate-600">{address}</div>}
                {phone && <div className="text-[11px] text-slate-600 tabular-nums">ĐT: {phone}</div>}
                <div className="pt-2 mt-2 border-t border-dashed border-slate-400 text-sm font-extrabold">
                  {isProvisional ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN'}
                </div>
              </div>

              <div className="my-2.5 py-2 border-y border-dashed border-slate-400 space-y-1 text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Số HĐ:</span>
                  <span className="font-bold tabular-nums">{order.orderNumber}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Thời gian:</span>
                  <span className="tabular-nums">{order.displayTime}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Bàn / Khu:</span>
                  <span className="font-bold">{order.tableName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Khách hàng:</span>
                  <span>{order.customerName || 'Khách lẻ'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Thu ngân:</span>
                  <span>{order.cashierName || 'Thu ngân'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-600">Thanh toán:</span>
                  <span>
                    {isProvisional ? 'Chưa thanh toán' : getPaymentMethodLabel(order.paymentMethod)}
                  </span>
                </div>
              </div>

              <div className="divide-y divide-dotted divide-slate-300">
                {order.items.map((item, idx) => {
                  const unitPrice = getItemUnitPrice(item);
                  const itemDiscount = getItemDiscountAmount(item);
                  const netTotal = getItemNetTotal(item);
                  return (
                    <div key={`${item.itemId}_${idx}`} className="py-1.5">
                      <div className="font-bold text-slate-900">
                        {idx + 1}. {item.name}
                      </div>
                      {item.toppings && item.toppings.length > 0 && (
                        <div className="space-y-0.5 pl-2 mt-0.5">
                          {item.toppings.map((t, idx) => (
                            <div key={idx} className="text-[10.5px] text-slate-600 tabular-nums">
                              + {t.name} x{item.qty} = {formatVND(t.price * item.qty)}
                            </div>
                          ))}
                        </div>
                      )}
                      {item.note && (
                        <div className="text-[10.5px] text-slate-500 pl-2 italic">
                          Ghi chú: {item.note}
                        </div>
                      )}
                      <div className="flex justify-between pl-2 mt-0.5 tabular-nums text-[11.5px]">
                        <span>
                          {item.qty} × {formatVND(unitPrice)}
                        </span>
                        <span className="font-bold">{formatVND(netTotal)}</span>
                      </div>
                      {itemDiscount > 0 && (
                        <div className="text-[10.5px] text-amber-800 pl-2 tabular-nums font-medium">
                          Giảm món:{' '}
                          {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                            ? `-${item.discountValue}% (-${formatVND(itemDiscount)})`
                            : `-${formatVND(itemDiscount)}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-2.5 pt-2 border-t border-dashed border-slate-400 space-y-1 text-[11.5px]">
                <div className="flex justify-between">
                  <span>Tạm tính ({totalQty} món):</span>
                  <span className="font-bold tabular-nums">{formatVND(order.subtotal)}</span>
                </div>
                {order.discountAmount > 0 && (
                  <div className="flex justify-between text-amber-800">
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
                <div className="flex justify-between items-baseline pt-1.5 mt-1 border-t border-slate-900 text-sm font-extrabold">
                  <span>TỔNG CỘNG:</span>
                  <span className="tabular-nums">{formatVND(order.total)}</span>
                </div>
                {!isProvisional && order.paymentMethod === 'cash' && (
                  <>
                    <div className="flex justify-between text-[11px] text-slate-700 pt-1">
                      <span>Khách đưa:</span>
                      <span className="tabular-nums">{formatVND(order.cashReceived)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-900 font-semibold">
                      <span>Tiền thối lại:</span>
                      <span className="tabular-nums">{formatVND(order.changeAmount)}</span>
                    </div>
                  </>
                )}
              </div>

              {order.note && (
                <div className="mt-2 text-[11px] text-slate-700">
                  <strong>Ghi chú:</strong> {order.note}
                </div>
              )}
              {wifiInfo && <div className="mt-1 text-[11px] text-slate-700">Wi-Fi: {wifiInfo}</div>}

              {qrDataUrl && (
                <div className="mt-3 pt-3 border-t border-dashed border-slate-400 text-center space-y-1.5">
                  <div className="text-[11px] font-bold">QUÉT MÃ QR THANH TOÁN</div>
                  <img
                    src={qrDataUrl}
                    alt="Mã QR thanh toán"
                    className="w-[150px] h-[150px] object-contain mx-auto border border-slate-200 rounded p-1"
                  />
                  <div className="text-xs font-extrabold tabular-nums">{formatVND(order.total)}</div>
                  {(settings?.bankName || settings?.bankAccount || settings?.bankOwner) && (
                    <div className="mt-2 text-[10.5px] text-left border border-dashed border-slate-400 rounded p-2 bg-slate-50 space-y-0.5">
                      <div className="font-bold">Thông tin chuyển khoản:</div>
                      {settings?.bankName && <div>Ngân hàng: <strong>{settings.bankName}</strong></div>}
                      {settings?.bankAccount && <div>STK: <strong className="tabular-nums">{settings.bankAccount}</strong></div>}
                      {settings?.bankOwner && <div>Chủ TK: <strong>{settings.bankOwner}</strong></div>}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 pt-2.5 border-t border-dashed border-slate-400 text-center text-[11px] italic text-slate-700">
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
