import { useMemo, useState } from 'react';
import { Plus, Users, ArrowRight, Trash2, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import { formatVND, generateDocId } from '../lib/format';
import {
  clampNumber,
  DiningTable,
  LIMITS,
  Order,
  sanitizeText,
  TABLE_ZONES,
  TableZone,
} from '../types/pos';

interface TablesViewProps {
  ownerId: string;
  tables: DiningTable[];
  orders: Order[];
  onOpenTableInPos: (tableId: string) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export function TablesView({
  ownerId,
  tables,
  orders,
  onOpenTableInPos,
  onNotify,
}: TablesViewProps) {
  const [zoneFilter, setZoneFilter] = useState<'Tất cả' | TableZone>('Tất cả');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newZone, setNewZone] = useState<TableZone>('Trong nhà');
  const [newSeats, setNewSeats] = useState(4);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openOrderMap = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach((ord) => {
      if (ord.status === 'open' && ord.tableId) {
        map.set(ord.tableId, ord);
      }
    });
    return map;
  }, [orders]);

  const filteredTables = useMemo(() => {
    return tables
      .filter((t) => zoneFilter === 'Tất cả' || t.zone === zoneFilter)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  }, [tables, zoneFilter]);

  const stats = useMemo(() => {
    const occupied = tables.filter((t) => t.status === 'occupied' || openOrderMap.has(t.id));
    const provisionalRevenue = Array.from(openOrderMap.values()).reduce(
      (sum, o) => sum + o.total,
      0,
    );
    return {
      total: tables.length,
      occupied: occupied.length,
      available: Math.max(0, tables.length - occupied.length),
      provisionalRevenue,
    };
  }, [tables, openOrderMap]);

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeText(newName, LIMITS.TABLE_NAME_MAX);
    if (!cleanName) {
      onNotify('Vui lòng nhập tên bàn.', 'error');
      return;
    }

    setSaving(true);
    const id = generateDocId('tbl');
    try {
      await setDoc(doc(db, 'diningTables', id), {
        ownerId,
        name: cleanName,
        zone: newZone,
        seats: clampNumber(newSeats, 1, 30),
        status: 'available',
        activeOrderId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewName('');
      setNewSeats(4);
      setShowAddModal(false);
      onNotify(`Đã thêm ${cleanName} (${newZone}).`);
    } catch (error) {
      reportFirestoreError(error, OperationType.CREATE, `diningTables/${id}`);
      onNotify('Không thể thêm bàn mới. Vui lòng thử lại.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTable = async (tbl: DiningTable) => {
    if (tbl.status === 'occupied' || openOrderMap.has(tbl.id)) {
      onNotify('Không thể xóa bàn đang có khách phục vụ.', 'error');
      return;
    }
    try {
      await deleteDoc(doc(db, 'diningTables', tbl.id));
      setConfirmDeleteId(null);
      onNotify(`Đã xóa ${tbl.name}.`);
    } catch (error) {
      reportFirestoreError(error, OperationType.DELETE, `diningTables/${tbl.id}`);
      onNotify('Không thể xóa bàn. Vui lòng thử lại.', 'error');
    }
  };

  return (
    <div className="p-5 sm:p-6 max-w-[1440px] mx-auto space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-500">Tổng số bàn</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-zinc-950">
            {stats.total}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-500">Đang treo bill</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-amber-600">
            {stats.occupied}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-500">Bàn trống</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-700">
            {stats.available}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-500">Tạm tính chưa thu</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-700">
            {formatVND(stats.provisionalRevenue)}
          </div>
        </div>
      </div>

      {/* Zone Tabs & Add Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-zinc-200/75 rounded-xl overflow-x-auto">
          {(['Tất cả', ...TABLE_ZONES] as const).map((zone) => (
            <button
              key={zone}
              type="button"
              onClick={() => setZoneFilter(zone)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                zoneFilter === zone
                  ? 'bg-white text-zinc-950 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {zone}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Thêm bàn mới
        </button>
      </div>

      {/* Floor Grid */}
      {filteredTables.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center space-y-2">
          <p className="text-sm font-semibold text-zinc-800">Chưa có bàn nào trong khu vực này</p>
          <p className="text-xs text-zinc-500">Nhấn "Thêm bàn mới" để bố trí sơ đồ quán.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTables.map((tbl) => {
            const openOrd = openOrderMap.get(tbl.id);
            const isOccupied = tbl.status === 'occupied' || Boolean(openOrd);

            return (
              <div
                key={tbl.id}
                className={`rounded-xl p-4 flex flex-col justify-between gap-4 transition-colors ${
                  isOccupied
                    ? 'bg-amber-50/80 border border-amber-300 shadow-xs'
                    : 'bg-white border border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3
                        className={`text-base font-bold ${
                          isOccupied ? 'text-amber-950' : 'text-zinc-950'
                        }`}
                      >
                        {tbl.name}
                      </h3>
                      <div
                        className={`mt-0.5 flex items-center gap-1.5 text-xs ${
                          isOccupied ? 'text-amber-900/75' : 'text-zinc-500'
                        }`}
                      >
                        <span>{tbl.zone}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Users className="w-3 h-3" />
                          {tbl.seats} chỗ
                        </span>
                      </div>
                    </div>

                    <span
                      className={`text-xs font-semibold whitespace-nowrap ${
                        isOccupied ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {isOccupied ? 'Đang treo bill' : 'Trống'}
                    </span>
                  </div>

                  {openOrd ? (
                    <div className="pt-2.5 border-t border-amber-200/80 space-y-1 text-xs">
                      <div className="flex justify-between text-amber-900/80">
                        <span>Mã đơn</span>
                        <span className="tabular-nums font-semibold text-amber-950">
                          {openOrd.orderNumber}
                        </span>
                      </div>
                      {openOrd.customerName && (
                        <div className="flex justify-between text-amber-900/80">
                          <span>Khách hàng</span>
                          <span className="font-semibold text-amber-950 truncate max-w-[140px]">
                            {openOrd.customerName}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between text-amber-900/80">
                        <span>Số món</span>
                        <span className="tabular-nums font-semibold text-amber-950">
                          {openOrd.items.reduce((s, i) => s + i.qty, 0)} món
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline pt-1">
                        <span className="text-amber-900/80">Tạm tính</span>
                        <span className="tabular-nums text-base font-bold text-amber-700">
                          {formatVND(openOrd.total)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2.5 border-t border-zinc-100 text-xs text-zinc-400">
                      Sẵn sàng đón khách mới
                    </div>
                  )}
                </div>

                <div
                  className={`flex items-center justify-between gap-2 pt-2.5 border-t ${
                    isOccupied ? 'border-amber-200/80' : 'border-zinc-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenTableInPos(tbl.id)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      isOccupied
                        ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                        : 'bg-zinc-900 text-white hover:bg-zinc-800'
                    }`}
                  >
                    {isOccupied ? 'Xem bill / Tính tiền' : 'Mở bàn gọi món'}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  {!isOccupied &&
                    (confirmDeleteId === tbl.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteTable(tbl)}
                          className="px-2.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg whitespace-nowrap"
                        >
                          Xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(tbl.id)}
                        className="p-2 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Xóa bàn"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Table Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleCreateTable}
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-950">Thêm bàn mới</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Tên bàn <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value.slice(0, LIMITS.TABLE_NAME_MAX))}
                  placeholder="VD: Bàn 11 hoặc VIP 01"
                  className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Khu vực</label>
                  <select
                    value={newZone}
                    onChange={(e) => setNewZone(e.target.value as TableZone)}
                    className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
                  >
                    {TABLE_ZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Số chỗ ngồi
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={newSeats}
                    onChange={(e) => setNewSeats(Number(e.target.value) || 2)}
                    className="w-full px-3 py-2 text-sm tabular-nums bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-zinc-200 bg-zinc-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg"
              >
                {saving ? 'Đang lưu...' : 'Thêm bàn'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
