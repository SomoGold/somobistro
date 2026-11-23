import { useMemo, useState } from 'react';
import {
  UserPlus,
  Search,
  Pencil,
  Trash2,
  X,
  Phone,
  Percent,
  ReceiptText,
  Printer,
  Coffee,
  Users,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import {
  formatDotNumber,
  formatVND,
  generateDocId,
  getItemNetTotal,
  getPaymentMethodLabel,
  parseDotNumber,
} from '../lib/format';
import {
  clampNumber,
  Customer,
  DiscountType,
  LIMITS,
  Order,
  sanitizeText,
} from '../types/pos';

interface CustomersViewProps {
  ownerId: string;
  customers: Customer[];
  orders: Order[];
  onPrintReceipt: (order: Order, isProvisional: boolean) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

interface CustomerFormState {
  id: string | null;
  name: string;
  phone: string;
  defaultDiscountType: DiscountType;
  defaultDiscountValue: string;
  note: string;
}

const EMPTY_FORM: CustomerFormState = {
  id: null,
  name: '',
  phone: '',
  defaultDiscountType: 'percent',
  defaultDiscountValue: '',
  note: '',
};

function formatDiscountBadge(type: DiscountType, value: number): string {
  if (!value || value <= 0) return 'Không';
  return type === 'percent' ? `${value}%` : formatVND(value);
}

export function CustomersView({
  ownerId,
  customers,
  orders,
  onPrintReceipt,
  onNotify,
}: CustomersViewProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const completedOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'completed' && !o.id.startsWith('seedord'))
        .sort((a, b) => {
          const cmpDate = b.dateKey.localeCompare(a.dateKey);
          if (cmpDate !== 0) return cmpDate;
          return b.displayTime.localeCompare(a.displayTime);
        }),
    [orders],
  );

  // Compute live purchase metrics per saved customer
  const customerStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        orders: Order[];
        totalSpent: number;
        totalDiscount: number;
        lastOrderTime: string;
        topItems: { name: string; qty: number; revenue: number }[];
      }
    >();

    customers.forEach((cust) => {
      const normalizedName = cust.name.trim().toLowerCase();
      const matched = completedOrders.filter((ord) => {
        if (ord.customerId && ord.customerId === cust.id) return true;
        if (!ord.customerId && ord.customerName && ord.customerName.trim().toLowerCase() === normalizedName) {
          return true;
        }
        return false;
      });

      const totalSpent = matched.reduce((s, o) => s + o.total, 0);
      const totalDiscount = matched.reduce((s, o) => s + o.discountAmount, 0);
      const lastOrderTime = matched[0]?.displayTime || 'Chưa có đơn';

      const itemAgg = new Map<string, { name: string; qty: number; revenue: number }>();
      matched.forEach((ord) => {
        ord.items.forEach((it) => {
          const cur = itemAgg.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
          cur.qty += it.qty;
          cur.revenue += getItemNetTotal(it);
          itemAgg.set(it.name, cur);
        });
      });

      const topItems = Array.from(itemAgg.values())
        .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
        .slice(0, 6);

      map.set(cust.id, {
        orders: matched,
        totalSpent,
        totalDiscount,
        lastOrderTime,
        topItems,
      });
    });

    return map;
  }, [customers, completedOrders]);

  // Unsaved named customers discovered from historical orders
  const unsavedNamedCustomers = useMemo(() => {
    const savedNames = new Set(customers.map((c) => c.name.trim().toLowerCase()));
    const map = new Map<string, { name: string; orderCount: number; totalSpent: number }>();
    completedOrders.forEach((ord) => {
      if (ord.customerId) return;
      const raw = (ord.customerName || '').trim();
      if (!raw || raw.toLowerCase() === 'khách lẻ') return;
      const key = raw.toLowerCase();
      if (savedNames.has(key)) return;
      const cur = map.get(key) || { name: raw, orderCount: 0, totalSpent: 0 };
      cur.orderCount += 1;
      cur.totalSpent += ord.total;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [customers, completedOrders]);

  const filteredCustomers = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (!kw) return true;
        return (
          c.name.toLowerCase().includes(kw) ||
          c.phone.toLowerCase().includes(kw) ||
          c.note.toLowerCase().includes(kw)
        );
      })
      .sort((a, b) => {
        const spentA = customerStatsMap.get(a.id)?.totalSpent ?? 0;
        const spentB = customerStatsMap.get(b.id)?.totalSpent ?? 0;
        if (spentB !== spentA) return spentB - spentA;
        return a.name.localeCompare(b.name, 'vi');
      });
  }, [customers, search, customerStatsMap]);

  const selectedCustomer = useMemo(() => {
    if (selectedId) {
      const found = customers.find((c) => c.id === selectedId);
      if (found) return found;
    }
    return filteredCustomers[0] ?? null;
  }, [customers, filteredCustomers, selectedId]);

  const selectedStats = selectedCustomer ? customerStatsMap.get(selectedCustomer.id) : null;

  const overallSummary = useMemo(() => {
    let totalSpent = 0;
    let totalOrders = 0;
    let withDiscount = 0;
    customers.forEach((c) => {
      if (c.defaultDiscountValue > 0) withDiscount += 1;
      const st = customerStatsMap.get(c.id);
      if (st) {
        totalSpent += st.totalSpent;
        totalOrders += st.orders.length;
      }
    });
    return {
      totalCustomers: customers.length,
      withDiscount,
      totalSpent,
      totalOrders,
    };
  }, [customers, customerStatsMap]);

  const openCreateModal = (prefillName = '') => {
    setForm({ ...EMPTY_FORM, name: prefillName });
    setModalOpen(true);
  };

  const openEditModal = (cust: Customer) => {
    setForm({
      id: cust.id,
      name: cust.name,
      phone: cust.phone,
      defaultDiscountType: cust.defaultDiscountType,
      defaultDiscountValue:
        cust.defaultDiscountValue > 0
          ? cust.defaultDiscountType === 'fixed'
            ? formatDotNumber(cust.defaultDiscountValue)
            : String(cust.defaultDiscountValue)
          : '',
      note: cust.note,
    });
    setModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeText(form.name, LIMITS.CUSTOMER_NAME_MAX);
    if (!cleanName) {
      onNotify('Vui lòng nhập tên khách hàng.', 'error');
      return;
    }

    const cleanPhone = sanitizeText(form.phone, LIMITS.PHONE_MAX);
    const cleanNote = sanitizeText(form.note, LIMITS.ORDER_NOTE_MAX);
    const parsedDiscount = parseDotNumber(form.defaultDiscountValue);
    const maxDisc = form.defaultDiscountType === 'percent' ? 100 : LIMITS.MAX_PRICE;
    const safeDiscountValue = clampNumber(parsedDiscount, 0, maxDisc);

    setSaving(true);
    const nowTs = serverTimestamp();

    try {
      if (form.id) {
        await updateDoc(doc(db, 'customers', form.id), {
          name: cleanName,
          phone: cleanPhone,
          defaultDiscountType: form.defaultDiscountType,
          defaultDiscountValue: safeDiscountValue,
          note: cleanNote,
          updatedAt: nowTs,
        });
        onNotify(`Đã cập nhật thông tin khách hàng "${cleanName}".`);
        setSelectedId(form.id);
      } else {
        const newId = generateDocId('cus');
        await setDoc(doc(db, 'customers', newId), {
          ownerId,
          name: cleanName,
          phone: cleanPhone,
          defaultDiscountType: form.defaultDiscountType,
          defaultDiscountValue: safeDiscountValue,
          note: cleanNote,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
        onNotify(`Đã thêm khách hàng "${cleanName}".`);
        setSelectedId(newId);
      }
      setModalOpen(false);
    } catch (error) {
      const msg = reportFirestoreError(
        error,
        form.id ? OperationType.UPDATE : OperationType.CREATE,
        form.id ? `customers/${form.id}` : 'customers/new',
      );
      onNotify(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomer = async (cust: Customer) => {
    try {
      await deleteDoc(doc(db, 'customers', cust.id));
      if (selectedId === cust.id) setSelectedId(null);
      setConfirmDeleteId(null);
      onNotify(`Đã xóa khách hàng "${cust.name}".`);
    } catch (error) {
      const msg = reportFirestoreError(error, OperationType.DELETE, `customers/${cust.id}`);
      onNotify(msg, 'error');
    }
  };

  return (
    <div className="p-5 sm:p-6 max-w-[1440px] mx-auto space-y-5">
      {/* Top KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Khách hàng đã lưu</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900 mt-1">
            {overallSummary.totalCustomers}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Có chiết khấu mặc định</div>
          <div className="text-2xl font-bold tabular-nums text-amber-700 mt-1">
            {overallSummary.withDiscount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Tổng chi tiêu khách quen</div>
          <div className="text-2xl font-bold tabular-nums text-cyan-700 mt-1">
            {formatVND(overallSummary.totalSpent)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Tổng lượt mua</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900 mt-1">
            {overallSummary.totalOrders}
          </div>
        </div>
      </div>

      {/* Main 2-Column Split: Customer Directory (Left) + Purchase History & Details (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Directory */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên, số điện thoại..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-cyan-600"
              />
            </div>
            <button
              type="button"
              onClick={() => openCreateModal('')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              Thêm khách hàng
            </button>
          </div>

          {filteredCustomers.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-600">
                {customers.length === 0
                  ? 'Chưa có khách hàng nào được lưu'
                  : 'Không tìm thấy khách hàng phù hợp'}
              </div>
              <p className="text-xs text-slate-400">
                Lưu thông tin khách quen để theo dõi lịch sử mua hàng và tự động áp dụng chiết khấu mặc định khi thanh toán.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto pos-scroll">
              {filteredCustomers.map((cust) => {
                const stats = customerStatsMap.get(cust.id);
                const isSelected = selectedCustomer?.id === cust.id;
                return (
                  <div
                    key={cust.id}
                    onClick={() => setSelectedId(cust.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedId(cust.id);
                    }}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-cyan-50/80 border-l-4 border-l-cyan-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">{cust.name}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-500">
                          {cust.phone && (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Phone className="w-3 h-3" />
                              {cust.phone}
                            </span>
                          )}
                          {cust.defaultDiscountValue > 0 && (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700 tabular-nums">
                              <Percent className="w-3 h-3" />
                              CK mặc định: {formatDiscountBadge(cust.defaultDiscountType, cust.defaultDiscountValue)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold tabular-nums text-cyan-700">
                          {formatVND(stats?.totalSpent ?? 0)}
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {stats?.orders.length ?? 0} hóa đơn
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Walk-in Named Customers from Past Orders */}
          {unsavedNamedCustomers.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50/80 p-4 space-y-2.5">
              <div className="text-xs font-bold text-slate-700">
                Khách đã nhập tên trên hóa đơn ({unsavedNamedCustomers.length})
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pos-scroll">
                {unsavedNamedCustomers.map((walkIn) => (
                  <div
                    key={walkIn.name}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{walkIn.name}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {walkIn.orderCount} đơn · {formatVND(walkIn.totalSpent)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openCreateModal(walkIn.name)}
                      className="px-2.5 py-1 text-[11px] font-bold text-cyan-700 bg-cyan-50 hover:bg-cyan-100 rounded-md whitespace-nowrap"
                    >
                      + Lưu khách quen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Detail & Purchase History Panel */}
        <div className="lg:col-span-7 space-y-4">
          {!selectedCustomer ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
              Chọn một khách hàng ở danh sách bên trái để xem chi tiết chiết khấu và lịch sử mua hàng.
            </div>
          ) : (
            <>
              {/* Profile Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold text-slate-900">{selectedCustomer.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>
                        SĐT:{' '}
                        <strong className="tabular-nums text-slate-800">
                          {selectedCustomer.phone || 'Chưa cập nhật'}
                        </strong>
                      </span>
                      <span>
                        Chiết khấu mặc định:{' '}
                        <strong className="tabular-nums text-amber-700">
                          {formatDiscountBadge(
                            selectedCustomer.defaultDiscountType,
                            selectedCustomer.defaultDiscountValue,
                          )}
                        </strong>
                      </span>
                      <span>
                        Mua gần nhất:{' '}
                        <strong className="tabular-nums text-slate-800">
                          {selectedStats?.lastOrderTime || 'Chưa có đơn'}
                        </strong>
                      </span>
                    </div>
                    {selectedCustomer.note && (
                      <p className="text-xs text-slate-500 pt-1">
                        Ghi chú: <span className="text-slate-700">{selectedCustomer.note}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(selectedCustomer)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Chỉnh sửa
                    </button>
                    {confirmDeleteId === selectedCustomer.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomer(selectedCustomer)}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg"
                        >
                          Xác nhận xóa
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(selectedCustomer.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Xóa khách hàng"
                        aria-label="Xóa khách hàng"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                  <div className="p-3 rounded-lg bg-cyan-50/60 border border-cyan-100">
                    <div className="text-[11px] text-slate-600">Tổng tiền đã mua</div>
                    <div className="text-base font-extrabold tabular-nums text-cyan-800 mt-0.5">
                      {formatVND(selectedStats?.totalSpent ?? 0)}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                    <div className="text-[11px] text-slate-600">Số hóa đơn</div>
                    <div className="text-base font-extrabold tabular-nums text-slate-900 mt-0.5">
                      {selectedStats?.orders.length ?? 0}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
                    <div className="text-[11px] text-slate-600">Trung bình / đơn</div>
                    <div className="text-base font-extrabold tabular-nums text-slate-900 mt-0.5">
                      {formatVND(
                        selectedStats && selectedStats.orders.length > 0
                          ? Math.round(selectedStats.totalSpent / selectedStats.orders.length)
                          : 0,
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Favorite Items */}
              {selectedStats && selectedStats.topItems.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Coffee className="w-4 h-4 text-cyan-600" />
                    Món khách hay gọi nhất
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {selectedStats.topItems.map((it) => (
                      <div
                        key={it.name}
                        className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold text-slate-800 truncate">{it.name}</span>
                        <span className="tabular-nums text-slate-600 whitespace-nowrap">
                          <strong className="text-cyan-700">{it.qty}</strong> lần ·{' '}
                          {formatVND(it.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Order History Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <ReceiptText className="w-4 h-4 text-cyan-600" />
                    Lịch sử mua hàng ({selectedStats?.orders.length ?? 0} đơn)
                  </div>
                </div>

                {!selectedStats || selectedStats.orders.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Khách hàng này chưa có hóa đơn thanh toán nào.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto pos-scroll">
                    {selectedStats.orders.map((ord) => (
                      <div key={ord.id} className="p-4 hover:bg-slate-50/70 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                            <span className="font-bold text-[#0a2268] tabular-nums">
                              {ord.orderNumber}
                            </span>
                            <span className="text-slate-500 tabular-nums">{ord.displayTime}</span>
                            <span className="text-slate-600">{ord.tableName}</span>
                            <span className="text-slate-500">
                              {getPaymentMethodLabel(ord.paymentMethod)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-extrabold tabular-nums text-cyan-700">
                              {formatVND(ord.total)}
                            </span>
                            <button
                              type="button"
                              onClick={() => onPrintReceipt(ord, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md"
                            >
                              <Printer className="w-3 h-3" />
                              In bill
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-slate-600 leading-relaxed">
                          {ord.items
                            .map((it) => {
                              const topStr =
                                it.toppings && it.toppings.length > 0
                                  ? ` (+${it.toppings.map((t) => t.name).join(', ')})`
                                  : '';
                              return `${it.qty}× ${it.name}${topStr}`;
                            })
                            .join(' · ')}
                        </div>

                        {ord.discountAmount > 0 && (
                          <div className="text-[11px] font-medium text-amber-700 tabular-nums">
                            Đã giảm đơn: -{formatVND(ord.discountAmount)}
                            {ord.discountType === 'percent' ? ` (${ord.discountValue}%)` : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add / Edit Customer Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={form.id ? 'Chỉnh sửa khách hàng' : 'Thêm khách hàng mới'}
        >
          <form
            onSubmit={handleSaveCustomer}
            className="bg-white border-2 border-[#0a2268] rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="bg-[#091d4f] text-white px-5 py-3.5 flex items-center justify-between">
              <div className="font-bold text-sm">
                {form.id ? 'Chỉnh sửa thông tin khách hàng' : 'Thêm khách hàng mới'}
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-300 hover:text-white rounded"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tên khách hàng <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      name: e.target.value.slice(0, LIMITS.CUSTOMER_NAME_MAX),
                    }))
                  }
                  placeholder="VD: Anh Minh, Chị Lan..."
                  className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Số điện thoại
                </label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      phone: e.target.value.slice(0, LIMITS.PHONE_MAX),
                    }))
                  }
                  placeholder="090x xxx xxx"
                  className="w-full h-10 px-3 text-sm tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Chiết khấu mặc định khi thanh toán
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.defaultDiscountValue}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (form.defaultDiscountType === 'fixed') {
                          setForm((prev) => ({
                            ...prev,
                            defaultDiscountValue: formatDotNumber(raw),
                          }));
                        } else {
                          const parsed = parseDotNumber(raw);
                          setForm((prev) => ({
                            ...prev,
                            defaultDiscountValue: parsed > 0 ? String(Math.min(100, parsed)) : '',
                          }));
                        }
                      }}
                      placeholder={form.defaultDiscountType === 'percent' ? '0 - 100' : 'VD: 10.000'}
                      className="w-full h-10 px-3 pr-8 text-sm font-bold tabular-nums text-right border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                      {form.defaultDiscountType === 'percent' ? '%' : '₫'}
                    </span>
                  </div>

                  <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 h-10 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          defaultDiscountType: 'percent',
                          defaultDiscountValue: '',
                        }))
                      }
                      className={`px-3 text-xs font-bold ${
                        form.defaultDiscountType === 'percent'
                          ? 'bg-[#091d4f] text-white'
                          : 'bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          defaultDiscountType: 'fixed',
                          defaultDiscountValue: '',
                        }))
                      }
                      className={`px-3 text-xs font-bold border-l border-slate-300 ${
                        form.defaultDiscountType === 'fixed'
                          ? 'bg-[#091d4f] text-white'
                          : 'bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      VNĐ
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Ghi chú sở thích / thông tin thêm
                </label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      note: e.target.value.slice(0, LIMITS.ORDER_NOTE_MAX),
                    }))
                  }
                  placeholder="VD: Uống ít đường, hay ngồi khu sân vườn..."
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-lg"
              >
                {saving ? 'Đang lưu...' : form.id ? 'Lưu thay đổi' : 'Thêm khách hàng'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
