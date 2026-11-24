import { Fragment, useState } from 'react';
import { Printer, X, CheckCircle2, Download } from 'lucide-react';
import { Order, ReceiptPaperSize, StoreSettings } from '../types/pos';
import {
  formatDotNumber,
  formatVND,
  getItemDiscountAmount,
  getItemNetTotal,
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
  const hasBankInfo = Boolean(
    settings?.bankName || settings?.bankAccount || settings?.bankOwner,
  );
  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);

  const buildCurrentHtml = () =>
    paperSize === '80mm'
      ? build80mmReceiptHtml(order, settings, isProvisional, qrDataUrl)
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
            <div className="print-receipt-root w-full max-w-[560px] bg-white border border-slate-200 px-12 py-6 text-slate-900 text-[11.5px] leading-relaxed flex flex-col justify-between min-h-[620px] print:min-h-0 shadow-xs">
              <div>
                {/* Store & Invoice Header */}
                <div className="flex items-start justify-between gap-4 pb-3.5 border-b border-slate-300">
                  <div className="space-y-0.5">
                    <div className="text-base font-bold tracking-tight text-slate-900">{storeName}</div>
                    {address && <div className="text-[10.8px] text-slate-600">{address}</div>}
                    {phone && (
                      <div className="text-[10.8px] text-slate-600 tabular-nums">Hotline: {phone}</div>
                    )}
                  </div>
                  <div className="text-center shrink-0">
                    <div className="text-xl font-bold tracking-tight leading-tight text-cyan-700">
                      {isProvisional ? 'PHIẾU TẠM TÍNH' : 'PHIẾU THANH TOÁN'}
                    </div>
                    <div className="text-[11.5px] font-bold text-slate-900 tabular-nums mt-0.5">
                      {order.orderNumber}
                    </div>
                    <div className="text-[10.5px] text-slate-500 tabular-nums">{order.displayTime}</div>
                  </div>
                </div>

                {/* Order Meta Grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 py-2.5 text-[10.8px]">
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

                {/* Full A5 Itemized Table (No STT, base price + clean topping sub-lines) */}
                <div className="mt-2">
                  <table className="w-full text-left border-collapse text-[11.5px]">
                    <thead>
                      <tr className="border-y border-slate-400 bg-slate-50 text-slate-900 font-bold">
                        <th className="py-1.5 px-1.5">Tên món</th>
                        <th className="py-1.5 px-1.5 w-9 text-center">SL</th>
                        <th className="py-1.5 px-1.5 w-20 text-right">Đơn giá</th>
                        <th className="py-1.5 px-1.5 w-20 text-right">Chiết khấu</th>
                        <th className="py-1.5 px-1.5 w-22 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item, index) => {
                        const baseTotal = item.price * item.qty;
                        const toppings = item.toppings ?? [];
                        const hasToppings = toppings.length > 0;
                        const itemDiscount = getItemDiscountAmount(item);
                        const netTotal = getItemNetTotal(item);
                        const isLastItem = index === order.items.length - 1;
                        return (
                          <Fragment key={`${item.itemId}_${index}`}>
                            <tr
                              className={
                                !hasToppings && !isLastItem
                                  ? 'border-b border-dashed border-slate-300'
                                  : ''
                              }
                            >
                              <td className={`${hasToppings ? 'pt-2 pb-0.5' : 'py-2'} px-1.5`}>
                                <div className="font-medium text-slate-900">{item.name}</div>
                                {item.note && (
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    Ghi chú: {item.note}
                                  </div>
                                )}
                              </td>
                              <td
                                className={`${hasToppings ? 'pt-2 pb-0.5' : 'py-2'} px-1.5 text-center tabular-nums font-medium text-slate-900`}
                              >
                                {item.qty}
                              </td>
                              <td
                                className={`${hasToppings ? 'pt-2 pb-0.5' : 'py-2'} px-1.5 text-right tabular-nums text-slate-700 whitespace-nowrap`}
                              >
                                {formatVND(item.price)}
                              </td>
                              <td
                                className={`${hasToppings ? 'pt-2 pb-0.5' : 'py-2'} px-1.5 text-right tabular-nums whitespace-nowrap`}
                              >
                                {!hasToppings && itemDiscount > 0 ? (
                                  <div className="text-amber-700 font-medium leading-tight">
                                    {item.discountType === 'percent' && (item.discountValue ?? 0) > 0 ? (
                                      <>
                                        <div>-{item.discountValue}%</div>
                                        <div className="text-[9.5px] text-amber-800/80">
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
                              <td
                                className={`${hasToppings ? 'pt-2 pb-0.5' : 'py-2'} px-1.5 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap`}
                              >
                                {formatVND(hasToppings ? baseTotal : netTotal)}
                              </td>
                            </tr>
                            {toppings.map((t, tIdx) => {
                              const isLastSub = tIdx === toppings.length - 1 && itemDiscount <= 0;
                              const isFree = t.price <= 0;
                              return (
                                <tr
                                  key={`${item.itemId}_${index}_t_${tIdx}`}
                                  className={
                                    isLastSub && !isLastItem
                                      ? 'border-b border-dashed border-slate-300'
                                      : ''
                                  }
                                >
                                  {isFree ? (
                                    <td
                                      colSpan={5}
                                      className={`py-0.5 ${isLastSub ? 'pb-2' : ''} px-1.5 pl-4 text-[10.5px] text-cyan-700`}
                                    >
                                      + {t.name}
                                    </td>
                                  ) : (
                                    <>
                                      <td
                                        colSpan={4}
                                        className={`py-0.5 ${isLastSub ? 'pb-2' : ''} px-1.5 pl-4 text-[10.5px] text-cyan-700`}
                                      >
                                        + {t.name}
                                        {item.qty > 1
                                          ? ` (${item.qty} × ${formatDotNumber(t.price)})`
                                          : ''}
                                      </td>
                                      <td
                                        className={`py-0.5 ${isLastSub ? 'pb-2' : ''} px-1.5 text-right tabular-nums text-[10.5px] text-slate-800 whitespace-nowrap`}
                                      >
                                        +{formatVND(t.price * item.qty)}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                            {hasToppings && itemDiscount > 0 && (
                              <tr
                                className={
                                  !isLastItem ? 'border-b border-dashed border-slate-300' : ''
                                }
                              >
                                <td
                                  colSpan={3}
                                  className="py-0.5 pb-2 px-1.5 pl-4 text-[10px] text-amber-700 font-medium"
                                >
                                  Chiết khấu món
                                  {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                                    ? ` (-${item.discountValue}%)`
                                    : ''}
                                </td>
                                <td className="py-0.5 pb-2 px-1.5 text-right tabular-nums text-[10px] text-amber-700 whitespace-nowrap">
                                  -{formatVND(itemDiscount)}
                                </td>
                                <td className="py-0.5 pb-2 px-1.5 text-right tabular-nums text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                                  -{formatVND(itemDiscount)}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary & Uploaded QR Section */}
                <div className="mt-4 pt-3.5 border-t border-slate-300 grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
                  <div className="sm:col-span-6 space-y-2 text-[10.8px]">
                    {qrDataUrl ? (
                      <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center gap-2.5">
                        <img
                          src={qrDataUrl}
                          alt="Mã QR thanh toán chuyển khoản"
                          className="w-22 h-22 object-contain rounded border border-slate-200 bg-white p-1 shrink-0"
                        />
                        <div className="space-y-0.5 min-w-0 text-[10.5px]">
                          <div className="font-bold text-cyan-800">Thông tin chuyển khoản</div>
                          {settings?.bankName && (
                            <div className="text-slate-700">
                              NH: <strong>{settings.bankName}</strong>
                            </div>
                          )}
                          {settings?.bankAccount && (
                            <div className="text-slate-700">
                              STK: <strong className="tabular-nums">{settings.bankAccount}</strong>
                            </div>
                          )}
                          {settings?.bankOwner && (
                            <div className="text-slate-700">
                              Chủ TK: <strong>{settings.bankOwner}</strong>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      hasBankInfo && (
                        <div className="text-[10.8px] border border-slate-200 rounded-lg p-2.5 bg-slate-50 space-y-0.5">
                          <div className="font-bold text-cyan-800">Thông tin chuyển khoản:</div>
                          {settings?.bankName && <div>Ngân hàng: <strong>{settings.bankName}</strong></div>}
                          {settings?.bankAccount && <div>STK: <strong className="tabular-nums">{settings.bankAccount}</strong></div>}
                          {settings?.bankOwner && <div>Chủ TK: <strong>{settings.bankOwner}</strong></div>}
                        </div>
                      )
                    )}
                    {order.note && (
                      <div className="text-slate-600">
                        <span className="font-medium text-slate-800">Ghi chú đơn:</span> {order.note}
                      </div>
                    )}
                    {wifiInfo && <div className="text-slate-600">Wi-Fi: {wifiInfo}</div>}
                  </div>

                  <div className="sm:col-span-6 space-y-1.5 text-[10.8px]">
                    <div className="flex justify-between text-slate-600">
                      <span>Tạm tính ({totalQty} món):</span>
                      <span className="tabular-nums font-medium text-slate-900">
                        {formatVND(order.subtotal)}
                      </span>
                    </div>
                    {order.discountAmount > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>
                          Chiết khấu
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
                    <div className="flex justify-between items-baseline pt-2 border-t border-slate-300 text-sm font-bold text-slate-900">
                      <span>TỔNG CỘNG:</span>
                      <span className="tabular-nums text-cyan-700">{formatVND(order.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-7 pt-2 text-center text-[10.8px] text-slate-600">
                <div className="italic text-slate-800">{footerText}</div>
              </div>
            </div>
          ) : (
            /* -------------------- 80MM THERMAL ROLL PREVIEW (TAHOMA CRISP 203 DPI SCALE) -------------------- */
            <div className="print-receipt-root print-receipt-80mm w-[304px] bg-white border border-slate-300 px-[30px] py-3.5 text-black text-[11.2px] font-normal leading-snug shadow-sm self-start">
              <div className="text-center space-y-0.5">
                <div className="text-[1.3em] font-bold tracking-tight text-black">{storeName}</div>
                {address && <div className="text-[0.9em] font-medium text-black">{address}</div>}
                {phone && <div className="text-[0.9em] font-medium text-black tabular-nums">ĐT: {phone}</div>}
                <div className="pt-2 text-[1.52em] font-bold leading-tight text-black">
                  {isProvisional ? 'PHIẾU TẠM TÍNH' : 'PHIẾU THANH TOÁN'}
                </div>
                <div className="text-[1em] font-bold tabular-nums text-black pb-1">
                  {order.orderNumber}
                </div>
              </div>

              <div className="mt-1 mb-2 space-y-0.5 text-[0.95em] font-medium text-black">
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

              <table className="w-full border-collapse table-fixed text-[1.03em] leading-snug text-black tabular-nums">
                <colgroup>
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '27%' }} />
                </colgroup>
                <thead>
                  <tr className="border-y border-black text-[1em] font-bold">
                    <th className="py-1 pr-1 text-left whitespace-nowrap">Tên món</th>
                    <th className="py-1 text-center whitespace-nowrap">SL</th>
                    <th className="py-1 pl-0.5 text-right whitespace-nowrap">Đơn giá</th>
                    <th className="py-1 pl-0.5 text-right whitespace-nowrap">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, idx) => {
                    const baseTotal = item.price * item.qty;
                    const itemDiscount = getItemDiscountAmount(item);
                    const toppings = item.toppings ?? [];
                    const isLastItem = idx === order.items.length - 1;
                    const hasSubRows =
                      toppings.length > 0 || itemDiscount > 0 || Boolean(item.note);

                    return (
                      <Fragment key={`${item.itemId}_${idx}`}>
                        <tr
                          className={
                            !isLastItem && !hasSubRows
                              ? 'border-b border-dashed border-black'
                              : ''
                          }
                        >
                          <td
                            className={`pt-2 ${
                              hasSubRows ? 'pb-0.5' : 'pb-2'
                            } pr-1 align-top font-bold break-words`}
                          >
                            {item.name}
                          </td>
                          <td
                            className={`pt-2 ${
                              hasSubRows ? 'pb-0.5' : 'pb-2'
                            } align-top text-center whitespace-nowrap`}
                          >
                            {item.qty}
                          </td>
                          <td
                            className={`pt-2 ${
                              hasSubRows ? 'pb-0.5' : 'pb-2'
                            } pl-0.5 align-top text-right whitespace-nowrap`}
                          >
                            {formatDotNumber(item.price)}
                          </td>
                          <td
                            className={`pt-2 ${
                              hasSubRows ? 'pb-0.5' : 'pb-2'
                            } pl-0.5 align-top text-right font-bold whitespace-nowrap`}
                          >
                            {formatDotNumber(baseTotal)}
                          </td>
                        </tr>
                        {toppings.map((t, tIdx) => {
                          const isLastSub =
                            tIdx === toppings.length - 1 &&
                            itemDiscount <= 0 &&
                            !item.note;
                          return (
                            <tr
                              key={`${item.itemId}_${idx}_t_${tIdx}`}
                              className={
                                !isLastItem && isLastSub
                                  ? 'border-b border-dashed border-black'
                                  : ''
                              }
                            >
                              {t.price <= 0 ? (
                                <td
                                  colSpan={4}
                                  className={`pl-2 pr-1 ${
                                    isLastSub ? 'pb-2' : 'pb-0.5'
                                  } text-[0.93em] align-top break-words`}
                                >
                                  + {t.name}
                                </td>
                              ) : (
                                <>
                                  <td
                                    colSpan={3}
                                    className={`pl-2 pr-1 ${
                                      isLastSub ? 'pb-2' : 'pb-0.5'
                                    } text-[0.93em] align-top break-words`}
                                  >
                                    + {t.name}
                                    {item.qty > 1
                                      ? ` (${item.qty}×${formatDotNumber(t.price)})`
                                      : ''}
                                  </td>
                                  <td
                                    className={`pl-0.5 ${
                                      isLastSub ? 'pb-2' : 'pb-0.5'
                                    } text-[0.93em] align-top text-right whitespace-nowrap`}
                                  >
                                    +{formatDotNumber(t.price * item.qty)}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                        {itemDiscount > 0 && (
                          <tr
                            className={
                              !isLastItem && !item.note
                                ? 'border-b border-dashed border-black'
                                : ''
                            }
                          >
                            <td
                              colSpan={3}
                              className={`pl-2 pr-1 ${
                                !item.note ? 'pb-2' : 'pb-0.5'
                              } text-[0.93em] font-bold align-top`}
                            >
                              Chiết khấu món
                              {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                                ? ` (-${item.discountValue}%)`
                                : ''}
                            </td>
                            <td
                              className={`pl-0.5 ${
                                !item.note ? 'pb-2' : 'pb-0.5'
                              } text-[0.93em] font-bold align-top text-right whitespace-nowrap`}
                            >
                              -{formatDotNumber(itemDiscount)}
                            </td>
                          </tr>
                        )}
                        {item.note && (
                          <tr
                            className={
                              !isLastItem ? 'border-b border-dashed border-black' : ''
                            }
                          >
                            <td
                              colSpan={4}
                              className="pl-2 pr-1 pb-2 text-[0.92em] align-top break-words"
                            >
                              Ghi chú: {item.note}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-2.5 pt-2 border-t border-black space-y-0.5 text-[1em] font-medium text-black">
                <div className="flex justify-between">
                  <span>Tạm tính ({totalQty} món):</span>
                  <span className="font-bold tabular-nums">{formatVND(order.subtotal)}</span>
                </div>
                {order.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span>
                      Chiết khấu
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

              {qrDataUrl && hasBankInfo ? (
                <div className="mt-3.5 space-y-1.5">
                  <div className="text-center text-[0.95em] font-bold text-black">
                    QUÉT MÃ QR CHUYỂN KHOẢN
                  </div>
                  <div className="flex items-center gap-2.5">
                    <img
                      src={qrDataUrl}
                      alt="Mã QR thanh toán"
                      className="w-[72px] h-[72px] object-contain shrink-0 bg-white"
                    />
                    <div className="min-w-0 flex-1 text-[0.92em] text-left space-y-0.5 text-black">
                      <div className="font-bold">Thông tin chuyển khoản:</div>
                      {settings?.bankName && (
                        <div>
                          NH: <strong>{settings.bankName}</strong>
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
                  </div>
                </div>
              ) : qrDataUrl ? (
                <div className="mt-3.5 text-center space-y-1">
                  <div className="text-[0.95em] font-bold text-black">QUÉT MÃ QR CHUYỂN KHOẢN</div>
                  <img
                    src={qrDataUrl}
                    alt="Mã QR thanh toán"
                    className="w-[82px] h-[82px] object-contain mx-auto bg-white"
                  />
                </div>
              ) : (
                hasBankInfo && (
                  <div className="mt-2.5 text-[0.92em] text-left border border-black rounded p-2 space-y-0.5 text-black bg-white">
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
                )
              )}

              <div className="mt-4 text-center text-[0.9em] font-normal text-black">
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
