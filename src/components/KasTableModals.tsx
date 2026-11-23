import { useState } from 'react';
import { X, ArrowRightLeft, Combine, Plus, AlertTriangle } from 'lucide-react';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import { calculateOrderTotals, formatVND, generateDocId, normalizeOrderItemForSave } from '../lib/format';
import {
  clampNumber,
  DiningTable,
  LIMITS,
  Order,
  sanitizeText,
  TABLE_ZONES,
  TableZone,
} from '../types/pos';

interface AddTableModalProps {
  ownerId: string;
  onClose: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export function KasAddTableModal({ ownerId, onClose, onNotify }: AddTableModalProps) {
  const [name, setName] = useState('');
  const [zone, setZone] = useState<TableZone>('Trong nhà');
  const [seats, setSeats] = useState(4);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeText(name, LIMITS.TABLE_NAME_MAX);
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
        zone,
        seats: clampNumber(seats, 1, 30),
        status: 'available',
        activeOrderId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch (error) {
      const msg = reportFirestoreError(error, OperationType.CREATE, `diningTables/${id}`);
      onNotify(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Thêm bàn mới"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border-2 border-[#0a2463] rounded-lg w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="bg-[#091d4f] text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Plus className="w-4 h-4 text-amber-300" />
            Thêm bàn mới
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Tên bàn <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, LIMITS.TABLE_NAME_MAX))}
              placeholder="VD: Bàn 11, VIP 01..."
              className="w-full h-10 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-cyan-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Khu vực</label>
              <select
                value={zone}
                onChange={(e) => setZone(e.target.value as TableZone)}
                className="w-full h-10 px-3 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-cyan-600"
              >
                {TABLE_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Số chỗ ngồi</label>
              <input
                type="number"
                min={1}
                max={30}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value) || 2)}
                className="w-full h-10 px-3 text-sm tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-cyan-600"
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md"
          >
            Đóng
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-md"
          >
            {saving ? 'Đang lưu...' : 'Thêm bàn'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface TransferMergeModalProps {
  mode: 'move' | 'merge';
  sourceTable: DiningTable;
  sourceOrder: Order;
  tables: DiningTable[];
  openOrdersByTable: Map<string, Order>;
  onSuccess: (targetTableId: string) => void;
  onClose: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export function KasTransferMergeModal({
  mode,
  sourceTable,
  sourceOrder,
  tables,
  openOrdersByTable,
  onSuccess,
  onClose,
  onNotify,
}: TransferMergeModalProps) {
  const [targetTableId, setTargetTableId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const candidates = tables.filter((tbl) => {
    if (tbl.id === sourceTable.id) return false;
    const hasOpen = tbl.status === 'occupied' || openOrdersByTable.has(tbl.id);
    return mode === 'move' ? !hasOpen : hasOpen && openOrdersByTable.has(tbl.id);
  });

  const handleConfirm = async () => {
    const targetTable = candidates.find((t) => t.id === targetTableId);
    if (!targetTable) {
      onNotify(
        mode === 'move' ? 'Vui lòng chọn bàn trống đích.' : 'Vui lòng chọn bàn đang có bill để gộp.',
        'error',
      );
      return;
    }

    if (submitting) return;
    setSubmitting(true);
    const batch = writeBatch(db);

    let targetPath = `orders/${sourceOrder.id} + diningTables/${sourceTable.id}`;
    try {
      if (mode === 'move') {
        targetPath = `orders/${sourceOrder.id} + diningTables/${sourceTable.id},${targetTable.id}`;
        batch.update(doc(db, 'orders', sourceOrder.id), {
          tableId: targetTable.id,
          tableName: sanitizeText(targetTable.name, LIMITS.TABLE_NAME_MAX) || 'Bàn',
          orderType: 'dine_in',
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'diningTables', sourceTable.id), {
          status: 'available',
          activeOrderId: '',
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'diningTables', targetTable.id), {
          status: 'occupied',
          activeOrderId: sourceOrder.id,
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        onSuccess(targetTable.id);
      } else {
        const targetOrder = openOrdersByTable.get(targetTable.id);
        if (!targetOrder) {
          onNotify('Không tìm thấy bill đang mở ở bàn đích.', 'error');
          setSubmitting(false);
          return;
        }

        targetPath = `orders/${targetOrder.id},${sourceOrder.id} + diningTables/${sourceTable.id}`;
        const mergedItems = [...targetOrder.items, ...sourceOrder.items]
          .slice(0, LIMITS.MAX_ORDER_ITEMS)
          .map(normalizeOrderItemForSave);

        const safeDiscountType = targetOrder.discountType === 'fixed' ? 'fixed' : 'percent';
        const safeDiscountValue = clampNumber(
          targetOrder.discountValue ?? 0,
          0,
          safeDiscountType === 'percent' ? 100 : 1_000_000_000,
        );
        const safeVatRate = clampNumber(targetOrder.vatRate ?? 0, 0, 30);

        const totals = calculateOrderTotals(
          mergedItems,
          safeDiscountType,
          safeDiscountValue,
          safeVatRate,
        );

        const combinedNote = [targetOrder.note, sourceOrder.note]
          .map((s) => (s || '').trim())
          .filter(Boolean)
          .join(' | ')
          .slice(0, LIMITS.ORDER_NOTE_MAX);

        const mergeCancelReason =
          sanitizeText(
            `Đã gộp sang ${targetTable.name} (${targetOrder.orderNumber})`,
            LIMITS.CANCEL_REASON_MAX,
          ) || 'Đã gộp bàn';

        batch.update(doc(db, 'orders', targetOrder.id), {
          items: mergedItems,
          subtotal: totals.subtotal,
          costTotal: totals.costTotal,
          discountType: safeDiscountType,
          discountValue: safeDiscountValue,
          discountAmount: totals.discountAmount,
          vatRate: safeVatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          note: combinedNote,
          updatedAt: serverTimestamp(),
        });

        batch.update(doc(db, 'orders', sourceOrder.id), {
          status: 'cancelled',
          cancelReason: mergeCancelReason,
          updatedAt: serverTimestamp(),
        });

        batch.update(doc(db, 'diningTables', sourceTable.id), {
          status: 'available',
          activeOrderId: '',
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        onSuccess(targetTable.id);
      }
    } catch (error) {
      const msg = reportFirestoreError(error, OperationType.WRITE, targetPath);
      onNotify(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'move' ? 'Chuyển bàn' : 'Gộp bàn'}
    >
      <div className="bg-white border-2 border-[#0a2463] rounded-lg w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="bg-[#091d4f] text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm">
            {mode === 'move' ? (
              <ArrowRightLeft className="w-4 h-4 text-cyan-300" />
            ) : (
              <Combine className="w-4 h-4 text-amber-300" />
            )}
            {mode === 'move'
              ? `Chuyển bàn từ ${sourceTable.name}`
              : `Gộp bill ${sourceTable.name} sang bàn khác`}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3 rounded-md bg-orange-50 border border-orange-200 text-xs text-orange-950 flex items-center justify-between">
            <span>
              Đơn nguồn: <strong>{sourceTable.name}</strong> ({sourceOrder.orderNumber})
            </span>
            <strong className="tabular-nums text-orange-700">{formatVND(sourceOrder.total)}</strong>
          </div>

          {candidates.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {mode === 'move'
                ? 'Hiện không còn bàn trống nào để chuyển sang.'
                : 'Cần ít nhất 1 bàn khác cũng đang treo bill để thực hiện gộp bàn.'}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700">
                {mode === 'move' ? 'Chọn bàn trống cần chuyển đến:' : 'Chọn bàn đang có bill để gộp vào:'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto pos-scroll pr-1">
                {candidates.map((tbl) => {
                  const targetOrd = openOrdersByTable.get(tbl.id);
                  const selected = targetTableId === tbl.id;
                  return (
                    <button
                      key={tbl.id}
                      type="button"
                      onClick={() => setTargetTableId(tbl.id)}
                      className={`p-3 rounded-md border text-left transition-all ${
                        selected
                          ? 'bg-cyan-600 text-white border-cyan-700 shadow-xs'
                          : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-cyan-500'
                      }`}
                    >
                      <div className="text-sm font-bold">{tbl.name}</div>
                      <div
                        className={`text-xs mt-0.5 tabular-nums ${
                          selected ? 'text-cyan-100' : 'text-slate-500'
                        }`}
                      >
                        {targetOrd ? formatVND(targetOrd.total) : tbl.zone}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            disabled={!targetTableId || submitting}
            onClick={handleConfirm}
            className="px-4 py-2 text-xs font-bold text-white bg-[#0a2268] hover:bg-[#0f308c] disabled:opacity-45 rounded-md"
          >
            {submitting
              ? 'Đang xử lý...'
              : mode === 'move'
                ? 'Xác nhận chuyển bàn'
                : 'Xác nhận gộp bàn'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CancelBillModalProps {
  tableName: string;
  orderNumber: string;
  total: number;
  submitting: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export function KasCancelBillModal({
  tableName,
  orderNumber,
  total,
  submitting,
  onConfirm,
  onClose,
}: CancelBillModalProps) {
  const [reason, setReason] = useState('Khách hủy đơn');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeText(reason, LIMITS.CANCEL_REASON_MAX);
    if (!clean) return;
    onConfirm(clean);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Xác nhận hủy bill"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border-2 border-red-600 rounded-lg w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="bg-red-600 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="w-4 h-4" />
            Xác nhận hủy bill
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-red-100 hover:text-white rounded"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-slate-700">
            Hủy hóa đơn <strong>{orderNumber}</strong> tại <strong>{tableName}</strong> (tạm tính{' '}
            <strong className="tabular-nums text-red-600">{formatVND(total)}</strong>) và trả bàn về
            trạng thái trống?
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Lý do hủy <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, LIMITS.CANCEL_REASON_MAX))}
              className="w-full h-10 px-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-red-500"
            />
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md"
          >
            Quay lại
          </button>
          <button
            type="submit"
            disabled={submitting || !reason.trim()}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-45 rounded-md"
          >
            {submitting ? 'Đang hủy...' : 'Xác nhận hủy bill'}
          </button>
        </div>
      </form>
    </div>
  );
}
