import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Home,
  UtensilsCrossed,
  BarChart3,
  Menu as MenuIcon,
  Search,
  X,
  Plus,
  Minus,
  ArrowRightLeft,
  Combine,
  ReceiptText,
  Settings,
  LogOut,
  ShoppingBag,
  Users,
  Clock,
  CheckCircle2,
  Save,
  CreditCard,
  UserCheck,
  UserPlus,
  LayoutGrid,
  Power,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import {
  calculateOrderTotals,
  formatDisplayTime,
  formatDotNumber,
  formatVND,
  generateDocId,
  generateOrderNumber,
  getDateKey,
  getItemDiscountAmount,
  getItemGrossTotal,
  getItemNetTotal,
  getItemUnitPrice,
  getMonthKey,
  normalizeOrderItemForSave,
  parseDotNumber,
} from '../lib/format';
import {
  clampNumber,
  ComboSelectionRule,
  Customer,
  DiningTable,
  DiscountType,
  LIMITS,
  MENU_CATEGORIES,
  MenuCategory,
  MenuItem,
  NavTab,
  Order,
  OrderItem,
  PaymentMethod,
  sanitizeText,
  StoreSettings,
  TABLE_ZONES,
  TableZone,
  Topping,
} from '../types/pos';
import { MenuThumbnail } from './MenuThumbnail';
import { KasItemModal } from './KasItemModal';
import { KasAddTableModal, KasCancelBillModal, KasTransferMergeModal } from './KasTableModals';
import { KasPaymentPanel } from './KasPaymentPanel';

type KasViewMode = 'floor' | 'menu' | 'payment';
type ZoneFilter = 'Tất cả' | TableZone | 'Mang về';

type ModalItemState =
  | { mode: 'new'; item: OrderItem }
  | { mode: 'edit'; index: number; item: OrderItem };

