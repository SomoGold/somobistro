import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, Check, Layers, Power } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import { formatDotNumber, formatVND, generateDocId, parseDotNumber, resolveAssetUrl } from '../lib/format';
import {
  clampNumber,
  ComboTopping,
  LIMITS,
  MENU_CATEGORIES,
  MenuCategory,
  MenuItem,
  sanitizeText,
  STUDIO_MENU_IMAGES,
  Topping,
} from '../types/pos';
import { MenuThumbnail } from './MenuThumbnail';

interface MenuManagerViewProps {
  ownerId: string;
  menuItems: MenuItem[];
  toppings: Topping[];
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

interface MenuFormState {
  id: string | null;
  sku: string;
  name: string;
  category: MenuCategory;
  price: string;
  existingCost: number;
  unit: string;
  imageUrl: string;
  available: boolean;
  isCombo: boolean;
  comboToppings: ComboTopping[];
  comboMaxToppings: number;
}

const EMPTY_FORM: MenuFormState = {
  id: null,
  sku: '',
  name: '',
  category: 'Cà phê',
  price: '35.000',
  existingCost: 0,
  unit: 'Ly',
  imageUrl: '',
  available: true,
  isCombo: false,
  comboToppings: [],
  comboMaxToppings: 0,
};

interface ToppingFormState {
  id: string | null;
  name: string;
  price: string;
  available: boolean;
}

const EMPTY_TOPPING_FORM: ToppingFormState = {
  id: null,
  name: '',
  price: '10.000',
  available: true,
};

export function MenuManagerView({
  ownerId,
  menuItems,
  toppings,
  onNotify,
}: MenuManagerViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'items' | 'toppings'>('items');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'Tất cả' | MenuCategory>('Tất cả');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [enablingAll, setEnablingAll] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<MenuFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [comboPickerSource, setComboPickerSource] = useState<'toppings' | 'menu'>('toppings');
  const [customComboToppingName, setCustomComboToppingName] = useState('');

  // Topping management state
  const [toppingSearch, setToppingSearch] = useState('');
  const [toppingModalOpen, setToppingModalOpen] = useState(false);
  const [toppingForm, setToppingForm] = useState<ToppingFormState>(EMPTY_TOPPING_FORM);
  const [savingTopping, setSavingTopping] = useState(false);
  const [confirmDeleteToppingId, setConfirmDeleteToppingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems
      .filter((item) => {
        if (categoryFilter !== 'Tất cả' && item.category !== categoryFilter) return false;
        if (statusFilter === 'active' && !item.available) return false;
        if (statusFilter === 'inactive' && item.available) return false;
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.sku.localeCompare(b.sku, 'vi', { numeric: true }));
  }, [menuItems, search, categoryFilter, statusFilter]);

  const filteredToppings = useMemo(() => {
    const q = toppingSearch.trim().toLowerCase();
    return toppings
      .filter((t) => (!q ? true : t.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [toppings, toppingSearch]);

  const summary = useMemo(() => {
    const total = menuItems.length;
    const active = menuItems.filter((i) => i.available).length;
    return {
      total,
      active,
      outOfStock: total - active,
      toppingsTotal: toppings.length,
    };
  }, [menuItems, toppings]);

  const openCreateModal = () => {
    const nextIdx = menuItems.length + 1;
    setForm({
      ...EMPTY_FORM,
      sku: `SB${String(nextIdx).padStart(2, '0')}`,
    });
    setCustomComboToppingName('');
    setComboPickerSource('toppings');
    setModalOpen(true);
  };

  const openCreateComboModal = () => {
    const comboCount = menuItems.filter((i) => i.isCombo || i.category === 'Combo').length + 1;
    setForm({
      ...EMPTY_FORM,
      sku: `CB${String(comboCount).padStart(2, '0')}`,
      category: 'Combo',
      price: '65.000',
      unit: 'Combo',
      isCombo: true,
      comboToppings: [],
      comboMaxToppings: 0,
    });
    setCustomComboToppingName('');
    setComboPickerSource('toppings');
    setModalOpen(true);
  };

  const openEditModal = (item: MenuItem) => {
    setForm({
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      price: formatDotNumber(item.price),
      existingCost: item.cost ?? 0,
      unit: item.unit,
      imageUrl: item.imageUrl || '',
      available: item.available,
      isCombo: Boolean(item.isCombo || (item.comboToppings && item.comboToppings.length > 0)),
      comboToppings: item.comboToppings ? item.comboToppings.map((t) => ({ ...t })) : [],
      comboMaxToppings: clampNumber(item.comboMaxToppings ?? 0, 0, LIMITS.MAX_COMBO_TOPPINGS),
    });
    setCustomComboToppingName('');
    setComboPickerSource('toppings');
    setModalOpen(true);
  };

  const toggleComboTopping = (entry: ComboTopping) => {
    setForm((prev) => {
      const exists = prev.comboToppings.some((t) => t.id === entry.id);
      if (exists) {
        return {
          ...prev,
          comboToppings: prev.comboToppings.filter((t) => t.id !== entry.id),
        };
      }
      if (prev.comboToppings.length >= LIMITS.MAX_COMBO_TOPPINGS) {
        onNotify(`Mỗi Combo tối đa ${LIMITS.MAX_COMBO_TOPPINGS} thành phần / topping.`, 'error');
        return prev;
      }
      return {
        ...prev,
        comboToppings: [...prev.comboToppings, entry],
      };
    });
  };

  const handleAddCustomComboTopping = () => {
    const cleanName = sanitizeText(customComboToppingName, LIMITS.TOPPING_NAME_MAX);
    if (!cleanName) return;
    if (form.comboToppings.length >= LIMITS.MAX_COMBO_TOPPINGS) {
      onNotify(`Mỗi Combo tối đa ${LIMITS.MAX_COMBO_TOPPINGS} thành phần / topping.`, 'error');
      return;
    }
    const alreadyExists = form.comboToppings.some(
      (t) => t.name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (alreadyExists) {
      setCustomComboToppingName('');
      return;
    }
    setForm((prev) => ({
      ...prev,
      comboToppings: [
        ...prev.comboToppings,
        { id: generateDocId('cbt'), name: cleanName },
      ],
    }));
    setCustomComboToppingName('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSku = sanitizeText(form.sku, LIMITS.SKU_MAX).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanName = sanitizeText(form.name, LIMITS.ITEM_NAME_MAX);
    const cleanUnit = sanitizeText(form.unit || (form.isCombo ? 'Combo' : 'Ly'), LIMITS.UNIT_MAX);
    const cleanImg = sanitizeText(form.imageUrl, LIMITS.IMAGE_URL_MAX);
    const price = clampNumber(parseDotNumber(form.price), 0, LIMITS.MAX_PRICE);
    const cost = clampNumber(form.existingCost, 0, LIMITS.MAX_PRICE);
    const cleanComboToppings: ComboTopping[] = form.isCombo
      ? form.comboToppings
          .map((t) => ({
            id: sanitizeText(t.id, 128),
            name: sanitizeText(t.name, LIMITS.TOPPING_NAME_MAX),
          }))
          .filter((t) => t.id.length > 0 && t.name.length > 0)
          .slice(0, LIMITS.MAX_COMBO_TOPPINGS)
      : [];
    const cleanComboMaxToppings =
      form.isCombo && cleanComboToppings.length > 0
        ? clampNumber(form.comboMaxToppings, 0, cleanComboToppings.length)
        : 0;

    if (!cleanSku || !LIMITS.SKU_PATTERN.test(cleanSku)) {
      onNotify('Mã SKU chỉ gồm chữ không dấu, số, dấu gạch ngang hoặc gạch dưới.', 'error');
      return;
    }
    if (!cleanName) {
      onNotify('Vui lòng nhập tên món.', 'error');
      return;
    }

    setSaving(true);
    try {
      if (form.id) {
        const ref = doc(db, 'menuItems', form.id);
        await updateDoc(ref, {
          sku: cleanSku,
          name: cleanName,
          category: form.category,
          price,
          cost,
          unit: cleanUnit,
          imageUrl: cleanImg,
          available: form.available,
          isCombo: form.isCombo,
          comboToppings: cleanComboToppings,
          comboMaxToppings: cleanComboMaxToppings,
          updatedAt: serverTimestamp(),
        });
        onNotify(`Đã cập nhật ${form.isCombo ? 'Combo' : 'món'} "${cleanName}".`);
      } else {
        const newId = generateDocId('item');
        await setDoc(doc(db, 'menuItems', newId), {
          ownerId,
          sku: cleanSku,
          name: cleanName,
          category: form.category,
          price,
          cost,
          unit: cleanUnit,
          imageUrl: cleanImg,
          available: form.available,
          isCombo: form.isCombo,
          comboToppings: cleanComboToppings,
          comboMaxToppings: cleanComboMaxToppings,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onNotify(`Đã thêm ${form.isCombo ? 'Combo' : 'món'} "${cleanName}" vào thực đơn.`);
      }
      setModalOpen(false);
    } catch (error) {
      reportFirestoreError(
        error,
        form.id ? OperationType.UPDATE : OperationType.CREATE,
        `menuItems/${form.id ?? 'new'}`,
      );
      onNotify('Không thể lưu món hàng. Vui lòng kiểm tra lại thông tin.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAvailable = async (item: MenuItem) => {
    try {
      await updateDoc(doc(db, 'menuItems', item.id), {
        available: !item.available,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        !item.available
          ? `Đã bật món "${item.name}" để bán lại.`
          : `Đã tắt món "${item.name}" (tạm hết).`,
      );
    } catch (error) {
      reportFirestoreError(error, OperationType.UPDATE, `menuItems/${item.id}`);
      onNotify('Không thể cập nhật trạng thái món.', 'error');
    }
  };

  const handleEnableAllItems = async () => {
    const disabledItems = menuItems.filter((i) => !i.available);
    if (disabledItems.length === 0) return;
    setEnablingAll(true);
    try {
      for (let i = 0; i < disabledItems.length; i += 450) {
        const batch = writeBatch(db);
        disabledItems.slice(i, i + 450).forEach((item) => {
          batch.update(doc(db, 'menuItems', item.id), {
            available: true,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      onNotify(`Đã bật bán lại toàn bộ ${disabledItems.length} món đang tắt.`);
    } catch (error) {
      reportFirestoreError(error, OperationType.UPDATE, 'menuItems/batch-enable');
      onNotify('Không thể bật lại tất cả món. Vui lòng thử lại.', 'error');
    } finally {
      setEnablingAll(false);
    }
  };

  const handleDelete = async (item: MenuItem) => {
    try {
      await deleteDoc(doc(db, 'menuItems', item.id));
      setConfirmDeleteId(null);
      onNotify(`Đã xóa món "${item.name}".`);
    } catch (error) {
      reportFirestoreError(error, OperationType.DELETE, `menuItems/${item.id}`);
      onNotify('Không thể xóa món hàng.', 'error');
    }
  };

  const openCreateToppingModal = () => {
    setToppingForm(EMPTY_TOPPING_FORM);
    setToppingModalOpen(true);
  };

  const openEditToppingModal = (tp: Topping) => {
    setToppingForm({
      id: tp.id,
      name: tp.name,
      price: formatDotNumber(tp.price),
      available: tp.available,
    });
    setToppingModalOpen(true);
  };

  const handleSaveTopping = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeText(toppingForm.name, LIMITS.TOPPING_NAME_MAX);
    const price = clampNumber(parseDotNumber(toppingForm.price), 0, LIMITS.MAX_PRICE);
    if (!cleanName) {
      onNotify('Vui lòng nhập tên topping.', 'error');
      return;
    }

    setSavingTopping(true);
    try {
      if (toppingForm.id) {
        await updateDoc(doc(db, 'toppings', toppingForm.id), {
          name: cleanName,
          price,
          available: toppingForm.available,
          updatedAt: serverTimestamp(),
        });
        onNotify(`Đã cập nhật topping "${cleanName}".`);
      } else {
        const newId = generateDocId('top');
        await setDoc(doc(db, 'toppings', newId), {
          ownerId,
          name: cleanName,
          price,
          available: toppingForm.available,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onNotify(`Đã thêm topping "${cleanName}".`);
      }
      setToppingModalOpen(false);
    } catch (error) {
      reportFirestoreError(
        error,
        toppingForm.id ? OperationType.UPDATE : OperationType.CREATE,
        `toppings/${toppingForm.id ?? 'new'}`,
      );
      onNotify('Không thể lưu topping. Vui lòng thử lại.', 'error');
    } finally {
      setSavingTopping(false);
    }
  };

  const handleToggleToppingAvailable = async (tp: Topping) => {
    try {
      await updateDoc(doc(db, 'toppings', tp.id), {
        available: !tp.available,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        !tp.available
          ? `Đã bật topping "${tp.name}" để bán lại.`
          : `Đã tắt topping "${tp.name}" (tạm hết).`,
      );
    } catch (error) {
      reportFirestoreError(error, OperationType.UPDATE, `toppings/${tp.id}`);
      onNotify('Không thể cập nhật trạng thái topping.', 'error');
    }
  };

  const handleDeleteTopping = async (tp: Topping) => {
    try {
      await deleteDoc(doc(db, 'toppings', tp.id));
      setConfirmDeleteToppingId(null);
      onNotify(`Đã xóa topping "${tp.name}".`);
    } catch (error) {
      reportFirestoreError(error, OperationType.DELETE, `toppings/${tp.id}`);
      onNotify('Không thể xóa topping.', 'error');
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Sub-navigation: Món chính vs Topping */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/75 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveSubTab('items')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
              activeSubTab === 'items'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Món chính ({summary.total})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('toppings')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
              activeSubTab === 'toppings'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Topping ({summary.toppingsTotal})
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('items');
            setStatusFilter('all');
          }}
          className={`bg-white border rounded-xl p-4 text-left transition-colors ${
            activeSubTab === 'items' && statusFilter === 'all'
              ? 'border-slate-400 ring-1 ring-slate-300'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs text-slate-500">Tổng số món</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
            {summary.total}
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('items');
            setStatusFilter(statusFilter === 'active' ? 'all' : 'active');
          }}
          className={`bg-white border rounded-xl p-4 text-left transition-colors ${
            activeSubTab === 'items' && statusFilter === 'active'
              ? 'border-cyan-500 ring-1 ring-cyan-400'
              : 'border-slate-200 hover:border-cyan-300'
          }`}
        >
          <div className="text-xs text-slate-500">Đang bật bán</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-cyan-600">
            {summary.active}
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSubTab('items');
            setStatusFilter(statusFilter === 'inactive' ? 'all' : 'inactive');
          }}
          className={`bg-white border rounded-xl p-4 text-left transition-colors ${
            activeSubTab === 'items' && statusFilter === 'inactive'
              ? 'border-amber-500 ring-1 ring-amber-400'
              : 'border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="text-xs text-slate-500">Đang tắt món</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-amber-600">
            {summary.outOfStock}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('toppings')}
          className={`bg-white border rounded-xl p-4 text-left transition-colors ${
            activeSubTab === 'toppings'
              ? 'border-slate-400 ring-1 ring-slate-300'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs text-slate-500">Danh mục Topping</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
            {summary.toppingsTotal}
          </div>
        </button>
      </div>

      {activeSubTab === 'items' ? (
        <>
          {/* Controls Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm món hoặc mã SKU..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
              />
            </div>

            {/* Status filter: All / Enabled / Disabled */}
            <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg shrink-0">
              {(
                [
                  { id: 'all', label: 'Tất cả' },
                  { id: 'active', label: `Đang bật (${summary.active})` },
                  { id: 'inactive', label: `Đã tắt (${summary.outOfStock})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatusFilter(opt.id)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-colors ${
                    statusFilter === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {summary.outOfStock > 0 && (
              <button
                type="button"
                disabled={enablingAll}
                onClick={handleEnableAllItems}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Power className="w-3.5 h-3.5" />
                {enablingAll ? 'Đang bật...' : `Bật lại tất cả (${summary.outOfStock})`}
              </button>
            )}
            <button
              type="button"
              onClick={openCreateComboModal}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Layers className="w-4 h-4" />
              Tạo Combo
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Thêm món mới
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto w-fit max-w-full">
          {(['Tất cả', ...MENU_CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 w-12 text-center">STT</th>
                <th className="py-3 px-4">Món hàng</th>
                <th className="py-3 px-4">Mã SKU</th>
                <th className="py-3 px-4">Danh mục</th>
                <th className="py-3 px-4 text-right">Giá bán</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                    Chưa có món nào phù hợp. Nhấn "Thêm món mới" để bổ sung thực đơn.
                  </td>
                </tr>
              ) : (
                filtered.map((item, idx) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        !item.available ? 'bg-slate-50/80' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4 text-center tabular-nums text-xs text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-9 rounded-md overflow-hidden border border-slate-200 shrink-0">
                            <MenuThumbnail
                              src={item.imageUrl}
                              alt={item.name}
                              category={item.category}
                              className={`w-full h-full ${!item.available ? 'grayscale opacity-50' : ''}`}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`font-semibold ${
                                  item.available ? 'text-slate-900' : 'text-slate-400 line-through'
                                }`}
                              >
                                {item.name}
                              </span>
                              {item.isCombo && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-orange-100 text-orange-700 border border-orange-200 rounded">
                                  {(item.comboMaxToppings ?? 0) > 0
                                    ? `Combo · Tối đa ${item.comboMaxToppings} món`
                                    : 'Combo'}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">ĐVT: {item.unit}</div>
                            {item.isCombo && item.comboToppings && item.comboToppings.length > 0 && (
                              <div className="text-[11px] text-cyan-700 mt-0.5">
                                {item.comboToppings.map((ct) => `+ ${ct.name}`).join(' · ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 tabular-nums text-xs text-slate-600">
                        {item.sku}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">{item.category}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900">
                        {formatVND(item.price)}
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.available}
                          onClick={() => handleToggleAvailable(item)}
                          title={item.available ? 'Nhấn để tắt món' : 'Nhấn để bật món'}
                          className="inline-flex items-center gap-2 whitespace-nowrap group"
                        >
                          <span
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              item.available ? 'bg-cyan-600' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                                item.available ? 'translate-x-4.5' : 'translate-x-1'
                              }`}
                            />
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              item.available ? 'text-cyan-700' : 'text-amber-700'
                            }`}
                          >
                            {item.available ? 'Đang bật' : 'Đã tắt'}
                          </span>
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {confirmDeleteId === item.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDelete(item)}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
                            >
                              Xác nhận xóa
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                            >
                              Hủy
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              className="p-1.5 text-slate-500 hover:text-cyan-700 hover:bg-cyan-50 rounded-md transition-colors"
                              title="Chỉnh sửa món"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title="Xóa món"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      ) : (
        <>
          {/* Toppings Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={toppingSearch}
                onChange={(e) => setToppingSearch(e.target.value)}
                placeholder="Tìm tên topping..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
              />
            </div>
            <button
              type="button"
              onClick={openCreateToppingModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Thêm topping mới
            </button>
          </div>

          {/* Toppings Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 w-12 text-center">STT</th>
                    <th className="py-3 px-4">Tên topping</th>
                    <th className="py-3 px-4 text-right">Giá thêm</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredToppings.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-sm text-slate-500">
                        Chưa có topping nào. Nhấn "Thêm topping mới" để tạo danh sách topping (VD:
                        Trân châu trắng, Kem cheese, Thạch dừa, Espresso shot...).
                      </td>
                    </tr>
                  ) : (
                    filteredToppings.map((tp, idx) => (
                      <tr
                        key={tp.id}
                        className={`hover:bg-slate-50/70 transition-colors ${
                          !tp.available ? 'bg-slate-50/80' : ''
                        }`}
                      >
                        <td className="py-2.5 px-4 text-center tabular-nums text-xs text-slate-500">
                          {idx + 1}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-semibold ${
                            tp.available ? 'text-slate-900' : 'text-slate-400 line-through'
                          }`}
                        >
                          {tp.name}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-cyan-700">
                          +{formatVND(tp.price)}
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={tp.available}
                            onClick={() => handleToggleToppingAvailable(tp)}
                            title={tp.available ? 'Nhấn để tắt topping' : 'Nhấn để bật topping'}
                            className="inline-flex items-center gap-2 whitespace-nowrap group"
                          >
                            <span
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                                tp.available ? 'bg-cyan-600' : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                                  tp.available ? 'translate-x-4.5' : 'translate-x-1'
                                }`}
                              />
                            </span>
                            <span
                              className={`text-xs font-semibold ${
                                tp.available ? 'text-cyan-700' : 'text-amber-700'
                              }`}
                            >
                              {tp.available ? 'Đang bật' : 'Đã tắt'}
                            </span>
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {confirmDeleteToppingId === tp.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDeleteTopping(tp)}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
                              >
                                Xác nhận xóa
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteToppingId(null)}
                                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditToppingModal(tp)}
                                className="p-1.5 text-slate-500 hover:text-cyan-700 hover:bg-cyan-50 rounded-md transition-colors"
                                title="Chỉnh sửa topping"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteToppingId(tp.id)}
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                title="Xóa topping"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Add / Edit Menu Item Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSave}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {form.id
                  ? form.isCombo
                    ? 'Chỉnh sửa Combo'
                    : 'Chỉnh sửa món hàng'
                  : form.isCombo
                    ? 'Tạo món Combo mới'
                    : 'Thêm món hàng mới'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto pos-scroll space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên món <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value.slice(0, LIMITS.ITEM_NAME_MAX) }))
                    }
                    placeholder="VD: Trà đào cam sả"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã SKU <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.sku}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sku: e.target.value.toUpperCase().slice(0, LIMITS.SKU_MAX),
                      }))
                    }
                    placeholder="SB13"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Danh mục</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, category: e.target.value as MenuCategory }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-cyan-600"
                  >
                    {MENU_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Đơn vị tính
                  </label>
                  <input
                    type="text"
                    required
                    value={form.unit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, unit: e.target.value.slice(0, LIMITS.UNIT_MAX) }))
                    }
                    placeholder="Ly / Trái / Chai / Bình"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Giá bán (VNĐ) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={form.price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, price: formatDotNumber(e.target.value) }))
                    }
                    placeholder="35.000"
                    className="w-full pl-3 pr-9 py-2 text-sm font-semibold tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                    ₫
                  </span>
                </div>
              </div>

              {/* Combo Mode Toggle & Free Included Toppings Builder */}
              <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.isCombo}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((f) => ({
                        ...f,
                        isCombo: checked,
                        category: checked && f.category === 'Cà phê' ? 'Combo' : f.category,
                        unit: checked && f.unit === 'Ly' ? 'Combo' : f.unit,
                      }));
                    }}
                    className="w-4 h-4 mt-0.5 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Đây là món Combo (chọn thành phần / topping kèm theo không tính tiền)
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Các topping được chọn sẽ tự động in dưới tên Combo dạng <strong>+ Cơm sườn, + Bì, + Chả...</strong> với giá 0 ₫.
                    </div>
                  </div>
                </label>

                {form.isCombo && (
                  <div className="space-y-3 pt-2 border-t border-orange-200/80">
                    {/* Selection Rule: Fixed all vs Pick up to N */}
                    <div className="bg-white border border-orange-200 rounded-md p-2.5 space-y-2">
                      <div className="text-[11px] font-bold text-slate-800">
                        Quy tắc chọn topping khi bán Combo trên POS:
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, comboMaxToppings: 0 }))}
                          className={`px-2.5 py-2 rounded-md border text-left transition-colors ${
                            form.comboMaxToppings === 0
                              ? 'bg-orange-50 border-orange-500 text-orange-950'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold">Mặc định chọn sẵn tất cả</div>
                          <div className="text-[10.5px] text-slate-500 mt-0.5">
                            VD: Combo No Nê (tự gắn đủ sườn, bì, chả, canh)
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              comboMaxToppings: f.comboMaxToppings > 0 ? f.comboMaxToppings : 2,
                            }))
                          }
                          className={`px-2.5 py-2 rounded-md border text-left transition-colors ${
                            form.comboMaxToppings > 0
                              ? 'bg-orange-50 border-orange-500 text-orange-950'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold">Giới hạn chọn tối đa N món</div>
                          <div className="text-[10.5px] text-slate-500 mt-0.5">
                            VD: Combo 2 món kèm (chỉ chọn tối đa 2 topping)
                          </div>
                        </button>
                      </div>

                      {form.comboMaxToppings > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-orange-100">
                          <span className="text-xs font-semibold text-slate-700">
                            Số topping tối đa được chọn (0 ₫):
                          </span>
                          <div className="inline-flex items-center gap-1.5">
                            {[1, 2, 3, 4].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setForm((f) => ({ ...f, comboMaxToppings: n }))}
                                className={`w-8 h-7 rounded text-xs font-bold tabular-nums border transition-colors ${
                                  form.comboMaxToppings === n
                                    ? 'bg-orange-500 text-white border-orange-600'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-orange-50'
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                            <input
                              type="number"
                              min={1}
                              max={LIMITS.MAX_COMBO_TOPPINGS}
                              value={form.comboMaxToppings}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  comboMaxToppings: clampNumber(
                                    Number(e.target.value) || 1,
                                    1,
                                    LIMITS.MAX_COMBO_TOPPINGS,
                                  ),
                                }))
                              }
                              aria-label="Số topping tối đa"
                              className="w-14 h-7 px-2 text-xs font-bold tabular-nums text-center border border-slate-300 rounded focus:outline-none focus:border-orange-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Selected Combo Toppings */}
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 mb-1.5">
                        <span>
                          {form.comboMaxToppings > 0
                            ? `Danh sách topping được phép chọn (${form.comboToppings.length}/${LIMITS.MAX_COMBO_TOPPINGS})`
                            : `Thành phần trong Combo (${form.comboToppings.length}/${LIMITS.MAX_COMBO_TOPPINGS})`}
                        </span>
                        <span className="text-orange-700">Miễn phí (0 ₫)</span>
                      </div>
                      {form.comboToppings.length === 0 ? (
                        <div className="text-xs text-slate-500 bg-white border border-dashed border-orange-300 rounded-md px-3 py-2.5 text-center">
                          Chưa có thành phần nào. Nhập nhanh bên dưới hoặc chọn từ danh sách Topping / Món có sẵn.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 bg-white border border-orange-200 rounded-md p-2">
                          {form.comboToppings.map((ct) => (
                            <span
                              key={ct.id}
                              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-semibold bg-orange-50 text-slate-900 border border-orange-200 rounded-md"
                            >
                              <span>+ {ct.name}</span>
                              <button
                                type="button"
                                onClick={() => toggleComboTopping(ct)}
                                className="p-0.5 text-slate-400 hover:text-red-600 rounded"
                                aria-label={`Xóa ${ct.name}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Quick Add Custom Combo Topping */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={customComboToppingName}
                        onChange={(e) =>
                          setCustomComboToppingName(e.target.value.slice(0, LIMITS.TOPPING_NAME_MAX))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomComboTopping();
                          }
                        }}
                        placeholder="Nhập thành phần mới (VD: Cơm sườn, Bì, Chả, Canh rong biển...)"
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomComboTopping}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-md whitespace-nowrap"
                      >
                        + Thêm
                      </button>
                    </div>

                    {/* Source Switcher: Existing Toppings vs Existing Menu Items */}
                    <div className="space-y-1.5">
                      <div className="inline-flex rounded-md bg-white border border-slate-200 p-0.5 text-[11px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setComboPickerSource('toppings')}
                          className={`px-2.5 py-1 rounded transition-colors ${
                            comboPickerSource === 'toppings'
                              ? 'bg-orange-500 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Chọn từ Topping ({toppings.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setComboPickerSource('menu')}
                          className={`px-2.5 py-1 rounded transition-colors ${
                            comboPickerSource === 'menu'
                              ? 'bg-orange-500 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Chọn từ Món có sẵn ({menuItems.filter((m) => !m.isCombo && m.id !== form.id).length})
                        </button>
                      </div>

                      {comboPickerSource === 'toppings' ? (
                        toppings.length === 0 ? (
                          <div className="text-[11px] text-slate-500 py-1.5">
                            Chưa có topping nào trong danh mục Topping. Bạn có thể nhập nhanh ở ô trên.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pos-scroll pr-0.5">
                            {toppings.map((tp) => {
                              const selected = form.comboToppings.some((t) => t.id === tp.id);
                              return (
                                <button
                                  key={tp.id}
                                  type="button"
                                  onClick={() => toggleComboTopping({ id: tp.id, name: tp.name })}
                                  className={`px-2.5 py-1.5 rounded-md border text-left text-xs font-medium flex items-center justify-between gap-1 transition-colors ${
                                    selected
                                      ? 'bg-orange-100 border-orange-500 text-orange-950 font-semibold'
                                      : 'bg-white border-slate-200 text-slate-700 hover:border-orange-400'
                                  }`}
                                >
                                  <span className="truncate">{tp.name}</span>
                                  {selected && <Check className="w-3.5 h-3.5 text-orange-600 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        )
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pos-scroll pr-0.5">
                          {menuItems
                            .filter((m) => !m.isCombo && m.id !== form.id)
                            .map((mi) => {
                              const comboId = `mi_${mi.id}`;
                              const selected = form.comboToppings.some((t) => t.id === comboId);
                              return (
                                <button
                                  key={mi.id}
                                  type="button"
                                  onClick={() => toggleComboTopping({ id: comboId, name: mi.name })}
                                  className={`px-2.5 py-1.5 rounded-md border text-left text-xs font-medium flex items-center justify-between gap-1 transition-colors ${
                                    selected
                                      ? 'bg-orange-100 border-orange-500 text-orange-950 font-semibold'
                                      : 'bg-white border-slate-200 text-slate-700 hover:border-orange-400'
                                  }`}
                                >
                                  <span className="truncate">{mi.name}</span>
                                  {selected && <Check className="w-3.5 h-3.5 text-orange-600 shrink-0" />}
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Studio Image Gallery Picker */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Chọn ảnh minh họa có sẵn
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {STUDIO_MENU_IMAGES.map((img) => {
                    const selected = form.imageUrl === img.url;
                    return (
                      <button
                        key={img.url}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, imageUrl: selected ? '' : img.url }))
                        }
                        className={`relative rounded-lg overflow-hidden border text-left transition-all ${
                          selected
                            ? 'border-cyan-600 ring-2 ring-cyan-600/20'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <img
                          src={resolveAssetUrl(img.url)}
                          alt={img.label}
                          referrerPolicy="no-referrer"
                          className="w-full aspect-[4/3] object-cover"
                        />
                        {selected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                        <div className="px-2 py-1 text-[11px] font-medium text-slate-700 truncate bg-white">
                          {img.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Hoặc dán đường dẫn ảnh (URL)
                </label>
                <input
                  type="text"
                  value={form.imageUrl}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      imageUrl: e.target.value.slice(0, LIMITS.IMAGE_URL_MAX),
                    }))
                  }
                  placeholder="Để trống để dùng ảnh mặc định theo danh mục"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>

              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.available}
                  onChange={(e) => setForm((f) => ({ ...f, available: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-600"
                />
                <span className="text-xs font-medium text-slate-700">
                  Mở bán ngay trên màn hình POS
                </span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-lg"
              >
                {saving ? 'Đang lưu...' : form.id ? 'Lưu thay đổi' : 'Thêm vào thực đơn'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add / Edit Topping Modal */}
      {toppingModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveTopping}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {toppingForm.id ? 'Chỉnh sửa topping' : 'Thêm topping mới'}
              </h3>
              <button
                type="button"
                onClick={() => setToppingModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên topping <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={toppingForm.name}
                  onChange={(e) =>
                    setToppingForm((f) => ({
                      ...f,
                      name: e.target.value.slice(0, LIMITS.TOPPING_NAME_MAX),
                    }))
                  }
                  placeholder="VD: Trân châu trắng, Kem cheese, Thạch dừa..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Giá bán thêm (VNĐ) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={toppingForm.price}
                    onChange={(e) =>
                      setToppingForm((f) => ({ ...f, price: formatDotNumber(e.target.value) }))
                    }
                    placeholder="10.000"
                    className="w-full pl-3 pr-9 py-2 text-sm font-semibold tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-600"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                    ₫
                  </span>
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={toppingForm.available}
                  onChange={(e) =>
                    setToppingForm((f) => ({ ...f, available: e.target.checked }))
                  }
                  className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-600"
                />
                <span className="text-xs font-medium text-slate-700">
                  Mở bán topping này tại quầy POS
                </span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToppingModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingTopping}
                className="px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-lg"
              >
                {savingTopping ? 'Đang lưu...' : toppingForm.id ? 'Lưu thay đổi' : 'Thêm topping'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
