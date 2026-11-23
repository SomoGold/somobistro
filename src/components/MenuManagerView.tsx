import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, Check } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import { formatDotNumber, formatVND, generateDocId, parseDotNumber, resolveAssetUrl } from '../lib/format';
import {
  clampNumber,
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
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<MenuFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.sku.localeCompare(b.sku, 'vi', { numeric: true }));
  }, [menuItems, search, categoryFilter]);

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
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSku = sanitizeText(form.sku, LIMITS.SKU_MAX).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanName = sanitizeText(form.name, LIMITS.ITEM_NAME_MAX);
    const cleanUnit = sanitizeText(form.unit || 'Ly', LIMITS.UNIT_MAX);
    const cleanImg = sanitizeText(form.imageUrl, LIMITS.IMAGE_URL_MAX);
    const price = clampNumber(parseDotNumber(form.price), 0, LIMITS.MAX_PRICE);
    const cost = clampNumber(form.existingCost, 0, LIMITS.MAX_PRICE);

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
          updatedAt: serverTimestamp(),
        });
        onNotify(`Đã cập nhật món "${cleanName}".`);
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onNotify(`Đã thêm món "${cleanName}" vào thực đơn.`);
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
          ? `Đã mở bán lại "${item.name}".`
          : `Đã đánh dấu tạm hết "${item.name}".`,
      );
    } catch (error) {
      reportFirestoreError(error, OperationType.UPDATE, `menuItems/${item.id}`);
      onNotify('Không thể cập nhật trạng thái món.', 'error');
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
          ? `Đã mở bán lại topping "${tp.name}".`
          : `Đã tạm ngưng topping "${tp.name}".`,
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
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Tổng số món</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
            {summary.total}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Đang mở bán</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-cyan-600">
            {summary.active}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Tạm hết hàng</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-amber-600">
            {summary.outOfStock}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Danh mục Topping</div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
            {summary.toppingsTotal}
          </div>
        </div>
      </div>

      {activeSubTab === 'items' ? (
        <>
          {/* Controls Toolbar */}
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

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
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

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Thêm món mới
        </button>
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
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
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
                              className="w-full h-full"
                            />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{item.name}</div>
                            <div className="text-xs text-slate-500">ĐVT: {item.unit}</div>
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
                          onClick={() => handleToggleAvailable(item)}
                          className={`text-xs font-semibold hover:underline whitespace-nowrap ${
                            item.available ? 'text-cyan-700' : 'text-amber-700'
                          }`}
                        >
                          {item.available ? 'Đang bán' : 'Tạm hết'}
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
                      <tr key={tp.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-4 text-center tabular-nums text-xs text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{tp.name}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-cyan-700">
                          +{formatVND(tp.price)}
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleToppingAvailable(tp)}
                            className={`text-xs font-semibold hover:underline whitespace-nowrap ${
                              tp.available ? 'text-cyan-700' : 'text-amber-700'
                            }`}
                          >
                            {tp.available ? 'Đang bán' : 'Tạm hết'}
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
                {form.id ? 'Chỉnh sửa món hàng' : 'Thêm món hàng mới'}
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