interface PosTerminalProps {
  ownerId: string;
  cashierName: string;
  userEmail: string;
  menuItems: MenuItem[];
  toppings: Topping[];
  customers: Customer[];
  tables: DiningTable[];
  orders: Order[];
  settings: StoreSettings | null;
  selectedTableId: string;
  todayRevenue: number;
  todayOrderCount: number;
  onSelectTableId: (tableId: string) => void;
  onNavigateTab: (tab: NavTab) => void;
  onPrintReceipt: (order: Order, isProvisional: boolean) => void;
  onOpenCreateAccount: () => void;
  onSignOut: () => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

function getEffectiveComboRule(item?: MenuItem | null): ComboSelectionRule {
  if (!item?.isCombo) return 'all';
  if (item.comboRule) return item.comboRule;
  return (item.comboMaxToppings ?? 0) > 0 ? 'max' : 'all';
}

function formatKasClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${hh}:${mm}:${ss} - ${dd}/${mo}/${yyyy}`;
}

export function PosTerminal({
  ownerId,
  cashierName,
  userEmail,
  menuItems,
  toppings,
  customers,
  tables,
  orders,
  settings,
  selectedTableId,
  todayRevenue,
  todayOrderCount,
  onSelectTableId,
  onNavigateTab,
  onPrintReceipt,
  onOpenCreateAccount,
  onSignOut,
  onNotify,
}: PosTerminalProps) {
  const [viewMode, setViewMode] = useState<KasViewMode>('floor');
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('Tất cả');
  const [tableSearch, setTableSearch] = useState('');
  const [menuSearch, setMenuSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<'Tất cả' | MenuCategory>('Tất cả');
  const [toggleStockMode, setToggleStockMode] = useState(false);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);

  // Active ticket state
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [vatRate, setVatRate] = useState<number>(settings?.defaultVatRate ?? 0);
  const [paymentMethod, setPaymentMethod] = useState<Exclude<PaymentMethod, 'unpaid'>>('cash');
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [orderNote, setOrderNote] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Modals & drawers
  const [modalItemState, setModalItemState] = useState<ModalItemState | null>(null);
  const [showAddTable, setShowAddTable] = useState(false);
  const [transferMode, setTransferMode] = useState<null | 'move' | 'merge'>(null);
  const [showCancelBillModal, setShowCancelBillModal] = useState(false);
  const [confirmDeleteItemIdx, setConfirmDeleteItemIdx] = useState<number | null>(null);
  const [showFunctionsDrawer, setShowFunctionsDrawer] = useState(false);

  // Live clock
  const [clockText, setClockText] = useState(() => formatKasClock(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setClockText(formatKasClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Track last loaded table/order signature
  const loadedContextRef = useRef<string>('');

  const openOrdersByTable = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach((o) => {
      if (o.status === 'open' && o.tableId) {
        map.set(o.tableId, o);
      }
    });
    return map;
  }, [orders]);

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) ?? null,
    [tables, selectedTableId],
  );

  const activeOpenOrder = useMemo(() => {
    if (!selectedTable) return null;
    if (selectedTable.activeOrderId) {
      const direct = orders.find(
        (o) => o.id === selectedTable.activeOrderId && o.status === 'open',
      );
      if (direct) return direct;
    }
    return openOrdersByTable.get(selectedTable.id) ?? null;
  }, [selectedTable, orders, openOrdersByTable]);

  // Synchronize ticket state when switching tables or when the remote open order updates
  useEffect(() => {
    const remoteSig = `${selectedTableId || 'takeaway'}::${activeOpenOrder?.id ?? 'none'}::${
      activeOpenOrder?.updatedAt?.toMillis?.() ?? activeOpenOrder?.items.length ?? 0
    }`;
    if (loadedContextRef.current === remoteSig) return;
    loadedContextRef.current = remoteSig;

    if (activeOpenOrder) {
      setCartItems(
        activeOpenOrder.items.map((item) => ({
          ...item,
          toppings: item.toppings ? item.toppings.map((t) => ({ ...t })) : [],
          discountType: item.discountType ?? 'percent',
          discountValue: item.discountValue ?? 0,
          discountAmount: item.discountAmount ?? 0,
        })),
      );
      setDiscountType(activeOpenOrder.discountType);
      setDiscountValue(activeOpenOrder.discountValue);
      setVatRate(activeOpenOrder.vatRate);
      setSelectedCustomerId(activeOpenOrder.customerId || '');
      setCustomerName(activeOpenOrder.customerName || '');
      setOrderNote(activeOpenOrder.note || '');
      setCashReceivedInput('');
      setIsDirty(false);
    } else {
      setCartItems([]);
      setDiscountType('percent');
      setDiscountValue(0);
      setVatRate(settings?.defaultVatRate ?? 0);
      setSelectedCustomerId('');
      setCustomerName('');
      setOrderNote('');
      setCashReceivedInput('');
      setIsDirty(false);
    }
    setModalItemState(null);
    setConfirmDeleteItemIdx(null);
  }, [selectedTableId, activeOpenOrder, settings?.defaultVatRate]);

  // Close open modal on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmDeleteItemIdx !== null) {
        setConfirmDeleteItemIdx(null);
      } else if (modalItemState) {
        setModalItemState(null);
      } else if (showAddTable) {
        setShowAddTable(false);
      } else if (transferMode) {
        setTransferMode(null);
      } else if (showCancelBillModal) {
        setShowCancelBillModal(false);
      } else if (showFunctionsDrawer) {
        setShowFunctionsDrawer(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmDeleteItemIdx,
    modalItemState,
    showAddTable,
    transferMode,
    showCancelBillModal,
    showFunctionsDrawer,
  ]);

  // Totals
  const totals = useMemo(
    () => calculateOrderTotals(cartItems, discountType, discountValue, vatRate),
    [cartItems, discountType, discountValue, vatRate],
  );

  const totalQty = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty, 0),
    [cartItems],
  );

  const parsedCashReceived = useMemo(() => {
    if (!cashReceivedInput.trim()) return totals.total;
    return parseDotNumber(cashReceivedInput);
  }, [cashReceivedInput, totals.total]);

  const changeAmount = Math.max(0, parsedCashReceived - totals.total);

  // Filtered tables
  const filteredTables = useMemo(() => {
    const kw = tableSearch.trim().toLowerCase();
    return tables.filter((tbl) => {
      if (zoneFilter === 'Mang về') return false;
      if (zoneFilter !== 'Tất cả' && tbl.zone !== zoneFilter) return false;
      if (kw && !tbl.name.toLowerCase().includes(kw) && !tbl.zone.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
  }, [tables, zoneFilter, tableSearch]);

  const occupiedCountByZone = useMemo(() => {
    const counts: Record<string, number> = { 'Tất cả': 0 };
    TABLE_ZONES.forEach((z) => {
      counts[z] = 0;
    });
    tables.forEach((t) => {
      const hasOpen = t.status === 'occupied' || openOrdersByTable.has(t.id);
      if (hasOpen) {
        counts['Tất cả'] += 1;
        counts[t.zone] = (counts[t.zone] || 0) + 1;
      }
    });
    return counts;
  }, [tables, openOrdersByTable]);

  // Filtered menu items
  const availableMenuItems = useMemo(
    () => menuItems.filter((m) => m.available),
    [menuItems],
  );

  const outOfStockCount = useMemo(
    () => menuItems.filter((m) => !m.available).length,
    [menuItems],
  );

  const displayedBaseMenuItems = toggleStockMode ? menuItems : availableMenuItems;

  const filteredMenuItems = useMemo(() => {
    const kw = menuSearch.trim().toLowerCase();
    return displayedBaseMenuItems.filter((item) => {
      if (activeCategory !== 'Tất cả' && item.category !== activeCategory) return false;
      if (
        kw &&
        !item.name.toLowerCase().includes(kw) &&
        !item.sku.toLowerCase().includes(kw) &&
        !item.category.toLowerCase().includes(kw)
      ) {
        return false;
      }
      return true;
    });
  }, [displayedBaseMenuItems, activeCategory, menuSearch]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { 'Tất cả': displayedBaseMenuItems.length };
    MENU_CATEGORIES.forEach((c) => {
      map[c] = 0;
    });
    displayedBaseMenuItems.forEach((m) => {
      map[m.category] = (map[m.category] || 0) + 1;
    });
    return map;
  }, [displayedBaseMenuItems]);

  const handleToggleMenuItemAvailable = useCallback(
    async (menuItem: MenuItem) => {
      if (togglingItemId === menuItem.id) return;
      setTogglingItemId(menuItem.id);
      const nextAvailable = !menuItem.available;
      try {
        await updateDoc(doc(db, 'menuItems', menuItem.id), {
          available: nextAvailable,
          updatedAt: serverTimestamp(),
        });
        onNotify(
          nextAvailable
            ? `Đã bật món "${menuItem.name}" để bán lại.`
            : `Đã tắt món "${menuItem.name}" (tạm hết).`,
        );
      } catch (error) {
        reportFirestoreError(error, OperationType.UPDATE, `menuItems/${menuItem.id}`);
        onNotify('Không thể cập nhật trạng thái món. Vui lòng thử lại.', 'error');
      } finally {
        setTogglingItemId(null);
      }
    },
    [togglingItemId, onNotify],
  );

  const handleEnableAllMenuItems = useCallback(async () => {
    const disabledItems = menuItems.filter((m) => !m.available);
    if (disabledItems.length === 0 || togglingItemId === '__all__') return;
    setTogglingItemId('__all__');
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
      onNotify(`Đã bật bán lại toàn bộ ${disabledItems.length} món.`);
    } catch (error) {
      reportFirestoreError(error, OperationType.UPDATE, 'menuItems/batch-enable');
      onNotify('Không thể bật lại tất cả món. Vui lòng thử lại.', 'error');
    } finally {
      setTogglingItemId(null);
    }
  }, [menuItems, togglingItemId, onNotify]);

  const cartQtyByItemId = useMemo(() => {
    const map = new Map<string, number>();
    cartItems.forEach((item) => {
      map.set(item.itemId, (map.get(item.itemId) || 0) + item.qty);
    });
    return map;
  }, [cartItems]);

  // ---------------- CART & ITEM POPUP ACTIONS ----------------
  // Clicking any menu item immediately opens KasItemModal (pre-loading free toppings only for fixed Combos)
  const handleSelectMenuItem = useCallback((menuItem: MenuItem) => {
    const effectiveRule = getEffectiveComboRule(menuItem);
    const isPickableCombo =
      Boolean(menuItem.isCombo) && effectiveRule !== 'all' && (menuItem.comboMaxToppings ?? 0) > 0;
    const comboToppings =
      menuItem.isCombo &&
      !isPickableCombo &&
      menuItem.comboToppings &&
      menuItem.comboToppings.length > 0
        ? menuItem.comboToppings.slice(0, LIMITS.MAX_ITEM_TOPPINGS).map((ct) => ({
            id: ct.id,
            name: ct.name,
            price: 0,
          }))
        : [];
    const freshItem: OrderItem = {
      itemId: menuItem.id,
      name: menuItem.name,
      category: menuItem.category,
      price: menuItem.price,
      cost: menuItem.cost,
      qty: 1,
      note: '',
      toppings: comboToppings,
      discountType: 'percent',
      discountValue: 0,
      discountAmount: 0,
    };
    setModalItemState({ mode: 'new', item: freshItem });
  }, []);

  const removeCartItem = useCallback((idx: number) => {
    setIsDirty(true);
    setCartItems((prev) => prev.filter((_, i) => i !== idx));
    setModalItemState((curr) => {
      if (!curr || curr.mode !== 'edit') return curr;
      if (curr.index === idx) return null;
      return curr.index > idx ? { ...curr, index: curr.index - 1 } : curr;
    });
  }, []);

  const adjustCartItemQty = useCallback((idx: number, delta: number) => {
    setIsDirty(true);
    setCartItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const nextQty = Math.min(999, Math.max(1, it.qty + delta));
        const updated = { ...it, qty: nextQty };
        updated.discountAmount = getItemDiscountAmount(updated);
        return updated;
      }),
    );
  }, []);

  const handleConfirmModalItem = useCallback(
    (updated: OrderItem) => {
      if (!modalItemState) return;
      setIsDirty(true);

      if (modalItemState.mode === 'edit') {
        const targetIdx = modalItemState.index;
        setCartItems((prev) => prev.map((it, idx) => (idx === targetIdx ? updated : it)));
      } else {
        setCartItems((prev) => {
          const getToppingSig = (it: OrderItem) =>
            (it.toppings ?? [])
              .map((t) => `${t.id}:${t.price}`)
              .sort()
              .join('|');

          const isMergeable =
            !updated.note.trim() && !(updated.discountValue && updated.discountValue > 0);
          if (isMergeable) {
            const updatedSig = getToppingSig(updated);
            const matchIdx = prev.findIndex(
              (i) =>
                i.itemId === updated.itemId &&
                !i.note.trim() &&
                !(i.discountValue && i.discountValue > 0) &&
                getToppingSig(i) === updatedSig,
            );
            if (matchIdx >= 0) {
              return prev.map((item, idx) =>
                idx === matchIdx
                  ? { ...item, qty: Math.min(999, item.qty + updated.qty) }
                  : item,
              );
            }
          }
          if (prev.length >= LIMITS.MAX_ORDER_ITEMS) {
            onNotify(`Mỗi hóa đơn tối đa ${LIMITS.MAX_ORDER_ITEMS} dòng món.`, 'error');
            return prev;
          }
          return [...prev, updated];
        });
      }

      setModalItemState(null);
    },
    [modalItemState, onNotify],
  );

  const handleDeleteModalItem = useCallback(() => {
    if (!modalItemState) return;
    if (modalItemState.mode === 'edit') {
      removeCartItem(modalItemState.index);
    }
    setModalItemState(null);
  }, [modalItemState, removeCartItem]);

  // Customer selection in Payment screen (auto-applies default discount)
  const handleSelectCustomer = useCallback(
    (customer: Customer | null) => {
      setIsDirty(true);
      if (!customer) {
        setSelectedCustomerId('');
        return;
      }
      setSelectedCustomerId(customer.id);
      setCustomerName(customer.name);
      if (customer.defaultDiscountValue > 0) {
        setDiscountType(customer.defaultDiscountType);
        setDiscountValue(customer.defaultDiscountValue);
      }
    },
    [],
  );

  // ---------------- PREVIEW / PRINT HELPERS ----------------
  const buildOrderSnapshot = useCallback((): Order => {
    const nowDate = new Date();
    const normalizedItems = cartItems
      .slice(0, LIMITS.MAX_ORDER_ITEMS)
      .map(normalizeOrderItemForSave);
    return {
      id: activeOpenOrder?.id ?? 'preview',
      ownerId,
      orderNumber: activeOpenOrder?.orderNumber ?? generateOrderNumber(nowDate, orders),
      orderType: selectedTable ? 'dine_in' : 'takeaway',
      tableId: selectedTable?.id ?? '',
      tableName: selectedTable?.name ?? 'Mang về',
      status: activeOpenOrder?.status ?? 'open',
      items: normalizedItems,
      subtotal: totals.subtotal,
      costTotal: totals.costTotal,
      discountType,
      discountValue,
      discountAmount: totals.discountAmount,
      vatRate,
      vatAmount: totals.vatAmount,
      total: totals.total,
      paymentMethod: viewMode === 'payment' ? paymentMethod : 'unpaid',
      cashReceived: paymentMethod === 'cash' ? parsedCashReceived : totals.total,
      changeAmount: paymentMethod === 'cash' ? changeAmount : 0,
      customerId: selectedCustomerId || '',
      customerName: sanitizeText(customerName, LIMITS.CUSTOMER_NAME_MAX),
      note: sanitizeText(orderNote, LIMITS.ORDER_NOTE_MAX),
      cancelReason: '',
      dateKey: getDateKey(nowDate),
      monthKey: getMonthKey(nowDate),
      hourOfDay: nowDate.getHours(),
      displayTime: formatDisplayTime(nowDate),
      cashierName: sanitizeText(cashierName || 'Thu ngân', LIMITS.CUSTOMER_NAME_MAX),
    };
  }, [
    activeOpenOrder,
    cartItems,
    cashierName,
    changeAmount,
    customerName,
    discountType,
    discountValue,
    orderNote,
    orders,
    ownerId,
    parsedCashReceived,
    paymentMethod,
    selectedCustomerId,
    selectedTable,
    totals,
    vatRate,
    viewMode,
  ]);

  const handlePrintProvisional = useCallback(() => {
    if (cartItems.length === 0) {
      onNotify('Chưa có món nào để in tạm tính.', 'error');
      return;
    }
    onPrintReceipt(buildOrderSnapshot(), true);
  }, [buildOrderSnapshot, cartItems.length, onNotify, onPrintReceipt]);

  // ---------------- FIRESTORE OPERATIONS ----------------
  const handleSaveOpenTab = useCallback(async () => {
    if (isSubmitting) return;
    if (!selectedTable) {
      if (cartItems.length === 0) {
        onNotify('Vui lòng chọn ít nhất 1 món.', 'error');
        return;
      }
      setViewMode('payment');
      return;
    }
    if (cartItems.length === 0) {
      onNotify('Vui lòng chọn ít nhất 1 món trước khi lưu bàn.', 'error');
      return;
    }

    setIsSubmitting(true);
    const nowDate = new Date();
    const batch = writeBatch(db);
    const normalizedItems = cartItems
      .slice(0, LIMITS.MAX_ORDER_ITEMS)
      .map(normalizeOrderItemForSave);
    const safeDiscountType: DiscountType = discountType === 'fixed' ? 'fixed' : 'percent';
    const safeDiscountValue = clampNumber(
      discountValue,
      0,
      safeDiscountType === 'percent' ? 100 : 1_000_000_000,
    );
    const safeVatRate = clampNumber(vatRate, 0, 30);
    const safeCustomerId = sanitizeText(selectedCustomerId, 128);
    const safeCashier = sanitizeText(cashierName || 'Thu ngân', LIMITS.CUSTOMER_NAME_MAX) || 'Thu ngân';
    const safeHourOfDay = clampNumber(nowDate.getHours(), 0, 23);

    let targetPath = `orders + diningTables/${selectedTable.id}`;
    try {
      if (activeOpenOrder && activeOpenOrder.status === 'open') {
        targetPath = `orders/${activeOpenOrder.id} + diningTables/${selectedTable.id}`;
        batch.update(doc(db, 'orders', activeOpenOrder.id), {
          items: normalizedItems,
          subtotal: totals.subtotal,
          costTotal: totals.costTotal,
          discountType: safeDiscountType,
          discountValue: safeDiscountValue,
          discountAmount: totals.discountAmount,
          vatRate: safeVatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          customerId: safeCustomerId,
          customerName: sanitizeText(customerName, LIMITS.CUSTOMER_NAME_MAX),
          note: sanitizeText(orderNote, LIMITS.ORDER_NOTE_MAX),
          tableId: selectedTable.id,
          tableName: sanitizeText(selectedTable.name, LIMITS.TABLE_NAME_MAX) || 'Bàn',
          orderType: 'dine_in',
          updatedAt: serverTimestamp(),
        });
        if (selectedTable.status !== 'occupied' || selectedTable.activeOrderId !== activeOpenOrder.id) {
          batch.update(doc(db, 'diningTables', selectedTable.id), {
            status: 'occupied',
            activeOrderId: activeOpenOrder.id,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        const newOrderId = generateDocId('ord');
        targetPath = `orders/${newOrderId} + diningTables/${selectedTable.id}`;
        batch.set(doc(db, 'orders', newOrderId), {
          ownerId,
          orderNumber: generateOrderNumber(nowDate, orders),
          orderType: 'dine_in',
          tableId: selectedTable.id,
          tableName: sanitizeText(selectedTable.name, LIMITS.TABLE_NAME_MAX) || 'Bàn',
          status: 'open',
          items: normalizedItems,
          subtotal: totals.subtotal,
          costTotal: totals.costTotal,
          discountType: safeDiscountType,
          discountValue: safeDiscountValue,
          discountAmount: totals.discountAmount,
          vatRate: safeVatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paymentMethod: 'unpaid',
          cashReceived: 0,
          changeAmount: 0,
          customerId: safeCustomerId,
          customerName: sanitizeText(customerName, LIMITS.CUSTOMER_NAME_MAX),
          note: sanitizeText(orderNote, LIMITS.ORDER_NOTE_MAX),
          cancelReason: '',
          dateKey: getDateKey(nowDate),
          monthKey: getMonthKey(nowDate),
          hourOfDay: safeHourOfDay,
          displayTime: formatDisplayTime(nowDate),
          cashierName: safeCashier,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'diningTables', selectedTable.id), {
          status: 'occupied',
          activeOrderId: newOrderId,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setIsDirty(false);
    } catch (error) {
      const msg = reportFirestoreError(error, OperationType.WRITE, targetPath);
      onNotify(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    activeOpenOrder,
    cartItems,
    cashierName,
    customerName,
    discountType,
    discountValue,
    isSubmitting,
    onNotify,
    orderNote,
    orders,
    ownerId,
    selectedCustomerId,
    selectedTable,
    totals,
    vatRate,
  ]);

  const handleCheckout = useCallback(async () => {
    if (isSubmitting) return;
    if (cartItems.length === 0) {
      onNotify('Chưa có món nào trong đơn hàng.', 'error');
      return;
    }
    if (paymentMethod === 'cash' && parsedCashReceived < totals.total) {
      onNotify('Số tiền khách trả nhỏ hơn tổng phải thu.', 'error');
      return;
    }

    setIsSubmitting(true);
    const nowDate = new Date();
    const dateKey = getDateKey(nowDate);
    const monthKey = getMonthKey(nowDate);
    const displayTime = formatDisplayTime(nowDate);
    const safeHourOfDay = clampNumber(nowDate.getHours(), 0, 23);
    const safeCashier = sanitizeText(cashierName || 'Thu ngân', LIMITS.CUSTOMER_NAME_MAX) || 'Thu ngân';
    const safeDiscountType: DiscountType = discountType === 'fixed' ? 'fixed' : 'percent';
    const safeDiscountValue = clampNumber(
      discountValue,
      0,
      safeDiscountType === 'percent' ? 100 : 1_000_000_000,
    );
    const safeVatRate = clampNumber(vatRate, 0, 30);
    const finalCashReceived = clampNumber(
      paymentMethod === 'cash' ? parsedCashReceived : totals.total,
      0,
      1_000_000_000,
    );
    const finalChange = clampNumber(
      paymentMethod === 'cash' ? Math.max(0, finalCashReceived - totals.total) : 0,
      0,
      1_000_000_000,
    );
    const normalizedItems = cartItems
      .slice(0, LIMITS.MAX_ORDER_ITEMS)
      .map(normalizeOrderItemForSave);
    const safeCustomerId = sanitizeText(selectedCustomerId, 128);

    const batch = writeBatch(db);
    let completedOrder: Order;
    let targetPath = 'orders';
    let opType: OperationType = OperationType.WRITE;

    try {
      if (activeOpenOrder && activeOpenOrder.status === 'open' && selectedTable) {
        targetPath = `orders/${activeOpenOrder.id} + diningTables/${selectedTable.id}`;
        opType = OperationType.UPDATE;
        batch.update(doc(db, 'orders', activeOpenOrder.id), {
          items: normalizedItems,
          subtotal: totals.subtotal,
          costTotal: totals.costTotal,
          discountType: safeDiscountType,
          discountValue: safeDiscountValue,
          discountAmount: totals.discountAmount,
          vatRate: safeVatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          status: 'completed',
          paymentMethod,
          cashReceived: finalCashReceived,
          changeAmount: finalChange,
          customerId: safeCustomerId,
          customerName: sanitizeText(customerName, LIMITS.CUSTOMER_NAME_MAX),
          note: sanitizeText(orderNote, LIMITS.ORDER_NOTE_MAX),
          dateKey,
          monthKey,
          hourOfDay: safeHourOfDay,
          displayTime,
          cashierName: safeCashier,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'diningTables', selectedTable.id), {
          status: 'available',
          activeOrderId: '',
          updatedAt: serverTimestamp(),
        });

        completedOrder = {
          ...activeOpenOrder,
          items: normalizedItems,
          subtotal: totals.subtotal,
          costTotal: totals.costTotal,
          discountType: safeDiscountType,
          discountValue: safeDiscountValue,
          discountAmount: totals.discountAmount,
          vatRate: safeVatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          status: 'completed',
          paymentMethod,
          cashReceived: finalCashReceived,
          changeAmount: finalChange,
          customerId: safeCustomerId,
          customerName: sanitizeText(customerName, LIMITS.CUSTOMER_NAME_MAX),
          note: sanitizeText(orderNote, LIMITS.ORDER_NOTE_MAX),
          dateKey,
          monthKey,
          hourOfDay: safeHourOfDay,
          displayTime,
          cashierName: safeCashier,
        };
      } else {
        const newOrderId = generateDocId('ord');
        const newOrderNumber = generateOrderNumber(nowDate, orders);
        targetPath = `orders/${newOrderId}`;
        opType = OperationType.CREATE;
        const safeTableName = selectedTable
          ? sanitizeText(selectedTable.name, LIMITS.TABLE_NAME_MAX) || 'Bàn'
          : 'Mang về';

        const payload = {
          ownerId,
          orderNumber: newOrderNumber,
          orderType: (selectedTable ? 'dine_in' : 'takeaway') as 'dine_in' | 'takeaway',
          tableId: selectedTable?.id ?? '',
          tableName: safeTableName,
          status: 'completed' as const,
          items: normalizedItems,
          subtotal: totals.subtotal,
          costTotal: totals.costTotal,
          discountType: safeDiscountType,
          discountValue: safeDiscountValue,
          discountAmount: totals.discountAmount,
          vatRate: safeVatRate,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paymentMethod,
          cashReceived: finalCashReceived,
          changeAmount: finalChange,
          customerId: safeCustomerId,
          customerName: sanitizeText(customerName, LIMITS.CUSTOMER_NAME_MAX),
          note: sanitizeText(orderNote, LIMITS.ORDER_NOTE_MAX),
          cancelReason: '',
          dateKey,
          monthKey,
          hourOfDay: safeHourOfDay,
          displayTime,
          cashierName: safeCashier,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        batch.set(doc(db, 'orders', newOrderId), payload);
        if (selectedTable && selectedTable.status === 'occupied') {
          batch.update(doc(db, 'diningTables', selectedTable.id), {
            status: 'available',
            activeOrderId: '',
            updatedAt: serverTimestamp(),
          });
        }

        completedOrder = {
          id: newOrderId,
          ...payload,
          createdAt: null,
          updatedAt: null,
        };
      }

      await batch.commit();

      loadedContextRef.current = '';
      setCartItems([]);
      setDiscountValue(0);
      setSelectedCustomerId('');
      setCustomerName('');
      setOrderNote('');
      setCashReceivedInput('');
      setPaymentMethod('cash');
      setIsDirty(false);
      setViewMode('floor');
      onPrintReceipt(completedOrder, false);
    } catch (error) {
      const msg = reportFirestoreError(error, opType, targetPath);
      onNotify(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    activeOpenOrder,
    cartItems,
    cashierName,
    customerName,
    discountType,
    discountValue,
    isSubmitting,
    onNotify,
    onPrintReceipt,
    orderNote,
    orders,
    ownerId,
    parsedCashReceived,
    paymentMethod,
    selectedCustomerId,
    selectedTable,
    totals,
    vatRate,
  ]);

  const handleVoidOpenBill = useCallback(
    async (reason: string) => {
      if (isSubmitting || !activeOpenOrder || activeOpenOrder.status === 'cancelled') return;
      setIsSubmitting(true);
      const batch = writeBatch(db);
      const cleanReason = sanitizeText(reason, LIMITS.CANCEL_REASON_MAX) || 'Hủy bill';
      const tablesToRelease = tables.filter(
        (tbl) =>
          (tbl.id === selectedTable?.id ||
            tbl.id === activeOpenOrder.tableId ||
            tbl.activeOrderId === activeOpenOrder.id) &&
          (tbl.status !== 'available' || tbl.activeOrderId !== ''),
      );
      const targetPath =
        tablesToRelease.length > 0
          ? `orders/${activeOpenOrder.id} + diningTables/${tablesToRelease.map((t) => t.id).join(',')}`
          : `orders/${activeOpenOrder.id}`;

      try {
        batch.update(doc(db, 'orders', activeOpenOrder.id), {
          status: 'cancelled',
          cancelReason: cleanReason,
          updatedAt: serverTimestamp(),
        });
        tablesToRelease.forEach((tbl) => {
          batch.update(doc(db, 'diningTables', tbl.id), {
            status: 'available',
            activeOrderId: '',
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        loadedContextRef.current = '';
        setCartItems([]);
        setDiscountValue(0);
        setSelectedCustomerId('');
        setCustomerName('');
        setOrderNote('');
        setIsDirty(false);
        setShowCancelBillModal(false);
        setViewMode('floor');
      } catch (error) {
        const msg = reportFirestoreError(error, OperationType.WRITE, targetPath);
        onNotify(msg, 'error');
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeOpenOrder, isSubmitting, onNotify, selectedTable, tables],
  );

  const handleQuickAddCustomer = useCallback(
    async (name: string) => {
      const cleanName = sanitizeText(name, LIMITS.CUSTOMER_NAME_MAX);
      if (!cleanName) return;
      const newId = generateDocId('cust');
      try {
        await setDoc(doc(db, 'customers', newId), {
          ownerId,
          name: cleanName,
          phone: '',
          defaultDiscountType: 'percent',
          defaultDiscountValue: 0,
          note: 'Thêm nhanh tại quầy',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSelectedCustomerId(newId);
        setCustomerName(cleanName);
      } catch (error) {
        const msg = reportFirestoreError(error, OperationType.CREATE, `customers/${newId}`);
        onNotify(msg, 'error');
      }
    },
    [ownerId, onNotify],
  );

  const handleCancelOrderAction = useCallback(() => {
    if (activeOpenOrder) {
      setShowCancelBillModal(true);
      return;
    }
    if (cartItems.length > 0) {
      setCartItems([]);
      setDiscountValue(0);
      setSelectedCustomerId('');
      setCustomerName('');
      setOrderNote('');
      setIsDirty(false);
      return;
    }
    onNotify('Chưa có món hoặc bill nào để hủy.', 'error');
  }, [activeOpenOrder, cartItems.length, onNotify]);

  const handleOpenTransferMerge = useCallback(
    (mode: 'move' | 'merge') => {
      if (!selectedTable || !activeOpenOrder) {
        onNotify(
          mode === 'move'
            ? 'Chọn một bàn đang treo bill (màu cam) để chuyển bàn.'
            : 'Chọn một bàn đang treo bill (màu cam) để gộp bàn.',
          'error',
        );
        return;
      }
      setTransferMode(mode);
    },
    [activeOpenOrder, onNotify, selectedTable],
  );

  const handleSelectTableCard = (table: DiningTable) => {
    if (selectedTableId === table.id) {
      setViewMode('menu');
      return;
    }
    onSelectTableId(table.id);
  };

  const handleSelectTakeaway = () => {
    onSelectTableId('');
    setViewMode('menu');
  };

  const storeTitle = settings?.storeName || 'Somo Bistro';
  const totalDiscountCombined = totals.discountAmount + totals.itemDiscountTotal;
  const primaryMenuIsSave =
    viewMode === 'menu' && Boolean(selectedTable) && (!activeOpenOrder || isDirty);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-100 select-none">
      {/* MAIN 2-PANE WORKSPACE (SWAPPED: LEFT = FLOOR/MENU/PAYMENT, RIGHT = ORDER TICKET & PRICE) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ================= LEFT DYNAMIC WORKSPACE (FLOOR / MENU / PAYMENT) ================= */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white">
          {/* -------------------- MODE A: TABLE FLOOR PLAN -------------------- */}
          {viewMode === 'floor' && (
            <>
              {/* Top Deep-Navy Zone Tabs & Table Search Bar */}
              <div className="bg-[#091d4f] px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-blue-950 shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['Tất cả', ...TABLE_ZONES, 'Mang về'] as ZoneFilter[]).map((zone) => {
                    const active = zoneFilter === zone;
                    const busyCount = zone !== 'Mang về' ? occupiedCountByZone[zone] || 0 : 0;
                    return (
                      <button
                        key={zone}
                        type="button"
                        onClick={() => {
                          if (zone === 'Mang về') {
                            handleSelectTakeaway();
                            return;
                          }
                          setZoneFilter(zone);
                        }}
                        className={`h-10 px-4 rounded-md text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                          active
                            ? 'bg-orange-500 text-white border border-orange-300 shadow-xs'
                            : 'bg-[#132f7a] hover:bg-[#1c40a3] text-slate-100 border border-blue-800/80'
                        }`}
                      >
                        <span>{zone}</span>
                        {busyCount > 0 && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold tabular-nums ${
                              active ? 'bg-white/20 text-white' : 'bg-orange-500 text-white'
                            }`}
                          >
                            {busyCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <div className="relative w-44 sm:w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder="Tìm bàn..."
                      className="w-full h-9 pl-8 pr-7 text-xs bg-white text-slate-900 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                    {tableSearch && (
                      <button
                        type="button"
                        onClick={() => setTableSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        aria-label="Xóa tìm kiếm"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Legend Strip */}
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="w-3 h-3 rounded-xs bg-white border-2 border-slate-400" />
                    Bàn trống ({tables.length - (occupiedCountByZone['Tất cả'] || 0)})
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-orange-700">
                    <span className="w-3 h-3 rounded-xs bg-orange-500 border border-orange-600" />
                    Đang treo bill ({occupiedCountByZone['Tất cả'] || 0})
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#0d47a1]">
                    <span className="w-3 h-3 rounded-xs bg-[#0d47a1]" />
                    Bàn đang chọn
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Nhấn 1 lần để xem bill · Nhấn lần 2 hoặc <strong>Gọi món</strong> để chọn món
                </div>
              </div>

              {/* Table Cards Grid */}
              <div className="flex-1 overflow-y-auto pos-scroll p-3.5 bg-white">
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {/* Takeaway Quick Card */}
                  {!tableSearch.trim() && zoneFilter === 'Tất cả' && (
                    <button
                      type="button"
                      onClick={handleSelectTakeaway}
                      className={`min-h-[96px] rounded-md border-2 p-3 flex items-center gap-3 text-left transition-all ${
                        !selectedTableId
                          ? 'bg-[#0d47a1] text-white border-[#082c66] ring-2 ring-cyan-400 shadow-md'
                          : 'bg-cyan-50/70 hover:bg-cyan-50 text-cyan-950 border-cyan-300 hover:border-cyan-500'
                      }`}
                    >
                      <div
                        className={`w-11 h-11 rounded-md flex items-center justify-center shrink-0 ${
                          !selectedTableId
                            ? 'bg-white/15 text-cyan-200'
                            : 'bg-cyan-600 text-white'
                        }`}
                      >
                        <ShoppingBag className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold leading-tight truncate">Mang về</div>
                        <div
                          className={`text-xs mt-1 ${
                            !selectedTableId ? 'text-cyan-100' : 'text-cyan-800'
                          }`}
                        >
                          Bán nhanh tại quầy
                        </div>
                      </div>
                    </button>
                  )}

                  {filteredTables.map((table) => {
                    const openOrder = openOrdersByTable.get(table.id);
                    const isOccupied = table.status === 'occupied' || Boolean(openOrder);
                    const isSelected = selectedTableId === table.id;
                    const itemCount = openOrder
                      ? openOrder.items.reduce((s, i) => s + i.qty, 0)
                      : 0;

                    let cardClasses =
                      'bg-white hover:bg-cyan-50/40 text-slate-900 border-slate-300 hover:border-cyan-500';
                    if (isSelected) {
                      cardClasses =
                        'bg-[#0d47a1] text-white border-[#082c66] ring-2 ring-cyan-400 shadow-md';
                    } else if (isOccupied) {
                      cardClasses =
                        'bg-orange-500 hover:bg-orange-600 text-white border-orange-600 shadow-sm';
                    }

                    return (
                      <button
                        key={table.id}
                        type="button"
                        onClick={() => handleSelectTableCard(table)}
                        onDoubleClick={() => {
                          onSelectTableId(table.id);
                          setViewMode('menu');
                        }}
                        className={`min-h-[96px] rounded-md border-2 p-3 flex items-center gap-3 text-left transition-all ${cardClasses}`}
                      >
                        <div
                          className={`w-11 h-11 rounded-md flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-white/15 text-amber-300'
                              : isOccupied
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-100 text-cyan-700'
                          }`}
                        >
                          <Users className="w-5 h-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm font-bold leading-tight truncate ${
                              isSelected || isOccupied ? 'text-white' : 'text-cyan-800'
                            }`}
                          >
                            {table.name}
                          </div>

                          {isOccupied && openOrder ? (
                            <div className="mt-1 space-y-0.5">
                              <div className="text-[11px] font-semibold text-white/95 tabular-nums flex items-center gap-1 truncate">
                                <Clock className="w-3 h-3 shrink-0" />
                                {openOrder.displayTime}
                              </div>
                              <div className="text-xs font-extrabold tabular-nums text-amber-100">
                                {itemCount} món · {formatDotNumber(openOrder.total)} ₫
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`text-xs mt-1 ${
                                isSelected ? 'text-cyan-100' : 'text-slate-500'
                              }`}
                            >
                              {table.zone} · {table.seats} chỗ
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {filteredTables.length === 0 && zoneFilter !== 'Tất cả' && (
                  <div className="py-16 text-center text-sm text-slate-400">
                    Không tìm thấy bàn nào phù hợp trong khu vực này.
                  </div>
                )}
              </div>

              {/* Bottom Dark-Navy Action Bar (No F-key labels, No In kiểm bill) */}
              <div className="bg-[#071a42] border-t border-blue-950 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddTable(true)}
                  className="h-11 px-5 rounded-md bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  Thêm bàn
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('menu')}
                    className="h-11 px-5 rounded-md bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/60 text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                  >
                    <UtensilsCrossed className="w-4 h-4" />
                    Gọi món
                  </button>

                  <button
                    type="button"
                    disabled={!selectedTable || !activeOpenOrder}
                    onClick={() => handleOpenTransferMerge('move')}
                    className="h-11 px-4 rounded-md bg-[#112d75] hover:bg-[#193d99] disabled:opacity-45 border border-blue-700/70 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Chuyển bàn
                  </button>

                  <button
                    type="button"
                    disabled={!selectedTable || !activeOpenOrder}
                    onClick={() => handleOpenTransferMerge('merge')}
                    className="h-11 px-4 rounded-md bg-[#112d75] hover:bg-[#193d99] disabled:opacity-45 border border-blue-700/70 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Combine className="w-4 h-4" />
                    Gộp bàn
                  </button>
                </div>
              </div>
            </>
          )}

          {/* -------------------- MODE B: MENU ORDERING -------------------- */}
          {viewMode === 'menu' && (
            <>
              {/* Top Deep-Navy Bar */}
              <div className="bg-[#091d4f] px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-blue-950 shrink-0">
                <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
                  <span className="h-10 px-3 rounded-md bg-[#132f7a] border border-blue-800 text-cyan-200 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                    {selectedTable ? `${selectedTable.zone} · ${selectedTable.name}` : 'Mang về'}
                  </span>

                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      placeholder="Tìm món ăn, đồ uống..."
                      className="w-full h-10 pl-9 pr-9 text-sm bg-white text-slate-900 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                    {menuSearch && (
                      <button
                        type="button"
                        onClick={() => setMenuSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:bg-red-50 rounded"
                        aria-label="Xóa từ khóa"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setToggleStockMode((prev) => !prev)}
                    className={`h-10 px-3 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap border ${
                      toggleStockMode
                        ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-300 shadow-xs'
                        : 'bg-[#132f7a] hover:bg-[#1c40a3] text-white border-blue-700'
                    }`}
                    title="Tắt món tạm hết hoặc bật lại món trên POS"
                  >
                    <Power className="w-4 h-4 shrink-0" />
                    <span>{toggleStockMode ? 'Xong tắt/bật' : 'Tắt / Bật món'}</span>
                    {!toggleStockMode && outOfStockCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-extrabold tabular-nums">
                        {outOfStockCount} tắt
                      </span>
                    )}
                  </button>

                  {cartItems.length > 0 && !toggleStockMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setCashReceivedInput('');
                        setViewMode('payment');
                      }}
                      className="h-10 px-4 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Thanh toán ngay
                    </button>
                  )}
                </div>
              </div>

              {toggleStockMode && (
                <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-950">
                    <Power className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Chế độ <strong>Tắt / Bật món</strong>: Chạm trực tiếp vào món bên dưới để tắt
                      (tạm hết) hoặc bật bán lại.
                      {outOfStockCount > 0 && (
                        <strong className="ml-1.5 text-amber-800">
                          ({outOfStockCount} món đang tắt)
                        </strong>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {outOfStockCount > 0 && (
                      <button
                        type="button"
                        disabled={togglingItemId === '__all__'}
                        onClick={handleEnableAllMenuItems}
                        className="px-3 py-1 rounded-md bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 disabled:opacity-50 text-xs font-bold whitespace-nowrap"
                      >
                        {togglingItemId === '__all__'
                          ? 'Đang bật...'
                          : `Bật tất cả (${outOfStockCount})`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setToggleStockMode(false)}
                      className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold whitespace-nowrap"
                    >
                      Hoàn tất
                    </button>
                  </div>
                </div>
              )}

              {/* Far-Left Vertical Category Rail + Product Cards Grid */}
              <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Far-Left Vertical Category Rail + Pinned Khu vực bàn Button */}
                <div className="w-[120px] sm:w-[144px] bg-slate-100 border-r border-slate-200 p-2 flex flex-col justify-between gap-2 shrink-0">
                  <div className="flex-1 overflow-y-auto pos-scroll flex flex-col gap-1.5">
                    {(['Tất cả', ...MENU_CATEGORIES] as const).map((category) => {
                      const active = activeCategory === category;
                      const count = categoryCounts[category] || 0;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setActiveCategory(category)}
                          className={`w-full py-2.5 px-2.5 rounded-lg text-xs font-bold text-left leading-tight transition-all flex items-center justify-between gap-1.5 ${
                            active
                              ? 'bg-[#091d4f] text-white shadow-sm ring-1 ring-orange-400/70'
                              : 'bg-white hover:bg-cyan-50 text-slate-700 border border-slate-200/90 hover:border-cyan-300'
                          }`}
                        >
                          <span className="leading-snug">{category}</span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums shrink-0 ${
                              active
                                ? 'bg-orange-500 text-white'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setViewMode('floor')}
                    className="w-full py-3 px-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs border border-amber-500/70 shadow-xs flex items-center justify-center gap-1.5 leading-tight shrink-0 transition-colors"
                  >
                    <Home className="w-3.5 h-3.5 shrink-0" />
                    <span>Khu vực bàn</span>
                  </button>
                </div>

                {/* Product Cards Grid: Clicking any item opens KasItemModal directly (or toggles availability in toggleStockMode) */}
                <div className="flex-1 overflow-y-auto pos-scroll p-3 bg-slate-50/70">
                  {filteredMenuItems.length === 0 ? (
                    <div className="py-20 text-center space-y-2 text-slate-400">
                      <div className="text-sm font-semibold text-slate-600">
                        Không tìm thấy món phù hợp
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCategory('Tất cả');
                          setMenuSearch('');
                        }}
                        className="text-xs font-bold text-cyan-700 hover:underline"
                      >
                        Xem tất cả thực đơn
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2.5">
                      {filteredMenuItems.map((item) => {
                        const qtyInCart = cartQtyByItemId.get(item.id) || 0;
                        const isOff = !item.available;
                        const isToggling = togglingItemId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={isToggling}
                            onClick={() =>
                              toggleStockMode
                                ? handleToggleMenuItemAvailable(item)
                                : handleSelectMenuItem(item)
                            }
                            className={`border-2 rounded-lg p-2.5 flex items-stretch justify-between gap-2.5 text-left transition-all min-h-[100px] group disabled:opacity-60 ${
                              toggleStockMode
                                ? isOff
                                  ? 'bg-slate-100 border-dashed border-amber-400 opacity-80 hover:border-cyan-600'
                                  : 'bg-white border-cyan-500/80 hover:border-amber-500'
                                : qtyInCart > 0
                                  ? 'bg-cyan-50/30 border-cyan-600 shadow-xs'
                                  : 'bg-white border-slate-200 hover:border-cyan-500 hover:shadow-xs'
                            }`}
                          >
                            <div className="flex-1 flex flex-col justify-between min-w-0 py-0.5 pr-1">
                              <div>
                                <div className="flex items-start gap-1.5">
                                  <div
                                    className={`text-sm font-bold leading-snug line-clamp-2 ${
                                      isOff
                                        ? 'text-slate-500 line-through'
                                        : 'text-slate-900 group-hover:text-[#0a2268]'
                                    }`}
                                  >
                                    {item.name}
                                  </div>
                                  {item.isCombo && (() => {
                                    const rule = getEffectiveComboRule(item);
                                    const limit = item.comboMaxToppings ?? 0;
                                    const label =
                                      rule === 'exact' && limit > 0
                                        ? `Phải chọn ${limit}`
                                        : rule === 'max' && limit > 0
                                          ? `Tối đa ${limit}`
                                          : 'Combo';
                                    return (
                                      <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase bg-orange-100 text-orange-700 border border-orange-200 rounded shrink-0 mt-0.5">
                                        {label}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                                  {item.category} · {item.unit}
                                </div>
                                {item.isCombo && item.comboToppings && item.comboToppings.length > 0 && (() => {
                                  const rule = getEffectiveComboRule(item);
                                  const limit = item.comboMaxToppings ?? 0;
                                  const prefix =
                                    rule === 'exact' && limit > 0
                                      ? `Phải chọn ${limit}: `
                                      : rule === 'max' && limit > 0
                                        ? `Tối đa ${limit}: `
                                        : '';
                                  return (
                                    <div className="text-[11px] text-cyan-700 mt-0.5 line-clamp-1">
                                      {prefix}
                                      {item.comboToppings.map((ct) => ct.name).join(' · ')}
                                    </div>
                                  );
                                })()}
                              </div>

                              <div className="flex items-center justify-between gap-2 mt-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-base font-extrabold tabular-nums ${
                                      isOff ? 'text-slate-400' : 'text-slate-900'
                                    }`}
                                  >
                                    {formatDotNumber(item.price)} ₫
                                  </span>
                                  {!toggleStockMode && qtyInCart > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-cyan-600 text-white text-[11px] font-bold tabular-nums">
                                      ×{qtyInCart}
                                    </span>
                                  )}
                                </div>

                                {toggleStockMode && (
                                  <span className="inline-flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
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
                                      className={`text-[11px] font-bold ${
                                        item.available ? 'text-cyan-700' : 'text-amber-700'
                                      }`}
                                    >
                                      {item.available ? 'Bật' : 'Đã tắt'}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="relative w-24 h-20 shrink-0 rounded-md overflow-hidden border border-slate-200 self-center">
                              <MenuThumbnail
                                src={item.imageUrl}
                                alt={item.name}
                                category={item.category}
                                className={`w-24 h-20 ${isOff ? 'grayscale opacity-50' : ''}`}
                              />
                              {isOff && (
                                <span className="absolute inset-x-1 bottom-1 py-0.5 text-center rounded bg-amber-600/95 text-white text-[10px] font-extrabold uppercase tracking-wide">
                                  Đã tắt
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* -------------------- MODE C: PAYMENT SCREEN -------------------- */}
          {viewMode === 'payment' && (
            <KasPaymentPanel
              ownerId={ownerId}
              cashierName={cashierName}
              settings={settings}
              customers={customers}
              selectedCustomerId={selectedCustomerId}
              subtotal={totals.subtotal}
              itemDiscountTotal={totals.itemDiscountTotal}
              discountType={discountType}
              discountValue={discountValue}
              discountAmount={totals.discountAmount}
              vatRate={vatRate}
              vatAmount={totals.vatAmount}
              total={totals.total}
              paymentMethod={paymentMethod}
              cashReceivedInput={cashReceivedInput}
              parsedCashReceived={parsedCashReceived}
              changeAmount={changeAmount}
              customerName={customerName}
              orderNote={orderNote}
              isSubmitting={isSubmitting}
              onSelectCustomer={handleSelectCustomer}
              onQuickAddCustomer={handleQuickAddCustomer}
              onChangeDiscountType={(type) => {
                setIsDirty(true);
                setDiscountType(type);
              }}
              onChangeDiscountValue={(val) => {
                setIsDirty(true);
                setDiscountValue(val);
              }}
              onChangeVatRate={(rate) => {
                setIsDirty(true);
                setVatRate(rate);
              }}
              onChangePaymentMethod={setPaymentMethod}
              onChangeCashReceived={setCashReceivedInput}
              onChangeCustomerName={(val) => {
                setIsDirty(true);
                setCustomerName(val);
              }}
              onChangeOrderNote={(val) => {
                setIsDirty(true);
                setOrderNote(val);
              }}
              onBackToFloor={() => setViewMode('floor')}
              onBackToMenu={() => setViewMode('menu')}
              onPrintProvisional={handlePrintProvisional}
              onConfirmCheckout={handleCheckout}
              onOpenSettings={() => onNavigateTab('settings')}
            />
          )}
        </section>

        {/* ================= RIGHT PERSISTENT ORDER TICKET & PRICE PANEL ================= */}
        <aside className="w-full lg:w-[360px] xl:w-[400px] max-h-[42vh] lg:max-h-none shrink-0 flex flex-col bg-white border-t-2 lg:border-t-0 lg:border-l-2 border-[#0a2268] overflow-hidden">
          {/* Top Deep-Navy Command Bar (No Shortcut Labels) */}
          <div className="bg-[#091d4f] text-white grid grid-cols-4 border-b border-blue-900 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('floor')}
              className={`py-2.5 px-1.5 flex flex-col items-center justify-center border-r border-blue-900/80 transition-colors ${
                viewMode === 'floor'
                  ? 'bg-cyan-700 text-white'
                  : 'bg-[#0c276d] hover:bg-[#13358f] text-white'
              }`}
            >
              <Home className="w-3.5 h-3.5 mb-0.5 text-cyan-200" />
              <span className="text-[11px] font-bold leading-none">Khu bàn</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('customers')}
              className="py-2.5 px-1.5 flex flex-col items-center justify-center border-r border-blue-900/80 bg-[#0a2268] hover:bg-[#13358f] transition-colors"
            >
              <UserCheck className="w-3.5 h-3.5 mb-0.5 text-cyan-200" />
              <span className="text-[11px] font-semibold leading-none">Khách hàng</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('reports')}
              className="py-2.5 px-1.5 flex flex-col items-center justify-center border-r border-blue-900/80 bg-[#0a2268] hover:bg-[#13358f] transition-colors"
            >
              <BarChart3 className="w-3.5 h-3.5 mb-0.5 text-cyan-200" />
              <span className="text-[11px] font-semibold leading-none">Báo cáo</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFunctionsDrawer(true)}
              className="py-2.5 px-1.5 flex flex-col items-center justify-center bg-[#0a2268] hover:bg-[#13358f] transition-colors"
            >
              <MenuIcon className="w-3.5 h-3.5 mb-0.5 text-cyan-200" />
              <span className="text-[11px] font-bold leading-none">Chức năng</span>
            </button>
          </div>

          {/* Ticket Header Metadata */}
          <div className="bg-[#071a42] text-white px-3 py-2 border-b border-blue-950 shrink-0 space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-white truncate">
                {selectedTable ? `${selectedTable.zone} - ${selectedTable.name}` : 'Khách Mang về'}
              </div>
              {activeOpenOrder ? (
                <span className="text-[10px] font-bold text-orange-300 whitespace-nowrap">
                  Đang treo bill
                </span>
              ) : cartItems.length > 0 ? (
                <span className="text-[10px] font-bold text-cyan-300 whitespace-nowrap">
                  Chưa lưu bàn
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 whitespace-nowrap">Bàn trống</span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-200 tabular-nums">
              <span className="truncate">
                Order:{' '}
                <strong className="text-white">{activeOpenOrder?.orderNumber || 'Đơn mới'}</strong>
              </span>
              <span className="text-cyan-200 whitespace-nowrap">{clockText}</span>
            </div>
          </div>

          {/* Amber Summary Strip */}
          <div className="bg-[#041236] text-amber-300 px-3 py-1.5 text-[11px] font-bold tabular-nums border-b border-blue-950 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 shrink-0">
            <span>[Tạm tính: {formatDotNumber(totals.subtotal) || '0'}]</span>
            {totalDiscountCombined > 0 && (
              <span className="text-orange-300">
                [Giảm: -{formatDotNumber(totalDiscountCombined)}]
              </span>
            )}
            {totals.vatAmount > 0 && (
              <span className="text-cyan-300">
                [VAT {vatRate}%: {formatDotNumber(totals.vatAmount)}]
              </span>
            )}
          </div>

          {/* Itemized Ticket List */}
          <div className="flex-1 overflow-y-auto pos-scroll bg-white divide-y divide-slate-100">
            {cartItems.length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center p-6 text-center text-slate-400">
                <UtensilsCrossed className="w-7 h-7 text-slate-300 mb-2" />
                <div className="text-xs font-semibold text-slate-500">Chưa có món nào trong đơn</div>
                <p className="text-[11px] mt-1">
                  Chọn bàn bên trái hoặc nhấn <strong className="text-slate-600">Gọi món</strong> để bắt đầu.
                </p>
              </div>
            ) : (
              cartItems.map((item, idx) => {
                const unitPrice = getItemUnitPrice(item);
                const lineGross = getItemGrossTotal(item);
                const lineDiscount = getItemDiscountAmount(item);
                const lineNet = getItemNetTotal(item);
                const isUnsavedStyle = !activeOpenOrder || isDirty;

                return (
                  <div
                    key={`${item.itemId}-${idx}`}
                    className="px-3 py-2 hover:bg-cyan-50/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setModalItemState({ mode: 'edit', index: idx, item })}
                        className={`text-left text-sm font-bold leading-snug hover:underline ${
                          isUnsavedStyle ? 'text-rose-700' : 'text-[#0a2268]'
                        }`}
                      >
                        {item.name}
                      </button>

                      <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setModalItemState({ mode: 'edit', index: idx, item })}
                          className="text-xs font-bold text-cyan-700 hover:text-cyan-900 hover:underline"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteItemIdx(idx)}
                          className="text-xs font-bold text-orange-600 hover:text-red-700 hover:underline"
                        >
                          Xóa
                        </button>
                      </div>
                    </div>

                    {item.note && (
                      <div className="text-[11px] italic text-slate-500 mt-0.5 pl-1">
                        {item.note}
                      </div>
                    )}

                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs font-bold tabular-nums text-slate-800">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              item.qty <= 1
                                ? setConfirmDeleteItemIdx(idx)
                                : adjustCartItemQty(idx, -1)
                            }
                            className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                            aria-label={`Giảm số lượng ${item.name}`}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="min-w-[24px] text-center text-rose-700 font-extrabold px-1">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustCartItemQty(idx, 1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                            aria-label={`Tăng số lượng ${item.name}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </span>
                        <span className="text-slate-500 font-semibold">
                          × {formatDotNumber(item.price)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        {lineDiscount > 0 && (
                          <span className="text-[11px] font-medium text-slate-400 line-through">
                            {formatDotNumber(lineGross)}
                          </span>
                        )}
                        <span className="text-slate-900">= {formatDotNumber(lineNet)}</span>
                      </span>
                    </div>

                    {lineDiscount > 0 && (
                      <div className="mt-0.5 text-[11px] font-semibold text-amber-700 tabular-nums pl-5">
                        Giảm món:{' '}
                        {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                          ? `${item.discountValue}% (-${formatDotNumber(lineDiscount)} ₫)`
                          : `-${formatDotNumber(lineDiscount)} ₫`}
                      </div>
                    )}

                    {item.toppings && item.toppings.length > 0 && (
                      <div className="mt-1 pl-4 border-l-2 border-cyan-200 space-y-0.5">
                        {item.toppings.map((tp) => (
                          <div key={tp.id} className="text-[11px] leading-tight">
                            <div className="font-semibold text-slate-800">+ {tp.name}</div>
                            {tp.price > 0 && (
                              <div className="text-slate-500 tabular-nums">
                                {item.qty} × {formatDotNumber(tp.price)} ={' '}
                                {formatDotNumber(tp.price * item.qty)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {item.toppings && item.toppings.length > 0 && unitPrice !== item.price && (
                      <div className="mt-0.5 text-[10px] text-cyan-700 tabular-nums text-right">
                        Đơn giá gồm topping: {formatDotNumber(unitPrice)} ₫
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Total + Cancel / Save or Pay Actions (No Shortcut Labels) */}
          <div className="border-t-2 border-slate-200 bg-slate-50 px-3 pt-2 pb-2.5 space-y-2 shrink-0">
            <div className="flex items-center justify-between text-slate-950 tabular-nums">
              <span className="text-base font-extrabold">
                {totalQty} <span className="text-xs font-semibold text-slate-500">món</span>
              </span>
              <span className="text-lg font-extrabold text-[#0a2268]">
                {formatDotNumber(totals.total) || '0'} ₫
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSubmitting || (cartItems.length === 0 && !activeOpenOrder)}
                onClick={handleCancelOrderAction}
                className="h-11 rounded-md bg-red-600 hover:bg-red-700 disabled:bg-red-300/70 text-white font-bold text-xs flex items-center justify-center transition-colors shadow-xs"
              >
                {activeOpenOrder ? 'Hủy bill' : 'Hủy order'}
              </button>

              {viewMode === 'payment' ? (
                <button
                  type="button"
                  onClick={() => setViewMode('menu')}
                  className="h-11 rounded-md bg-[#0a2268] hover:bg-[#11318f] text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  Thêm món
                </button>
              ) : primaryMenuIsSave ? (
                <button
                  type="button"
                  disabled={isSubmitting || cartItems.length === 0}
                  onClick={handleSaveOpenTab}
                  className="h-11 rounded-md bg-[#0a2268] hover:bg-[#11318f] disabled:bg-slate-300 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                >
                  <Save className="w-4 h-4" />
                  {isSubmitting ? 'Đang lưu...' : 'Lưu bàn'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSubmitting || cartItems.length === 0}
                  onClick={() => {
                    setCashReceivedInput('');
                    setViewMode('payment');
                  }}
                  className="h-11 rounded-md bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                >
                  <CreditCard className="w-4 h-4" />
                  Thanh toán
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ================= PERSISTENT DARK-NAVY STORE FOOTER BAR ================= */}
      <footer className="bg-[#051233] text-slate-200 px-3.5 py-1.5 border-t border-blue-950 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs shrink-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0">
          <span className="font-extrabold text-cyan-300 tracking-tight">{storeTitle}</span>
          {settings?.address && (
            <span className="text-slate-300 truncate max-w-[320px] hidden sm:inline">
              {settings.address}
            </span>
          )}
          {settings?.phone && (
            <span className="text-slate-400 tabular-nums hidden md:inline">
              ĐT: {settings.phone}
            </span>
          )}
          <span className="text-slate-400 truncate">Thu ngân: {cashierName}</span>
        </div>

        <div className="flex items-center gap-4 tabular-nums ml-auto">
          <button
            type="button"
            onClick={() => onNavigateTab('reports')}
            className="text-slate-200 hover:text-cyan-300 transition-colors"
          >
            Hôm nay: <strong className="text-amber-300">{formatVND(todayRevenue)}</strong> (
            {todayOrderCount} đơn)
          </button>
          <span className="text-orange-300 font-semibold hidden sm:inline">
            {occupiedCountByZone['Tất cả'] || 0} bàn đang phục vụ
          </span>
        </div>
      </footer>

      {/* ================= ITEM MODIFIER POPUP ================= */}
      {modalItemState && (() => {
        const matchedMenuItem = menuItems.find((m) => m.id === modalItemState.item.itemId);
        return (
          <KasItemModal
            ownerId={ownerId}
            item={modalItemState.item}
            isCombo={Boolean(
              matchedMenuItem?.isCombo || modalItemState.item.category === 'Combo',
            )}
            comboToppings={matchedMenuItem?.comboToppings ?? []}
            comboRule={getEffectiveComboRule(matchedMenuItem)}
            comboMaxToppings={matchedMenuItem?.comboMaxToppings ?? 0}
            toppings={toppings}
            onSave={handleConfirmModalItem}
            onDelete={handleDeleteModalItem}
            onClose={() => setModalItemState(null)}
            onNotify={onNotify}
          />
        );
      })()}

      {/* ================= ADD TABLE MODAL ================= */}
      {showAddTable && (
        <KasAddTableModal
          ownerId={ownerId}
          onClose={() => setShowAddTable(false)}
          onNotify={onNotify}
        />
      )}

      {/* ================= TRANSFER / MERGE TABLE MODAL ================= */}
      {transferMode && selectedTable && activeOpenOrder && (
        <KasTransferMergeModal
          mode={transferMode}
          sourceTable={selectedTable}
          sourceOrder={activeOpenOrder}
          tables={tables}
          openOrdersByTable={openOrdersByTable}
          onSuccess={(targetId) => {
            onSelectTableId(targetId);
            setTransferMode(null);
          }}
          onClose={() => setTransferMode(null)}
          onNotify={onNotify}
        />
      )}

      {/* ================= CANCEL BILL MODAL ================= */}
      {showCancelBillModal && activeOpenOrder && (
        <KasCancelBillModal
          tableName={selectedTable?.name || activeOpenOrder.tableName}
          orderNumber={activeOpenOrder.orderNumber}
          total={activeOpenOrder.total}
          submitting={isSubmitting}
          onConfirm={handleVoidOpenBill}
          onClose={() => setShowCancelBillModal(false)}
        />
      )}

      {/* ================= CHỨC NĂNG MANAGEMENT DRAWER ================= */}
      {showFunctionsDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setShowFunctionsDrawer(false)}
          />
          <div className="relative z-10 w-80 max-w-[90vw] bg-white h-full flex flex-col justify-between shadow-2xl border-l-2 border-[#0a2268]">
            <div>
              <div className="bg-[#091d4f] text-white px-5 py-4 flex items-center justify-between">
                <div>
                  <div className="text-base font-extrabold text-cyan-300">{storeTitle}</div>
                  <div className="text-xs text-slate-300 mt-0.5">Bảng chức năng quản lý</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFunctionsDrawer(false)}
                  className="p-1.5 text-slate-300 hover:text-white rounded"
                  aria-label="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    setViewMode('floor');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-cyan-50 text-cyan-900 font-bold text-sm hover:bg-cyan-100 transition-colors"
                >
                  <Home className="w-4 h-4 text-cyan-700" />
                  Khu vực bàn & Bán hàng POS
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('tables');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                >
                  <LayoutGrid className="w-4 h-4 text-[#0a2268]" />
                  Quản lý bàn ({tables.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('menu');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                >
                  <UtensilsCrossed className="w-4 h-4 text-[#0a2268]" />
                  Quản lý Thực đơn & Topping
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('customers');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                >
                  <UserCheck className="w-4 h-4 text-[#0a2268]" />
                  Quản lý Khách hàng ({customers.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('orders');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                >
                  <ReceiptText className="w-4 h-4 text-[#0a2268]" />
                  Lịch sử Hóa đơn
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('reports');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                >
                  <BarChart3 className="w-4 h-4 text-[#0a2268]" />
                  Báo cáo Doanh thu & Xuất Excel
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('settings');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                >
                  <Settings className="w-4 h-4 text-[#0a2268]" />
                  Cài đặt quán, Khổ in & Mã QR
                </button>

                <div className="pt-1.5 mt-1.5 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFunctionsDrawer(false);
                      onOpenCreateAccount();
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-slate-800 font-semibold text-sm hover:bg-slate-100 transition-colors"
                  >
                    <UserPlus className="w-4 h-4 text-[#0a2268]" />
                    Tạo tài khoản mới
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate">{cashierName}</div>
                <div className="text-[11px] text-slate-500 truncate">{userEmail}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowFunctionsDrawer(false);
                  onSignOut();
                }}
                className="w-full py-2.5 px-3 rounded-lg bg-slate-200/80 hover:bg-red-50 hover:text-red-700 text-slate-700 text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Đăng xuất tài khoản
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ================= XÁC NHẬN XÓA MÓN TRÊN THANH ORDER ================= */}
      {confirmDeleteItemIdx !== null && cartItems[confirmDeleteItemIdx] && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteItemIdx(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-[#091d4f] text-white flex items-center justify-between">
              <span className="text-sm font-bold">Xác nhận xóa món</span>
              <button
                type="button"
                onClick={() => setConfirmDeleteItemIdx(null)}
                className="p-1 text-slate-300 hover:text-white rounded"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-sm text-slate-800">
                Bạn có muốn xóa món{' '}
                <strong className="text-[#0a2268]">
                  {cartItems[confirmDeleteItemIdx].name}
                </strong>{' '}
                (SL: {cartItems[confirmDeleteItemIdx].qty}) khỏi đơn hàng không?
              </p>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteItemIdx(null)}
                className="px-4 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 transition-colors"
              >
                Không
              </button>
              <button
                type="button"
                onClick={() => {
                  removeCartItem(confirmDeleteItemIdx);
                  setConfirmDeleteItemIdx(null);
                }}
                className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
              >
                Có, xóa món
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
