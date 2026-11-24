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
  ComboSelectionRule,
  ComboTopping,
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
  isCombo?: boolean;
  comboToppings?: ComboTopping[];
  comboRule?: ComboSelectionRule;
  comboMaxToppings?: number;
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
  isCombo = false,
  comboToppings = [],
  comboRule,
  comboMaxToppings = 0,
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

  const effectiveComboRule: ComboSelectionRule =
    comboRule ?? (comboMaxToppings > 0 ? 'max' : 'all');
  const hasComboPool = isCombo && comboToppings.length > 0;
  const hasComboLimit = hasComboPool && effectiveComboRule !== 'all' && comboMaxToppings > 0;
  const isExactCombo = hasComboLimit && effectiveComboRule === 'exact';
  const comboPoolIds = new Set(comboToppings.map((ct) => ct.id));

  const [showDiscountEditor, setShowDiscountEditor] = useState(
    (item.discountValue ?? 0) > 0 || (item.discountAmount ?? 0) > 0,
  );
  const [comboTab, setComboTab] = useState<'combo' | 'extra'>(hasComboPool ? 'combo' : 'extra');
  const [comboFreeMode, setComboFreeMode] = useState(isCombo && !hasComboLimit);
  const [quickToppingName, setQuickToppingName] = useState('');
  const [quickToppingPrice, setQuickToppingPrice] = useState('');
  const [creatingTopping, setCreatingTopping] = useState(false);

  const availableToppings = toppings
    .filter((t) => t.available)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  const selectedComboCount = (draft.toppings ?? []).filter(
    (t) => t.price <= 0 && comboPoolIds.has(t.id),
  ).length;

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

  const toggleTopping = (tp: OrderItemTopping, isFromComboPool = false) => {
    setDraft((prev) => {
      const curr = prev.toppings ?? [];
      const exists = curr.some((t) => t.id === tp.id);
      let nextToppings: OrderItemTopping[];
      if (exists) {
        nextToppings = curr.filter((t) => t.id !== tp.id);
      } else {
        if (isFromComboPool && hasComboLimit) {
          const currComboCount = curr.filter(
            (t) => t.price <= 0 && comboPoolIds.has(t.id),
          ).length;
          if (currComboCount >= comboMaxToppings) {
            onNotify(
              isExactCombo
                ? `Combo này phải chọn đúng ${comboMaxToppings} món kèm. Bỏ chọn 1 món nếu muốn đổi.`
                : `Combo này chỉ được chọn tối đa ${comboMaxToppings} món kèm trong danh sách đã cài.`,
              'error',
            );
            return prev;
          }
        }
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
      toggleTopping({
        id: newId,
        name: cleanName,
        price: isCombo && !hasComboLimit && comboFreeMode ? 0 : price,
      });
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
    if (hasComboLimit) {
      if (isExactCombo && selectedComboCount !== comboMaxToppings) {
        onNotify(
          `Vui lòng chọn đúng ${comboMaxToppings} món kèm trong Combo (đã chọn ${selectedComboCount}/${comboMaxToppings}).`,
          'error',
        );
        return;
      }
      if (!isExactCombo && selectedComboCount === 0) {
        onNotify(
          `Vui lòng chọn ít nhất 1 món kèm trong Combo (tối đa ${comboMaxToppings} món).`,
          'error',
        );
        return;
      }
      if (selectedComboCount > comboMaxToppings) {
        onNotify(
          `Combo này chỉ được chọn tối đa ${comboMaxToppings} món kèm.`,
          'error',
        );
        return;
      }
    }
    onSave({
      ...draft,
      discountAmount: getItemDiscountAmount(draft),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Tùy chỉnh món ${draft.name}`}
    >
      <div className="bg-zinc-100 border border-zinc-200 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Clean White Modal Header */}
        <div className="bg-white border-b border-zinc-200 px-5 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-zinc-950 leading-snug truncate">{draft.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs font-mono tabular-nums text-zinc-500">
              <span>
                Đơn giá: <strong className="text-zinc-900">{formatVND(unitPrice)}</strong>
              </span>
              {lineDiscount > 0 && (
                <span className="text-amber-700">
                  Giảm: <strong>-{formatVND(lineDiscount)}</strong>
                </span>
              )}
              <span>
                Thành tiền: <strong className="text-emerald-700">{formatVND(lineNet)}</strong>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded-xl transition-colors shrink-0"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto pos-scroll space-y-4">
          {/* Quantity Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">
                Số lượng
              </span>
              <div className="inline-flex items-center bg-white border border-zinc-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => updateQty(-1)}
                  className="w-11 h-10 flex items-center justify-center text-zinc-700 hover:bg-zinc-100 transition-colors border-r border-zinc-200"
                  aria-label="Giảm số lượng"
                >
                  <Minus className="w-4 h-4 stroke-[2.5]" />
                </button>
                <span className="w-16 text-center text-lg font-bold font-mono tabular-nums text-zinc-950">
                  {draft.qty}
                </span>
                <button
                  type="button"
                  onClick={() => updateQty(1)}
                  className="w-11 h-10 flex items-center justify-center text-emerald-700 hover:bg-emerald-50 transition-colors border-l border-zinc-200"
                  aria-label="Tăng số lượng"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {lineGross !== lineNet && (
              <div className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-mono tabular-nums">
                Trước giảm {formatVND(lineGross)} → Còn {formatVND(lineNet)}
              </div>
            )}
          </div>

          {/* Middle Split: Selected Modifiers (Left) + Clean Action Stack (Right) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-stretch">
            {/* Selected Modifiers Canvas */}
            <div className="md:col-span-9 bg-white border border-zinc-200 rounded-xl p-4 flex flex-col justify-between gap-3 min-h-[196px]">
              <div className="space-y-3">
                {(draft.toppings?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {(draft.toppings ?? []).map((tp) => (
                      <div
                        key={tp.id}
                        className="inline-flex items-center gap-2.5 pl-3 pr-2 py-2 bg-zinc-50 border border-zinc-200 rounded-xl"
                      >
                        <div className="leading-tight">
                          <div className="text-xs font-semibold text-zinc-900">{tp.name}</div>
                          <div
                            className={`text-[11px] font-mono tabular-nums ${
                              tp.price === 0 ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'
                            }`}
                          >
                            {tp.price === 0 ? 'Kèm combo (0 ₫)' : `+${formatVND(tp.price)}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleTopping(tp)}
                          className="p-1 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          aria-label={`Bỏ ${tp.name}`}
                        >
                          <X className="w-3.5 h-3.5 stroke-[2.5]" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-400 py-2">
                    {hasComboLimit
                      ? isExactCombo
                        ? `Hãy chọn đúng ${comboMaxToppings} món kèm miễn phí trong danh sách Combo bên dưới.`
                        : `Hãy chọn tối đa ${comboMaxToppings} món kèm miễn phí trong danh sách Combo bên dưới.`
                      : 'Chưa chọn topping thêm. Chạm vào danh sách topping bên dưới để bổ sung.'}
                  </div>
                )}

                {/* Per-item Discount Inline Panel */}
                {showDiscountEditor && (
                  <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-amber-950 flex items-center gap-1.5">
                        <Percent className="w-3.5 h-3.5 text-amber-700" />
                        Chiết khấu riêng cho món này
                      </span>
                      <div className="inline-flex rounded-lg overflow-hidden border border-amber-200 bg-white">
                        <button
                          type="button"
                          onClick={() => toggleDiscountType('percent')}
                          className={`px-3 py-1 text-xs font-semibold transition-colors ${
                            discType === 'percent'
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-700 hover:bg-zinc-50'
                          }`}
                        >
                          Giảm %
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDiscountType('fixed')}
                          className={`px-3 py-1 text-xs font-semibold transition-colors border-l border-amber-200 ${
                            discType === 'fixed'
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-700 hover:bg-zinc-50'
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
                          className="w-full h-9 px-3 pr-8 text-sm font-bold font-mono tabular-nums text-right bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-emerald-700"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-500">
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
                              className={`h-9 px-2.5 text-xs font-semibold font-mono tabular-nums rounded-lg border transition-colors ${
                                discVal === pct
                                  ? 'bg-zinc-900 text-white border-zinc-900'
                                  : 'bg-white text-zinc-700 border-amber-200 hover:border-amber-400'
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
                          className="h-9 px-2.5 text-xs font-semibold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg"
                        >
                          Xóa giảm
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {draft.note && (
                <div className="pt-2.5 border-t border-zinc-100 text-xs text-zinc-600">
                  Ghi chú món: <strong className="text-zinc-900">{draft.note}</strong>
                </div>
              )}
            </div>

            {/* Right Clean Action Stack */}
            <div className="md:col-span-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full h-11 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors"
              >
                Xác nhận
              </button>
              <button
                type="button"
                onClick={() => setShowDiscountEditor((prev) => !prev)}
                className={`w-full h-11 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                  showDiscountEditor || lineDiscount > 0
                    ? 'bg-amber-50 border-amber-400 text-amber-900'
                    : 'bg-white border-zinc-200 hover:border-zinc-400 text-zinc-800'
                }`}
              >
                Chiết khấu món
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="w-full h-11 px-3 rounded-xl bg-white hover:bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold transition-colors"
              >
                Hủy món
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full h-11 px-3 rounded-xl bg-zinc-200/80 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold transition-colors"
              >
                Bỏ qua
              </button>
            </div>
          </div>

          {/* Bottom Split: Toppings Picker (Left) + Notes & Quick Chips (Right) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
            {/* Bottom-Left: Combo Pool Picker & Extra Paid Toppings */}
            <div className="md:col-span-7 flex flex-col space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {hasComboPool ? (
                  <div className="inline-flex rounded-xl bg-zinc-200/70 p-1 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setComboTab('combo')}
                      className={`px-3 py-1.5 rounded-lg transition-colors ${
                        comboTab === 'combo'
                          ? 'bg-white text-zinc-950 shadow-xs'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      {hasComboLimit
                        ? `Món kèm Combo (${selectedComboCount}/${comboMaxToppings})`
                        : `Thành phần Combo (${comboToppings.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setComboTab('extra')}
                      className={`px-3 py-1.5 rounded-lg transition-colors ${
                        comboTab === 'extra'
                          ? 'bg-white text-zinc-950 shadow-xs'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      Topping gọi thêm ({availableToppings.length})
                    </button>
                  </div>
                ) : (
                  <span className="text-xs font-bold text-zinc-800">
                    {isCombo ? 'Topping / Thành phần' : 'Topping thêm'} ({availableToppings.length})
                  </span>
                )}

                {hasComboLimit && comboTab === 'combo' ? (
                  <span
                    className={`text-xs font-semibold font-mono tabular-nums ${
                      selectedComboCount >= comboMaxToppings
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {selectedComboCount >= comboMaxToppings
                      ? `Đã đủ ${selectedComboCount}/${comboMaxToppings} món`
                      : isExactCombo
                        ? `Chọn đúng ${comboMaxToppings} món (${selectedComboCount}/${comboMaxToppings})`
                        : `Chọn tối đa ${comboMaxToppings} món`}
                  </span>
                ) : isCombo && !hasComboLimit && comboTab === 'extra' ? (
                  <div className="inline-flex rounded-lg bg-zinc-200/70 p-0.5 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setComboFreeMode(true)}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        comboFreeMode
                          ? 'bg-white text-zinc-950 shadow-xs'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      Kèm combo (0 ₫)
                    </button>
                    <button
                      type="button"
                      onClick={() => setComboFreeMode(false)}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        !comboFreeMode
                          ? 'bg-white text-zinc-950 shadow-xs'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      Tính giá thêm
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-zinc-500">
                    {hasComboLimit && comboTab === 'extra'
                      ? 'Gọi thêm ngoài Combo (tính tiền)'
                      : 'Chạm để chọn / bỏ chọn'}
                  </span>
                )}
              </div>

              <div className="bg-white border border-zinc-200 rounded-xl p-3 space-y-3 flex-1">
                {hasComboPool && comboTab === 'combo' ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[195px] overflow-y-auto pos-scroll pr-0.5">
                      {comboToppings.map((ct) => {
                        const isSelected = (draft.toppings ?? []).some(
                          (t) => t.id === ct.id && t.price <= 0,
                        );
                        const isLockedByLimit =
                          hasComboLimit && !isSelected && selectedComboCount >= comboMaxToppings;
                        return (
                          <button
                            key={ct.id}
                            type="button"
                            onClick={() =>
                              toggleTopping({ id: ct.id, name: ct.name, price: 0 }, true)
                            }
                            className={`relative text-left p-2.5 rounded-xl border transition-all flex flex-col justify-between min-h-[62px] ${
                              isSelected
                                ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500/20'
                                : isLockedByLimit
                                  ? 'bg-zinc-50 border-zinc-200 opacity-45 cursor-not-allowed'
                                  : 'bg-zinc-50/70 border-zinc-200 hover:border-amber-400 hover:bg-white'
                            }`}
                          >
                            <div className="text-xs font-semibold text-zinc-900 leading-snug pr-5 line-clamp-2">
                              {ct.name}
                            </div>
                            <div className="text-[11px] font-mono font-semibold tabular-nums text-amber-700 text-right mt-1">
                              0 ₫ · Combo
                            </div>
                            {isSelected && (
                              <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-amber-600 text-white flex items-center justify-center">
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {hasComboLimit && selectedComboCount >= comboMaxToppings && (
                      <div className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        Đã chọn đủ {comboMaxToppings}/{comboMaxToppings} món kèm trong Combo. Bỏ chọn 1 món nếu muốn đổi, hoặc chuyển tab <strong>Topping gọi thêm</strong> để mua thêm.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {availableToppings.length === 0 ? (
                      <div className="text-xs text-zinc-500 py-4 text-center">
                        Chưa có topping nào. Tạo nhanh topping ngay bên dưới.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[155px] overflow-y-auto pos-scroll pr-0.5">
                        {availableToppings.map((tp) => {
                          const effectivePrice =
                            isCombo && !hasComboLimit && comboFreeMode ? 0 : tp.price;
                          const paidId =
                            hasComboLimit && comboPoolIds.has(tp.id) ? `extra_${tp.id}` : tp.id;
                          const isSelected = (draft.toppings ?? []).some((t) => t.id === paidId);
                          return (
                            <button
                              key={tp.id}
                              type="button"
                              onClick={() =>
                                toggleTopping({ id: paidId, name: tp.name, price: effectivePrice })
                              }
                              className={`relative text-left p-2.5 rounded-xl border transition-all flex flex-col justify-between min-h-[62px] ${
                                isSelected
                                  ? 'bg-emerald-50/80 border-emerald-600 ring-1 ring-emerald-600/20'
                                  : 'bg-zinc-50/70 border-zinc-200 hover:border-zinc-400 hover:bg-white'
                              }`}
                            >
                              <div className="text-xs font-semibold text-zinc-900 leading-snug pr-5 line-clamp-2">
                                {tp.name}
                              </div>
                              <div
                                className={`text-[11px] font-mono font-semibold tabular-nums text-right mt-1 ${
                                  effectivePrice === 0 ? 'text-amber-700' : 'text-emerald-700'
                                }`}
                              >
                                {effectivePrice === 0 ? '0 ₫ · Combo' : `${formatDotNumber(tp.price)} ₫`}
                              </div>
                              {isSelected && (
                                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-emerald-700 text-white flex items-center justify-center">
                                  <Check className="w-2.5 h-2.5 stroke-[3]" />
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
                      className="pt-2.5 border-t border-zinc-100 flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={quickToppingName}
                        onChange={(e) =>
                          setQuickToppingName(e.target.value.slice(0, LIMITS.TOPPING_NAME_MAX))
                        }
                        placeholder="Tạo nhanh topping mới..."
                        className="flex-1 min-w-0 h-8 px-2.5 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={quickToppingPrice}
                        onChange={(e) => setQuickToppingPrice(formatDotNumber(e.target.value))}
                        placeholder="Giá (10.000)"
                        className="w-24 h-8 px-2 text-xs font-semibold font-mono tabular-nums text-right bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
                      />
                      <button
                        type="submit"
                        disabled={creatingTopping}
                        className="h-8 px-3 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                      >
                        + Tạo
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>

            {/* Bottom-Right: Note Input + Quick Note Buttons */}
            <div className="md:col-span-5 flex flex-col space-y-2.5">
              <div className="text-xs font-bold text-zinc-800">Ghi chú pha chế</div>
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
                className="w-full h-9 px-3 text-sm bg-white border border-zinc-200 rounded-xl focus:outline-none focus:border-emerald-700"
              />

              <div className="bg-white border border-zinc-200 rounded-xl p-3 flex-1">
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
                        className={`px-2.5 py-2.5 text-xs font-semibold rounded-lg border transition-colors text-center ${
                          active
                            ? 'bg-zinc-900 border-zinc-900 text-white'
                            : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:bg-white'
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
