import { useMemo, useState } from 'react';
import {
  Banknote,
  CreditCard,
  QrCode,
  Printer,
  Plus,
  ArrowLeft,
  UserCheck,
  X,
  Percent,
} from 'lucide-react';
import { formatDotNumber, formatVND, parseDotNumber } from '../lib/format';
import { Customer, DiscountType, LIMITS, PaymentMethod, StoreSettings } from '../types/pos';

interface KasPaymentPanelProps {
  ownerId: string;
  cashierName: string;
  settings: StoreSettings | null;
  customers: Customer[];
  selectedCustomerId: string;
  subtotal: number;
  itemDiscountTotal: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentMethod: Exclude<PaymentMethod, 'unpaid'>;
  cashReceivedInput: string;
  parsedCashReceived: number;
  changeAmount: number;
  customerName: string;
  orderNote: string;
  isSubmitting: boolean;
  onSelectCustomer: (customer: Customer | null) => void;
  onChangeDiscountType: (type: DiscountType) => void;
  onChangeDiscountValue: (val: number) => void;
  onChangeVatRate: (rate: number) => void;
  onChangePaymentMethod: (method: Exclude<PaymentMethod, 'unpaid'>) => void;
  onChangeCashReceived: (val: string) => void;
  onChangeCustomerName: (val: string) => void;
  onChangeOrderNote: (val: string) => void;
  onBackToFloor: () => void;
  onBackToMenu: () => void;
  onPrintProvisional: () => void;
  onConfirmCheckout: () => void;
  onOpenSettings: () => void;
  onQuickAddCustomer: (name: string) => void;
}

