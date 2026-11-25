import { useMemo, useState } from 'react';
import { Search, Printer, Ban, Eye, X } from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import {
  formatDateVN,
  formatVND,
  getItemDiscountAmount,
  getItemNetTotal,
  getItemUnitPrice,
  getPaymentMethodLabel,
} from '../lib/format';
import { LIMITS, Order, OrderStatus, PaymentMethod, sanitizeText } from '../types/pos';

interface OrdersHistoryViewProps {
  orders: Order[];
  onPrintReceipt: (order: Order, isProvisional: boolean) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export function OrdersHistoryView({
  orders,
  onPrintReceipt,
  onNotify,
}: OrdersHistoryViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentMethod>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [voidTarget, setVoidTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  // Exclude open/draft orders and any legacy sample seed orders from the finalized Bills ledger
  const finalizedOrders = useMemo(
    () => orders.filter((ord) => ord.status !== 'open' && !ord.id.startsWith('seedord')),
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return finalizedOrders
      .filter((ord) => {
        if (statusFilter !== 'all' && ord.status !== statusFilter) return false;
        if (paymentFilter !== 'all' && ord.paymentMethod !== paymentFilter) return false;
        if (dateFilter && ord.dateKey !== dateFilter) return false;
        if (!q) return true;
        return (
          ord.orderNumber.toLowerCase().includes(q) ||
          ord.tableName.toLowerCase().includes(q) ||
          ord.customerName.toLowerCase().includes(q) ||
          ord.items.some((it) => it.name.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const cmpDate = b.dateKey.localeCompare(a.dateKey);
        if (cmpDate !== 0) return cmpDate;
        return b.displayTime.localeCompare(a.displayTime);
      });
  }, [finalizedOrders, search, statusFilter, paymentFilter, dateFilter]);

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (voiding || !voidTarget || voidTarget.status === 'cancelled') return;
    const reason = sanitizeText(cancelReason, LIMITS.CANCEL_REASON_MAX);
    if (!reason) {
      onNotify('Vui lòng nhập lý do hủy hóa đơn.', 'error');
      return;
    }

    setVoiding(true);
    const batch = writeBatch(db);

    try {
      batch.update(doc(db, 'orders', voidTarget.id), {
        status: 'cancelled',
        cancelReason: reason,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      setVoidTarget(null);
      setCancelReason('');
      if (selectedOrder?.id === voidTarget.id) {
        setSelectedOrder(null);
      }
    } catch (error) {
      const msg = reportFirestoreError(error, OperationType.UPDATE, `orders/${voidTarget.id}`);
      onNotify(msg, 'error');
    } finally {
      setVoiding(false);
    }
  };

  const renderStatusText = (status: OrderStatus) => {
    switch (status) {
      case 'completed':
        return <span className="text-xs font-semibold text-emerald-700">Đã thanh toán</span>;
      case 'cancelled':
        return <span className="text-xs font-semibold text-rose-600">Đã hủy</span>;
      default:
        return <span className="text-xs font-semibold text-amber-700">Đang phục vụ</span>;
    }
  };

  return (
    <div className="p-5 sm:p-6 max-w-[1440px] mx-auto space-y-5">
      {/* Filter Toolbar */}
      <div className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mã HĐ, tên bàn, khách hàng, món..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 text-xs tabular-nums border border-zinc-200 rounded-lg bg-zinc-50 focus:outline-none focus:bg-white focus:border-emerald-700"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900 underline"
            >
              Mọi ngày
            </button>
          )}

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as 'all' | PaymentMethod)}
            className="px-3 py-2 text-xs font-medium border border-zinc-200 rounded-lg bg-zinc-50 focus:outline-none focus:bg-white focus:border-emerald-700"
          >
            <option value="all">Mọi hình thức TT</option>
            <option value="cash">Tiền mặt</option>
            <option value="transfer">Chuyển khoản QR</option>
            <option value="card">Thẻ ngân hàng</option>
          </select>

          <div className="flex items-center gap-1 p-1 bg-zinc-200/75 rounded-xl">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'completed', label: 'Đã thanh toán' },
                { id: 'cancelled', label: 'Đã hủy' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-white text-zinc-950 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                <th className="py-3 px-4">Mã hóa đơn</th>
                <th className="py-3 px-4">Thời gian</th>
                <th className="py-3 px-4">Bàn / Loại</th>
                <th className="py-3 px-4">Món đã gọi</th>
                <th className="py-3 px-4">Thanh toán</th>
                <th className="py-3 px-4 text-right">Tổng tiền</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-sm">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-14 text-center text-sm text-zinc-500">
                    {finalizedOrders.length === 0
                      ? 'Chưa có hóa đơn nào. Các đơn thanh toán tại quầy POS sẽ hiển thị tại đây.'
                      : 'Không có hóa đơn nào phù hợp với bộ lọc hiện tại.'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((ord) => {
                  const totalQty = ord.items.reduce((s, i) => s + i.qty, 0);
                  return (
                    <tr key={ord.id} className="hover:bg-zinc-50/80 transition-colors">
                      <td className="py-3 px-4 tabular-nums text-xs font-semibold text-zinc-950">
                        {ord.orderNumber}
                      </td>
                      <td className="py-3 px-4 tabular-nums text-xs text-zinc-600 whitespace-nowrap">
                        {ord.displayTime || formatDateVN(ord.dateKey)}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-800 whitespace-nowrap">
                        <span className="font-semibold text-zinc-900">{ord.tableName}</span>
                        {ord.customerName && (
                          <span className="text-zinc-500"> · {ord.customerName}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 max-w-[240px] truncate">
                        {totalQty} món · {ord.items.map((i) => `${i.name} (×${i.qty})`).join(', ')}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap">
                        {getPaymentMethodLabel(ord.paymentMethod)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-bold text-zinc-950 whitespace-nowrap">
                        {formatVND(ord.total)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {renderStatusText(ord.status)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedOrder(ord)}
                            className="p-1.5 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="Xem chi tiết"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onPrintReceipt(ord, false)}
                            className="p-1.5 text-zinc-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="In lại hóa đơn (A5 / 80mm)"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          {ord.status !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidTarget(ord);
                                setCancelReason('');
                              }}
                              className="p-1.5 text-zinc-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Hủy hóa đơn"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-950 tabular-nums">
                  Chi tiết hóa đơn {selectedOrder.orderNumber}
                </h3>
                <div className="text-xs text-zinc-500 mt-0.5 tabular-nums">
                  {selectedOrder.displayTime} · {selectedOrder.tableName} · Thu ngân:{' '}
                  {selectedOrder.cashierName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto pos-scroll space-y-4">
              {selectedOrder.status === 'cancelled' && selectedOrder.cancelReason && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <strong>Hóa đơn đã hủy:</strong> {selectedOrder.cancelReason}
                </div>
              )}

              <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
                {selectedOrder.items.map((item, idx) => {
                  const unitPrice = getItemUnitPrice(item);
                  const itemDiscount = getItemDiscountAmount(item);
                  const netTotal = getItemNetTotal(item);
                  return (
                    <div
                      key={`${item.itemId}_${idx}`}
                      className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs bg-white"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-900">{item.name}</div>
                        {item.toppings && item.toppings.length > 0 && (
                          <div className="text-[11px] text-emerald-700 mt-0.5">
                            {item.toppings
                              .map((t) =>
                                t.price <= 0 ? `+ ${t.name}` : `+ ${t.name} (${formatVND(t.price)})`,
                              )
                              .join(', ')}
                          </div>
                        )}
                        <div className="text-zinc-500 tabular-nums mt-0.5">
                          {formatVND(unitPrice)} × {item.qty}
                          {itemDiscount > 0 && (
                            <span className="text-amber-700 font-semibold ml-1.5">
                              · CK -
                              {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                                ? `${item.discountValue}% (${formatVND(itemDiscount)})`
                                : formatVND(itemDiscount)}
                            </span>
                          )}
                          {item.note && <span className="ml-1.5 font-sans">· {item.note}</span>}
                        </div>
                      </div>
                      <div className="tabular-nums font-bold text-zinc-950 shrink-0">
                        {formatVND(netTotal)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1.5 text-xs pt-2 border-t border-zinc-200">
                <div className="flex justify-between text-zinc-600">
                  <span>Tạm tính</span>
                  <span className="tabular-nums">{formatVND(selectedOrder.subtotal)}</span>
                </div>
                {selectedOrder.discountAmount > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Chiết khấu</span>
                    <span className="tabular-nums">-{formatVND(selectedOrder.discountAmount)}</span>
                  </div>
                )}
                {selectedOrder.vatRate > 0 && (
                  <div className="flex justify-between text-zinc-600">
                    <span>VAT ({selectedOrder.vatRate}%)</span>
                    <span className="tabular-nums">{formatVND(selectedOrder.vatAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-zinc-950 pt-2 border-t border-zinc-200">
                  <span>Tổng cộng</span>
                  <span className="tabular-nums text-emerald-700">
                    {formatVND(selectedOrder.total)}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-600 pt-1">
                  <span>Hình thức thanh toán</span>
                  <span className="font-semibold text-zinc-900">
                    {getPaymentMethodLabel(selectedOrder.paymentMethod)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-zinc-200 bg-zinc-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-lg"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = selectedOrder;
                  setSelectedOrder(null);
                  onPrintReceipt(target, false);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                <Printer className="w-3.5 h-3.5" />
                In lại bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Order Confirmation Modal */}
      {voidTarget && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmVoid}
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-950">
                Xác nhận hủy hóa đơn <span className="tabular-nums">{voidTarget.orderNumber}</span>
              </h3>
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-zinc-600 leading-relaxed">
                Hóa đơn đã hủy sẽ bị khóa vĩnh viễn và không tính vào doanh thu báo cáo ngày/tháng.
              </p>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Lý do hủy <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={cancelReason}
                  onChange={(e) =>
                    setCancelReason(e.target.value.slice(0, LIMITS.CANCEL_REASON_MAX))
                  }
                  placeholder="VD: Khách đổi món, nhập nhầm số lượng..."
                  className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-rose-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-zinc-200 bg-zinc-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-lg"
              >
                Quay lại
              </button>
              <button
                type="submit"
                disabled={voiding}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg"
              >
                {voiding ? 'Đang hủy...' : 'Xác nhận hủy bill'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
