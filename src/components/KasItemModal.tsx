import { useState } from 'react';
import { Minus, Plus, X, Percent, Check } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import {
  formatDotNumber,
  formatVND,
  generateDocId,
  getItemDiscountAmount,
  getItemGrossTotal,
  getItemNetTotal,
  getItemUnitPrice,
  parseDotNumber,
} from '../lib/format';
import {
  clampNumber,
  DiscountType,
  LIMITS,
  OrderItem,
  OrderItemTopping,
  sanitizeText,
  Topping,
} from '../types/pos';

interface KasItemModalProps {
  ownerId: string;
  item: OrderItem;
  toppings: Topping[];
  onSave: (updated: OrderItem) => void;
  onDelete: () => void;
  onClose: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

const QUICK_NOTES = [
  'Ít đá',
  'Không đá',
  'Ít đường',
  'Không đường',
  'Đá riêng',
  'Nhiều sữa',
  'Nóng',
  'Mang về',
];

export function KasItemModal({
  ownerId,
  item,
  toppings,
  onSave,
  onDelete,
  onClose,
  onNotify,
}: KasItemModalProps) {
  const [draft, setDraft] = useState<OrderItem>(() => ({
    ...item,
    toppings: item.toppings ? item.toppings.map((t) => ({ ...t })) : [],
    discountType: item.discountType ?? 'percent',
    discountValue: item.discountValue ?? 0,
    discountAmount: item.discountAmount ?? 0,
    note: item.note ?? '',
  }));

  const [showDiscountEditor, setShowDiscountEditor] = useState(
    (item.discountValue ?? 0) > 0 || (item.discountAmount ?? 0) > 0,
  );
  const [quickToppingName, setQuickToppingName] = useState('');
  const [quickToppingPrice, setQuickToppingPrice] = useState('');
  const [creatingTopping, setCreatingTopping] = useState(false);

  const availableToppings = toppings
    .filter((t) => t.available)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  const unitPrice = getItemUnitPrice(draft);
  const lineGross = getItemGrossTotal(draft);
  const lineDiscount = getItemDiscountAmount(draft);
  const lineNet = getItemNetTotal(draft);
  const discType: DiscountType = draft.discountType ?? 'percent';
  const discVal = draft.discountValue ?? 0;

  const updateQty = (delta: number) => {
    setDraft((prev) => {
      const nextQty = Math.min(999, Math.max(1, prev.qty + delta));
      const updated = { ...prev, qty: nextQty };
      updated.discountAmount = getItemDiscountAmount(updated);
      return updated;
    });
  };

  const toggleTopping = (tp: OrderItemTopping) => {
    setDraft((prev) => {
      const curr = prev.toppings ?? [];
      const exists = curr.some((t) => t.id === tp.id);
      let nextToppings: OrderItemTopping[];
      if (exists) {
        nextToppings = curr.filter((t) => t.id !== tp.id);
      } else {
        if (curr.length >= LIMITS.MAX_ITEM_TOPPINGS) {
          onNotify(`Tối đa ${LIMITS.MAX_ITEM_TOPPINGS} topping cho mỗi món.`, 'error');
          return prev;
        }
        nextToppings = [...curr, tp];
      }
      const updated = { ...prev, toppings: nextToppings };
      updated.discountAmount = getItemDiscountAmount(updated);
      return updated;
    });
  };

  const updateDiscountValue = (raw: string) => {
    setDraft((prev) => {
      const type: DiscountType = prev.discountType ?? 'percent';
      const parsed = parseDotNumber(raw);
      const maxVal = type === 'percent' ? 100 : getItemGrossTotal(prev);
      const clamped = Math.min(maxVal, Math.max(0, parsed));
      const updated: OrderItem = { ...prev, discountType: type, discountValue: clamped };
      updated.discountAmount = getItemDiscountAmount(updated);
      return updated;
    });
  };

  const toggleDiscountType = (nextType: DiscountType) => {
    setDraft((prev) => ({
      ...prev,
      discountType: nextType,
      discountValue: 0,
      discountAmount: 0,
    }));
  };

  const appendQuickNote = (preset: string) => {
    setDraft((prev) => {
      const current = prev.note.trim();
      const parts = current ? current.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const exists = parts.some((p) => p.toLowerCase() === preset.toLowerCase());
      const nextParts = exists
        ? parts.filter((p) => p.toLowerCase() !== preset.toLowerCase())
        : [...parts, preset];
      return {
        ...prev,
        note: nextParts.join(', ').slice(0, LIMITS.ITEM_NOTE_MAX),
      };
    });
  };

  const handleQuickCreateTopping = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeText(quickToppingName, LIMITS.TOPPING_NAME_MAX);
    const price = clampNumber(parseDotNumber(quickToppingPrice), 0, LIMITS.MAX_PRICE);
    if (!cleanName) {
      onNotify('Vui lòng nhập tên topping.', 'error');
      return;
    }

    setCreatingTopping(true);
    try {
      const newId = generateDocId('top');
      await setDoc(doc(db, 'toppings', newId), {
        ownerId,
        name: cleanName,
        price,
        available: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toggleTopping({ id: newId, name: cleanName, price });
      setQuickToppingName('');
      setQuickToppingPrice('');
      onNotify(`Đã tạo và thêm topping "${cleanName}".`);
    } catch (error) {
      const msg = reportFirestoreError(error, OperationType.CREATE, 'toppings/new');
      onNotify(msg, 'error');
    } finally {
      setCreatingTopping(false);
    }
  };

  const handleConfirm = () => {
    onSave({
      ...draft,
      discountAmount: getItemDiscountAmount(draft),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Tùy chỉnh món ${draft.name}`}
    >
      <div className="bg-slate-100 border-2 border-[#0a2463] rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* KAS POS Dark Navy Header */}
        <div className="bg-[#091d4f] text-white px-5 py-3 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold leading-snug truncate">{draft.name}</h3>
            <div className="mt-0.5 flex items-center gap-4 text-sm tabular-nums text-cyan-200">
              <span>
                Đơn giá: <strong className="text-white">{formatVND(unitPrice)}</strong>
              </span>
              {lineDiscount > 0 && (
                <span className="text-amber-300">
                  Giảm: <strong>-{formatVND(lineDiscount)}</strong>
                </span>
              )}
              <span>
                Thành tiền: <strong className="text-amber-300">{formatVND(lineNet)}</strong>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-md transition-colors shrink-0"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-y-auto pos-scroll space-y-4">
          {/* Quantity Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-[#0b2b6b]">Số lượng</span>
              <div className="inline-flex items-center bg-white border border-slate-300 rounded-md overflow-hidden shadow-xs">
                <button
                  type="button"
                  onClick={() => updateQty(-1)}
                  className="w-11 h-10 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors border-r border-slate-200"
                  aria-label="Giảm số lượng"
                >
                  <Minus className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="w-16 text-center text-lg font-bold tabular-nums text-red-600">
                  {draft.qty}
                </span>
                <button
                  type="button"
                  onClick={() => updateQty(1)}
                  className="w-11 h-10 flex items-center justify-center text-cyan-700 hover:bg-cyan-50 transition-colors border-l border-slate-200"
                  aria-label="Tăng số lượng"
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {lineGross !== lineNet && (
              <div className="text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-md tabular-nums">
                Giá trước giảm {formatVND(lineGross)} → Còn {formatVND(lineNet)}
              </div>
            )}
          </div>

          {/* Middle Split: Selected Toppings & Discount Box (Left) + KAS Colorful Action Stack (Right) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-stretch">
            {/* Selected Modifiers Canvas */}
            <div className="md:col-span-9 bg-white border border-slate-300 rounded-lg p-3.5 flex flex-col justify-between gap-3 min-h-[210px]">
              <div className="space-y-3">
                {/* Selected toppings chips */}
                {(draft.toppings?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-2.5">
                    {(draft.toppings ?? []).map((tp) => (
                      <div
                        key={tp.id}
                        className="inline-flex items-center gap-2.5 px-3 py-2 bg-white border border-slate-300 rounded-lg shadow-xs"
                      >
                        <span className="w-6 h-6 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 tabular-nums">
                          1
                        </span>
                        <div className="leading-tight">
                          <div className="text-sm font-semibold text-slate-900">{tp.name}</div>
                          <div className="text-xs text-cyan-700 font-semibold tabular-nums">
                            +{formatVND(tp.price)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleTopping(tp)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                          aria-label={`Bỏ ${tp.name}`}
                        >
                          <X className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 py-2">
                    Chưa chọn topping thêm. Nhấn vào các topping bên dưới để thêm vào món này.
                  </div>
                )}

                {/* Per-item Discount Inline Panel (toggled by yellow "% giảm - Số tiền giảm" button) */}
                {showDiscountEditor && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                        <Percent className="w-3.5 h-3.5" />
                        Chiết khấu / Giảm giá riêng cho món này
                      </span>
                      <div className="inline-flex rounded-md overflow-hidden border border-amber-300 bg-white">
                        <button
                          type="button"
                          onClick={() => toggleDiscountType('percent')}
                          className={`px-3 py-1 text-xs font-bold transition-colors ${
                            discType === 'percent'
                              ? 'bg-amber-500 text-white'
                              : 'text-slate-700 hover:bg-amber-50'
                          }`}
                        >
                          Giảm %
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDiscountType('fixed')}
                          className={`px-3 py-1 text-xs font-bold transition-colors border-l border-amber-300 ${
                            discType === 'fixed'
                              ? 'bg-amber-500 text-white'
                              : 'text-slate-700 hover:bg-amber-50'
                          }`}
                        >
                          Giảm tiền (₫)
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative flex-1 min-w-[150px]">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={
                            discVal > 0
                              ? discType === 'fixed'
                                ? formatDotNumber(discVal)
                                : String(discVal)
                              : ''
                          }
                          onChange={(e) => updateDiscountValue(e.target.value)}
                          placeholder={discType === 'percent' ? 'Nhập % (VD: 10)' : 'Nhập số tiền...'}
                          className="w-full h-9 px-3 pr-8 text-sm font-bold tabular-nums text-right bg-white border border-amber-300 rounded-md focus:outline-none focus:border-cyan-600"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                          {discType === 'percent' ? '%' : '₫'}
                        </span>
                      </div>

                      {discType === 'percent' && (
                        <div className="flex items-center gap-1">
                          {[5, 10, 15, 20, 50].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => updateDiscountValue(String(pct))}
                              className={`h-9 px-2.5 text-xs font-bold tabular-nums rounded-md border transition-colors ${
                                discVal === pct
                                  ? 'bg-amber-500 text-white border-amber-600'
                                  : 'bg-white text-slate-700 border-amber-300 hover:bg-amber-100'
                              }`}
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      )}

                      {discVal > 0 && (
                        <button
                          type="button"
                          onClick={() => updateDiscountValue('0')}
                          className="h-9 px-2.5 text-xs font-semibold text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-md"
                        >
                          Xóa giảm
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {draft.note && (
                <div className="pt-2 border-t border-slate-100 text-xs text-amber-800 font-medium">
                  Ghi chú món: <strong>{draft.note}</strong>
                </div>
              )}
            </div>

            {/* Right KAS Action Buttons Stack */}
            <div className="md:col-span-3 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full py-3 px-3 rounded-md bg-[#0a2268] hover:bg-[#0d2d87] text-white text-sm font-bold transition-colors shadow-xs"
              >
                Xác nhận
              </button>
              <button
                type="button"
                onClick={() => setShowDiscountEditor((prev) => !prev)}
                className={`w-full py-3 px-3 rounded-md text-sm font-bold transition-colors shadow-xs ${
                  showDiscountEditor || lineDiscount > 0
                    ? 'bg-amber-500 text-white ring-2 ring-amber-300'
                    : 'bg-amber-400 hover:bg-amber-500 text-slate-950'
                }`}
              >
                % giảm - Số tiền giảm
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="w-full py-3 px-3 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors shadow-xs"
              >
                Hủy món
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 px-3 rounded-md bg-slate-400 hover:bg-slate-500 text-white text-sm font-bold transition-colors"
              >
                Bỏ qua
              </button>
            </div>
          </div>

          {/* Bottom Split: Toppings Picker (Left) + Notes & Quick Chips (Right) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
            {/* Bottom-Left: Topping Selector & Quick Create */}
            <div className="md:col-span-7 flex flex-col space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="px-4 py-1.5 rounded-md bg-cyan-600 text-white text-xs font-bold">
                  Topping thêm ({availableToppings.length})
                </span>
                <span className="text-xs text-slate-500">Nhấn để chọn / bỏ chọn</span>
              </div>

              <div className="bg-white border border-slate-300 rounded-lg p-3 space-y-3 flex-1">
                {availableToppings.length === 0 ? (
                  <div className="text-xs text-slate-500 py-4 text-center">
                    Chưa có topping nào. Tạo nhanh topping ngay bên dưới.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[155px] overflow-y-auto pos-scroll pr-0.5">
                    {availableToppings.map((tp) => {
                      const isSelected = (draft.toppings ?? []).some((t) => t.id === tp.id);
                      return (
                        <button
                          key={tp.id}
                          type="button"
                          onClick={() =>
                            toggleTopping({ id: tp.id, name: tp.name, price: tp.price })
                          }
                          className={`relative text-left p-2.5 rounded-md border transition-all flex flex-col justify-between min-h-[62px] ${
                            isSelected
                              ? 'bg-cyan-50 border-cyan-600 ring-1 ring-cyan-600/30'
                              : 'bg-slate-50/70 border-slate-200 hover:border-cyan-500 hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-900 leading-snug pr-4 line-clamp-2">
                            {tp.name}
                          </div>
                          <div className="text-xs font-semibold tabular-nums text-cyan-700 text-right mt-1">
                            {formatDotNumber(tp.price)}
                          </div>
                          {isSelected && (
                            <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded bg-cyan-600 text-white flex items-center justify-center">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Quick Create Topping Bar */}
                <form
                  onSubmit={handleQuickCreateTopping}
                  className="pt-2.5 border-t border-slate-200 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={quickToppingName}
                    onChange={(e) =>
                      setQuickToppingName(e.target.value.slice(0, LIMITS.TOPPING_NAME_MAX))
                    }
                    placeholder="Tạo nhanh topping mới..."
                    className="flex-1 min-w-0 h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:bg-white focus:border-cyan-600"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quickToppingPrice}
                    onChange={(e) => setQuickToppingPrice(formatDotNumber(e.target.value))}
                    placeholder="Giá (10.000)"
                    className="w-24 h-8 px-2 text-xs font-semibold tabular-nums text-right bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:bg-white focus:border-cyan-600"
                  />
                  <button
                    type="submit"
                    disabled={creatingTopping}
                    className="h-8 px-3 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-md whitespace-nowrap"
                  >
                    + Tạo
                  </button>
                </form>
              </div>
            </div>

            {/* Bottom-Right: Note Input + Quick Note Buttons */}
            <div className="md:col-span-5 flex flex-col space-y-2">
              <input
                type="text"
                value={draft.note}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    note: e.target.value.slice(0, LIMITS.ITEM_NOTE_MAX),
                  }))
                }
                placeholder="Nhập ghi chú món (VD: Ít đá, 50% đường)..."
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-cyan-600"
              />

              <div className="bg-white border border-slate-300 rounded-lg p-3 flex-1">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {QUICK_NOTES.map((preset) => {
                    const active = draft.note
                      .toLowerCase()
                      .split(',')
                      .map((s) => s.trim())
                      .includes(preset.toLowerCase());
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => appendQuickNote(preset)}
                        className={`px-2.5 py-2.5 text-xs font-semibold rounded-md border transition-colors text-center ${
                          active
                            ? 'bg-orange-50 border-orange-500 text-orange-800'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