export function KasPaymentPanel({
  ownerId,
  cashierName,
  settings,
  customers,
  selectedCustomerId,
  subtotal,
  itemDiscountTotal,
  discountType,
  discountValue,
  discountAmount,
  vatRate,
  vatAmount,
  total,
  paymentMethod,
  cashReceivedInput,
  parsedCashReceived,
  changeAmount,
  customerName,
  orderNote,
  isSubmitting,
  onSelectCustomer,
  onChangeDiscountType,
  onChangeDiscountValue,
  onChangeVatRate,
  onChangePaymentMethod,
  onChangeCashReceived,
  onChangeCustomerName,
  onChangeOrderNote,
  onBackToFloor,
  onBackToMenu,
  onPrintProvisional,
  onConfirmCheckout,
  onOpenSettings,
  onQuickAddCustomer,
}: KasPaymentPanelProps) {
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customDiscountOpen, setCustomDiscountOpen] = useState(false);

  const hasCustomDiscount =
    discountValue > 0 &&
    !(discountType === 'percent' && (discountValue === 10 || discountValue === 20));
  const isCustomDiscountActive = customDiscountOpen || hasCustomDiscount;

  const uploadedQrUrl = settings?.qrImageUrl || '';
  const quickCashAmounts = [20000, 50000, 100000, 200000, 500000]
    .filter((amt) => amt > total)
    .slice(0, 4);
  const insufficientCash = paymentMethod === 'cash' && parsedCashReceived < total;

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const matchingCustomers = useMemo(() => {
    const kw = customerName.trim().toLowerCase();
    if (!kw) return customers.slice(0, 8);
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(kw) ||
          c.phone.toLowerCase().includes(kw),
      )
      .slice(0, 8);
  }, [customers, customerName]);

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Scrollable Payment Calculator Body */}
      <div className="flex-1 overflow-y-auto pos-scroll p-4 sm:p-5 space-y-5">
        {/* Top 2-Column Financial Matrix */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-2.5">
          {/* Left Financial Column: Tiền hàng, Chiết khấu, Giảm món */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-4 text-sm font-bold text-cyan-800 text-right pr-2">
                Tiền hàng
              </label>
              <div className="col-span-8 h-10 px-3 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-end text-base font-bold tabular-nums text-cyan-800">
                {formatDotNumber(subtotal) || '0'}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-sm font-bold text-[#0b2b6b] underline decoration-[#0b2b6b]/40 underline-offset-2 text-right pr-2">
                  Chiết khấu [-]
                </label>
                <div className="col-span-4 grid grid-cols-3 gap-1 p-1 h-10 bg-slate-100 border border-slate-200 rounded-md">
                  {[10, 20].map((pct) => {
                    const active =
                      !customDiscountOpen &&
                      discountType === 'percent' &&
                      discountValue === pct;
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => {
                          setCustomDiscountOpen(false);
                          onChangeDiscountType('percent');
                          onChangeDiscountValue(active ? 0 : pct);
                        }}
                        className={`text-xs font-bold tabular-nums rounded transition-colors ${
                          active
                            ? 'bg-[#0a2268] text-white'
                            : 'text-slate-600 hover:bg-white'
                        }`}
                      >
                        {pct}%
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      if (isCustomDiscountActive) {
                        setCustomDiscountOpen(false);
                        onChangeDiscountValue(0);
                      } else {
                        setCustomDiscountOpen(true);
                      }
                    }}
                    className={`text-xs font-bold rounded transition-colors ${
                      isCustomDiscountActive
                        ? 'bg-[#0a2268] text-white'
                        : 'text-slate-600 hover:bg-white'
                    }`}
                  >
                    Nhập
                  </button>
                </div>
                <div className="col-span-4 h-10 px-3 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-end text-sm font-bold tabular-nums text-amber-700">
                  {discountAmount > 0 ? `-${formatDotNumber(discountAmount)}` : '0'}
                </div>
              </div>

              {isCustomDiscountActive && (
                <div className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-4" />
                  <div className="col-span-8 flex items-center gap-1.5">
                    <div className="flex-1 flex items-center h-9 border border-cyan-500 rounded-md overflow-hidden bg-white shadow-xs">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        value={
                          discountValue > 0
                            ? discountType === 'fixed'
                              ? formatDotNumber(discountValue)
                              : String(discountValue)
                            : ''
                        }
                        onChange={(e) => {
                          const parsed = parseDotNumber(e.target.value);
                          const maxVal = discountType === 'percent' ? 100 : subtotal;
                          onChangeDiscountValue(Math.min(maxVal, Math.max(0, parsed)));
                        }}
                        placeholder={
                          discountType === 'percent'
                            ? 'Nhập % chiết khấu...'
                            : 'Nhập số tiền chiết khấu...'
                        }
                        aria-label="Chiết khấu đơn"
                        className="w-full min-w-0 px-2.5 text-sm font-bold tabular-nums text-right text-slate-900 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onChangeDiscountType(discountType === 'percent' ? 'fixed' : 'percent');
                          onChangeDiscountValue(0);
                        }}
                        className="h-full px-3 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border-l border-slate-300 shrink-0"
                        title="Đổi % hoặc VNĐ"
                      >
                        {discountType === 'percent' ? '%' : '₫'}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomDiscountOpen(false);
                        onChangeDiscountValue(0);
                      }}
                      className="h-9 w-9 rounded-md border border-slate-300 bg-white hover:bg-red-50 hover:border-red-300 text-slate-500 hover:text-red-600 flex items-center justify-center shrink-0 transition-colors"
                      title="Xóa chiết khấu"
                      aria-label="Xóa chiết khấu"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-4 text-sm font-semibold text-slate-600 text-right pr-2">
                Giảm theo món
              </label>
              <div className="col-span-8 h-10 px-3 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-end text-sm font-semibold tabular-nums text-amber-700">
                {itemDiscountTotal > 0 ? `-${formatVND(itemDiscountTotal)} (đã trừ)` : '0 ₫'}
              </div>
            </div>
          </div>

          {/* Right Financial Column: VAT, Tổng phải thu, Khách trả, Tiền thối lại */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-4 text-sm font-bold text-slate-700 text-right pr-2">
                Thuế VAT [+]
              </label>
              <div className="col-span-4 grid grid-cols-3 gap-1 p-1 h-10 bg-slate-100 border border-slate-200 rounded-md">
                {[0, 8, 10].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onChangeVatRate(rate)}
                    className={`text-xs font-bold tabular-nums rounded transition-colors ${
                      vatRate === rate
                        ? 'bg-[#0a2268] text-white'
                        : 'text-slate-600 hover:bg-white'
                    }`}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
              <div className="col-span-4 h-10 px-3 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-end text-sm font-bold tabular-nums text-slate-800">
                {vatAmount > 0 ? formatDotNumber(vatAmount) : '0'}
              </div>
            </div>

            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-4 text-sm font-bold text-[#0b2b6b] text-right pr-2">
                Tổng phải thu
              </label>
              <div className="col-span-8 h-10 px-3 rounded-md bg-cyan-50 border border-cyan-300 flex items-center justify-end text-lg font-bold tabular-nums text-cyan-800">
                {formatDotNumber(total) || '0'} ₫
              </div>
            </div>

            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-4 text-sm font-bold text-red-600 text-right pr-2">
                Khách trả
              </label>
              <div className="col-span-8">
                {paymentMethod === 'cash' ? (
                  <div
                    aria-label="Khách trả"
                    className="w-full h-10 px-3 rounded-md bg-white border-2 border-red-300 flex items-center justify-end gap-1 text-lg font-bold tabular-nums text-red-600 select-none"
                  >
                    <span>{formatDotNumber(parsedCashReceived) || '0'}</span>
                    <span className="text-xs font-bold text-slate-400">₫</span>
                  </div>
                ) : (
                  <div className="h-10 px-3 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-end text-lg font-bold tabular-nums text-red-600">
                    {formatDotNumber(total) || '0'} ₫
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-4 text-sm font-bold text-[#0b2b6b] underline decoration-[#0b2b6b]/40 underline-offset-2 text-right pr-2">
                {insufficientCash ? 'Còn thiếu' : 'Tiền thối lại'}
              </label>
              <div
                className={`col-span-8 h-10 px-3 rounded-md border flex items-center justify-end text-base font-bold tabular-nums ${
                  insufficientCash
                    ? 'bg-red-50 border-red-300 text-red-600'
                    : 'bg-slate-100 border-slate-200 text-[#0b2b6b]'
                }`}
              >
                {insufficientCash
                  ? formatVND(total - parsedCashReceived)
                  : formatVND(paymentMethod === 'cash' ? changeAmount : 0)}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Cash Tender Strip when Cash is active */}
        {paymentMethod === 'cash' && total > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-bold text-slate-500 mr-1">Gợi ý tiền mặt:</span>
            <button
              type="button"
              onClick={() => onChangeCashReceived('')}
              className={`h-9 px-3.5 text-xs font-bold rounded-md border transition-colors ${
                parsedCashReceived === total
                  ? 'bg-cyan-600 text-white border-cyan-700'
                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Đủ tiền ({formatDotNumber(total)})
            </button>
            {quickCashAmounts.map((amt) => {
              const formatted = formatDotNumber(amt);
              const isActive = parsedCashReceived === amt;
              return (
                <button
                  key={amt}
                  type="button"
                  onClick={() => onChangeCashReceived(formatted)}
                  className={`h-9 px-3.5 text-xs font-bold tabular-nums rounded-md border transition-colors ${
                    isActive
                      ? 'bg-cyan-600 text-white border-cyan-700'
                      : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {formatDotNumber(amt)} ₫
                </button>
              );
            })}
          </div>
        )}

        {/* Middle Payment Methods + LARGE Store QR Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start pt-2 border-t border-slate-200">
          <div className={paymentMethod === 'transfer' ? 'xl:col-span-5 space-y-2.5' : 'xl:col-span-12 space-y-2.5'}>
            {(
              [
                { id: 'cash', label: 'Tiền mặt', hint: 'Thanh toán tiền mặt tại quầy', icon: Banknote },
                { id: 'transfer', label: 'Chuyển khoản QR', hint: 'Quét mã QR ngân hàng của quán', icon: QrCode },
                { id: 'card', label: 'Thẻ ngân hàng / VISA', hint: 'Quẹt thẻ POS / Napas / Visa', icon: CreditCard },
              ] as const
            ).map(({ id, label, hint, icon: Icon }) => {
              const active = paymentMethod === id;
              const displayAmount = active
                ? id === 'cash'
                  ? parsedCashReceived
                  : total
                : 0;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangePaymentMethod(id)}
                  className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border-2 text-left transition-all ${
                    active
                      ? 'bg-cyan-50/70 border-cyan-600 shadow-xs'
                      : 'bg-slate-50/70 border-slate-200 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${
                        active ? 'bg-[#0a2268] text-white' : 'bg-white border border-slate-300 text-slate-500'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-bold ${
                          active ? 'text-[#0a2268]' : 'text-slate-800'
                        }`}
                      >
                        {label}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{hint}</div>
                    </div>
                  </div>

                  <div
                    className={`min-w-[125px] h-10 px-3 rounded-md border flex items-center justify-end text-base font-bold tabular-nums shrink-0 ${
                      active
                        ? 'bg-white border-cyan-500 text-cyan-800'
                        : 'bg-slate-100 border-slate-200 text-slate-400'
                    }`}
                  >
                    {formatDotNumber(displayAmount) || '0'}
                  </div>
                </button>
              );
            })}
          </div>

          {paymentMethod === 'transfer' && (
            <div className="xl:col-span-7 rounded-xl border border-slate-200 bg-slate-50/80 p-4 flex flex-col sm:flex-row items-center gap-4">
              {uploadedQrUrl ? (
                <img
                  src={uploadedQrUrl}
                  alt="Mã QR chuyển khoản của quán"
                  className="w-44 h-44 object-contain rounded-lg bg-white border border-slate-200 p-2 shrink-0"
                />
              ) : (
                <div className="w-40 h-40 rounded-lg border border-dashed border-slate-300 bg-white flex flex-col items-center justify-center text-center p-3 shrink-0 gap-2">
                  <QrCode className="w-8 h-8 text-slate-300" />
                  <span className="text-xs text-slate-500">Chưa tải ảnh QR</span>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-xs font-bold text-cyan-700 hover:underline"
                  >
                    Cài đặt mã QR
                  </button>
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1.5 text-sm text-slate-700 text-center sm:text-left">
                <div className="text-xs font-bold uppercase tracking-wide text-cyan-700">
                  Thông tin chuyển khoản
                </div>
                {settings?.bankName && (
                  <div>
                    Ngân hàng: <strong className="text-slate-900">{settings.bankName}</strong>
                  </div>
                )}
                {settings?.bankAccount && (
                  <div>
                    Số tài khoản:{' '}
                    <strong className="text-slate-900 tabular-nums">{settings.bankAccount}</strong>
                  </div>
                )}
                {settings?.bankOwner && (
                  <div>
                    Chủ tài khoản: <strong className="text-slate-900">{settings.bankOwner}</strong>
                  </div>
                )}
                <div className="pt-1 text-base font-extrabold text-[#0a2268] tabular-nums">
                  Cần thanh toán: {formatVND(total)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Cashier / Customer Picker / Order Note Strip */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-2 border-t border-slate-200">
          <div className="md:col-span-3 h-10 px-3 rounded-md bg-slate-100 border border-slate-200 flex items-center text-xs font-bold text-slate-700 truncate">
            Thu ngân: {cashierName}
          </div>

          {/* Searchable Customer Picker + Walk-in input */}
          <div className="md:col-span-4 relative">
            <div className="relative flex items-center">
              <input
                type="text"
                value={customerName}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => window.setTimeout(() => setShowCustomerDropdown(false), 180)}
                onChange={(e) => {
                  if (selectedCustomerId) onSelectCustomer(null);
                  onChangeCustomerName(e.target.value.slice(0, LIMITS.CUSTOMER_NAME_MAX));
                  setShowCustomerDropdown(true);
                }}
                placeholder="Chọn khách quen hoặc nhập tên..."
                className={`w-full h-10 pl-3 pr-8 text-sm bg-white border rounded-md focus:outline-none focus:border-cyan-600 ${
                  selectedCustomer ? 'border-cyan-600 font-semibold text-cyan-900 bg-cyan-50/40' : 'border-slate-300'
                }`}
              />
              {selectedCustomer ? (
                <button
                  type="button"
                  onClick={() => {
                    onSelectCustomer(null);
                    onChangeCustomerName('');
                  }}
                  className="absolute right-2 text-cyan-700 hover:text-red-600 p-0.5"
                  title="Bỏ chọn khách hàng"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                customers.length > 0 && (
                  <UserCheck className="w-4 h-4 text-slate-400 absolute right-2.5 pointer-events-none" />
                )
              )}
            </div>

            {showCustomerDropdown && (matchingCustomers.length > 0 || customerName.trim()) && (
              <div className="absolute left-0 right-0 bottom-full mb-1 z-30 bg-white border border-slate-300 rounded-lg shadow-xl max-h-56 overflow-y-auto pos-scroll divide-y divide-slate-100">
                <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-bold text-slate-500 flex items-center justify-between">
                  <span>Khách hàng đã lưu</span>
                  {customerName.trim() && !customers.some((c) => c.name.toLowerCase() === customerName.trim().toLowerCase()) && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onQuickAddCustomer(customerName.trim());
                        setShowCustomerDropdown(false);
                      }}
                      className="text-xs font-bold text-cyan-700 hover:underline inline-flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      + Thêm &quot;{customerName.trim()}&quot;
                    </button>
                  )}
                </div>
                {matchingCustomers.map((cust) => (
                  <button
                    key={cust.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelectCustomer(cust);
                      setShowCustomerDropdown(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-cyan-50 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">{cust.name}</div>
                      {cust.phone && (
                        <div className="text-[11px] text-slate-500 tabular-nums">{cust.phone}</div>
                      )}
                    </div>
                    {cust.defaultDiscountValue > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded tabular-nums shrink-0">
                        <Percent className="w-2.5 h-2.5" />
                        {cust.defaultDiscountType === 'percent'
                          ? `${cust.defaultDiscountValue}%`
                          : formatVND(cust.defaultDiscountValue)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <input
            type="text"
            value={orderNote}
            onChange={(e) => onChangeOrderNote(e.target.value.slice(0, LIMITS.ORDER_NOTE_MAX))}
            placeholder="Nhập ghi chú hóa đơn..."
            className="md:col-span-5 h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-cyan-600"
          />
        </div>
      </div>

      {/* Bottom Dark Navy Action Bar (No Shortcut Labels) */}
      <div className="bg-[#071a42] border-t border-blue-950 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBackToFloor}
            className="h-11 px-4 rounded-md bg-slate-300 hover:bg-slate-200 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Quay ra
          </button>

          <button
            type="button"
            onClick={onBackToMenu}
            className="h-11 px-4 rounded-md bg-[#112d75] hover:bg-[#193d99] border border-blue-700/60 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Thêm món
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrintProvisional}
            className="h-11 px-5 rounded-md bg-[#112d75] hover:bg-[#193d99] border border-blue-600/70 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            In tạm tính
          </button>

          <button
            type="button"
            disabled={isSubmitting || insufficientCash}
            onClick={onConfirmCheckout}
            className="h-11 px-6 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-45 border border-cyan-400/60 text-white text-sm font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-sm"
          >
            <Printer className="w-4 h-4" />
            {isSubmitting ? 'Đang xử lý...' : 'In thanh toán'}
          </button>
        </div>
      </div>
    </div>
  );
}
