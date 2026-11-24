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
  }, [selectedTableId, activeOpenOrder, settings?.defaultVatRate]);

  // Close open modal on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalItemState) {
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
  }, [modalItemState, showAddTable, transferMode, showCancelBillModal, showFunctionsDrawer]);

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
      orderNumber: activeOpenOrder?.orderNumber ?? generateOrderNumber(nowDate),
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
          orderNumber: generateOrderNumber(nowDate),
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
        const newOrderNumber = generateOrderNumber(nowDate);
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
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-zinc-100 select-none">
      {/* MAIN 2-PANE WORKSPACE (LEFT = FLOOR / MENU / PAYMENT, RIGHT = ORDER TICKET) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ================= LEFT DYNAMIC WORKSPACE (FLOOR / MENU / PAYMENT) ================= */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-zinc-100">
          {/* -------------------- MODE A: TABLE FLOOR PLAN -------------------- */}
          {viewMode === 'floor' && (
            <>
              {/* Clean White Zone Bar & Table Search */}
              <div className="bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-200 shrink-0">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-xl border border-zinc-200/80">
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
                        className={`h-9 px-3.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                          active
                            ? 'bg-zinc-900 text-white shadow-xs'
                            : 'text-zinc-600 hover:text-zinc-950 hover:bg-white/80'
                        }`}
                      >
                        <span>{zone}</span>
                        {busyCount > 0 && (
                          <span
                            className={`text-[11px] font-mono font-bold tabular-nums ${
                              active ? 'text-amber-300' : 'text-amber-600'
                            }`}
                          >
                            {busyCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="relative w-48 sm:w-60 ml-auto">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Tìm tên bàn, khu vực..."
                    className="w-full h-9 pl-9 pr-8 text-xs bg-zinc-50 text-zinc-900 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700 transition-colors"
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      onClick={() => setTableSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                      aria-label="Xóa tìm kiếm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Subtle Legend Strip */}
              <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 shrink-0">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-zinc-400" />
                    Bàn trống ({tables.length - (occupiedCountByZone['Tất cả'] || 0)})
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    Đang treo bill ({occupiedCountByZone['Tất cả'] || 0})
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-900">
                    <span className="w-2.5 h-2.5 rounded-full bg-zinc-900" />
                    Đang chọn
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  Chạm 1 lần để xem bill · Chạm lần 2 hoặc nhấn{' '}
                  <strong className="text-zinc-700">Gọi món</strong>
                </div>
              </div>

              {/* Table Cards Grid */}
              <div className="flex-1 overflow-y-auto pos-scroll p-4 bg-zinc-100">
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {/* Takeaway Quick Card */}
                  {!tableSearch.trim() && zoneFilter === 'Tất cả' && (
                    <button
                      type="button"
                      onClick={handleSelectTakeaway}
                      className={`min-h-[104px] rounded-xl border p-3.5 flex flex-col justify-between text-left transition-all ${
                        !selectedTableId
                          ? 'bg-zinc-900 text-white border-zinc-900 ring-2 ring-emerald-600/30 shadow-sm'
                          : 'bg-white hover:bg-emerald-50/40 text-zinc-900 border-zinc-200 hover:border-emerald-600/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            !selectedTableId
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                          }`}
                        >
                          <ShoppingBag className="w-4 h-4" />
                        </span>
                        <span
                          className={`text-[11px] font-semibold ${
                            !selectedTableId ? 'text-emerald-300' : 'text-emerald-700'
                          }`}
                        >
                          Tại quầy
                        </span>
                      </div>
                      <div className="mt-2.5">
                        <div className="text-sm font-bold leading-tight truncate">Mang về</div>
                        <div
                          className={`text-xs mt-0.5 ${
                            !selectedTableId ? 'text-zinc-400' : 'text-zinc-500'
                          }`}
                        >
                          Bán nhanh không cần bàn
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
                      'bg-white hover:border-zinc-400 text-zinc-900 border-zinc-200';
                    if (isSelected) {
                      cardClasses =
                        'bg-zinc-900 text-white border-zinc-900 ring-2 ring-emerald-600/35 shadow-sm';
                    } else if (isOccupied) {
                      cardClasses =
                        'bg-amber-50/90 hover:bg-amber-50 text-zinc-900 border-amber-300 hover:border-amber-400';
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
                        className={`min-h-[104px] rounded-xl border p-3.5 flex flex-col justify-between text-left transition-all ${cardClasses}`}
                      >
                        <div className="flex items-start justify-between gap-2 w-full">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? isOccupied
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-white/10 text-zinc-200'
                                  : isOccupied
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-zinc-100 text-zinc-500'
                              }`}
                            >
                              <Users className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-bold leading-tight truncate">
                                {table.name}
                              </div>
                              <div
                                className={`text-[11px] mt-0.5 truncate ${
                                  isSelected ? 'text-zinc-400' : 'text-zinc-500'
                                }`}
                              >
                                {table.zone} · {table.seats} chỗ
                              </div>
                            </div>
                          </div>

                          {isOccupied && (
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                                isSelected ? 'bg-amber-400' : 'bg-amber-500'
                              }`}
                              title="Đang treo bill"
                            />
                          )}
                        </div>

                        {isOccupied && openOrder ? (
                          <div
                            className={`mt-3 pt-2 border-t flex items-center justify-between gap-2 ${
                              isSelected ? 'border-zinc-700/80' : 'border-amber-200/80'
                            }`}
                          >
                            <span
                              className={`text-[11px] font-mono tabular-nums inline-flex items-center gap-1 truncate ${
                                isSelected ? 'text-zinc-300' : 'text-amber-800/80'
                              }`}
                            >
                              <Clock className="w-3 h-3 shrink-0" />
                              {itemCount} món
                            </span>
                            <span
                              className={`text-xs font-bold font-mono tabular-nums ${
                                isSelected ? 'text-amber-300' : 'text-amber-800'
                              }`}
                            >
                              {formatDotNumber(openOrder.total)} ₫
                            </span>
                          </div>
                        ) : (
                          <div
                            className={`mt-3 pt-2 border-t text-[11px] font-medium ${
                              isSelected
                                ? 'border-zinc-800 text-zinc-400'
                                : 'border-zinc-100 text-zinc-400'
                            }`}
                          >
                            Bàn trống
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {filteredTables.length === 0 && zoneFilter !== 'Tất cả' && (
                  <div className="py-16 text-center text-sm text-zinc-400">
                    Không tìm thấy bàn nào phù hợp trong khu vực này.
                  </div>
                )}
              </div>

              {/* Clean Light Bottom Action Bar */}
              <div className="bg-white border-t border-zinc-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddTable(true)}
                  className="h-10 px-4 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Thêm bàn
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!selectedTable || !activeOpenOrder}
                    onClick={() => handleOpenTransferMerge('move')}
                    className="h-10 px-3.5 rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-40 border border-zinc-200 text-zinc-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Chuyển bàn
                  </button>

                  <button
                    type="button"
                    disabled={!selectedTable || !activeOpenOrder}
                    onClick={() => handleOpenTransferMerge('merge')}
                    className="h-10 px-3.5 rounded-xl bg-white hover:bg-zinc-50 disabled:opacity-40 border border-zinc-200 text-zinc-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Combine className="w-4 h-4" />
                    Gộp bàn
                  </button>

                  <button
                    type="button"
                    onClick={() => setViewMode('menu')}
                    className="h-10 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <UtensilsCrossed className="w-4 h-4" />
                    Gọi món
                  </button>
                </div>
              </div>
            </>
          )}

          {/* -------------------- MODE B: MENU ORDERING -------------------- */}
          {viewMode === 'menu' && (
            <>
              {/* Clean White Menu Header */}
              <div className="bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-200 shrink-0">
                <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
                  <span className="h-9 px-3 rounded-lg bg-zinc-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                    {selectedTable ? `${selectedTable.zone} · ${selectedTable.name}` : 'Mang về'}
                  </span>

                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      placeholder="Tìm món ăn, đồ uống..."
                      className="w-full h-9 pl-9 pr-8 text-sm bg-zinc-50 text-zinc-900 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700 transition-colors"
                    />
                    {menuSearch && (
                      <button
                        type="button"
                        onClick={() => setMenuSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-rose-600 rounded"
                        aria-label="Xóa từ khóa"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setToggleStockMode((prev) => !prev)}
                    className={`h-9 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap border ${
                      toggleStockMode
                        ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600'
                        : 'bg-white hover:bg-zinc-50 text-zinc-700 border-zinc-200'
                    }`}
                    title="Tắt món tạm hết hoặc bật lại món trên POS"
                  >
                    <Power className="w-3.5 h-3.5 shrink-0" />
                    <span>{toggleStockMode ? 'Xong tắt/bật' : 'Tắt / Bật món'}</span>
                    {!toggleStockMode && outOfStockCount > 0 && (
                      <span className="text-[11px] font-mono font-bold text-amber-600 tabular-nums">
                        · {outOfStockCount} tắt
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
                      className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Thanh toán ngay
                    </button>
                  )}
                </div>
              </div>

              {toggleStockMode && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
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
                        className="px-3 py-1 rounded-lg bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 disabled:opacity-50 text-xs font-semibold whitespace-nowrap"
                      >
                        {togglingItemId === '__all__'
                          ? 'Đang bật...'
                          : `Bật tất cả (${outOfStockCount})`}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setToggleStockMode(false)}
                      className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold whitespace-nowrap"
                    >
                      Hoàn tất
                    </button>
                  </div>
                </div>
              )}

              {/* Far-Left Vertical Category Rail + Product Cards Grid */}
              <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Far-Left Vertical Category Rail (Single "Tất cả" button) + Pinned Khu vực bàn */}
                <div className="w-[128px] sm:w-[152px] bg-white border-r border-zinc-200 p-2.5 flex flex-col justify-between gap-2 shrink-0">
                  <div className="flex-1 overflow-y-auto pos-scroll flex flex-col gap-1">
                    {(['Tất cả', ...MENU_CATEGORIES] as const).map((category) => {
                      const active = activeCategory === category;
                      const count = categoryCounts[category] || 0;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setActiveCategory(category)}
                          className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold text-left leading-tight transition-all flex items-center justify-between gap-1.5 ${
                            active
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                          }`}
                        >
                          <span className="leading-snug">{category}</span>
                          <span
                            className={`text-[11px] font-mono tabular-nums shrink-0 ${
                              active ? 'text-emerald-300 font-bold' : 'text-zinc-400'
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
                    className="w-full py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold text-xs border border-zinc-200 flex items-center justify-center gap-1.5 leading-tight shrink-0 transition-colors"
                  >
                    <Home className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
                    <span>Khu vực bàn</span>
                  </button>
                </div>

                {/* Product Cards Grid */}
                <div className="flex-1 overflow-y-auto pos-scroll p-3.5 bg-zinc-100">
                  {filteredMenuItems.length === 0 ? (
                    <div className="py-20 text-center space-y-2 text-zinc-400">
                      <div className="text-sm font-semibold text-zinc-600">
                        Không tìm thấy món phù hợp
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCategory('Tất cả');
                          setMenuSearch('');
                        }}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Xem tất cả thực đơn
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
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
                            className={`border rounded-xl p-3 flex items-stretch justify-between gap-3 text-left transition-all min-h-[104px] group disabled:opacity-60 ${
                              toggleStockMode
                                ? isOff
                                  ? 'bg-zinc-50 border-dashed border-amber-400 opacity-80 hover:border-emerald-600'
                                  : 'bg-white border-emerald-500/70 hover:border-amber-500'
                                : qtyInCart > 0
                                  ? 'bg-white border-emerald-600 ring-2 ring-emerald-600/15'
                                  : 'bg-white border-zinc-200 hover:border-zinc-400'
                            }`}
                          >
                            <div className="flex-1 flex flex-col justify-between min-w-0 py-0.5">
                              <div>
                                <div className="flex items-start justify-between gap-1.5">
                                  <div
                                    className={`text-sm font-bold leading-snug line-clamp-2 ${
                                      isOff
                                        ? 'text-zinc-400 line-through'
                                        : 'text-zinc-900 group-hover:text-emerald-800'
                                    }`}
                                  >
                                    {item.name}
                                  </div>
                                  {!toggleStockMode && qtyInCart > 0 && (
                                    <span className="px-1.5 py-0.5 rounded-md bg-emerald-700 text-white text-[11px] font-mono font-bold tabular-nums shrink-0">
                                      ×{qtyInCart}
                                    </span>
                                  )}
                                </div>

                                <div className="text-[11px] text-zinc-400 mt-0.5 truncate">
                                  {item.category} · {item.unit}
                                  {item.isCombo && (() => {
                                    const rule = getEffectiveComboRule(item);
                                    const limit = item.comboMaxToppings ?? 0;
                                    const label =
                                      rule === 'exact' && limit > 0
                                        ? ` · Chọn đúng ${limit}`
                                        : rule === 'max' && limit > 0
                                          ? ` · Tối đa ${limit}`
                                          : ' · Combo';
                                    return <span className="text-amber-700 font-semibold">{label}</span>;
                                  })()}
                                </div>

                                {item.isCombo && item.comboToppings && item.comboToppings.length > 0 && (
                                  <div className="text-[11px] text-emerald-700 mt-0.5 line-clamp-1">
                                    {item.comboToppings.map((ct) => ct.name).join(' · ')}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center justify-between gap-2 mt-2">
                                <span
                                  className={`text-[15px] font-bold font-mono tabular-nums ${
                                    isOff ? 'text-zinc-400' : 'text-zinc-950'
                                  }`}
                                >
                                  {formatDotNumber(item.price)} ₫
                                </span>

                                {toggleStockMode && (
                                  <span className="inline-flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                        item.available ? 'bg-emerald-600' : 'bg-zinc-300'
                                      }`}
                                    >
                                      <span
                                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                                          item.available ? 'translate-x-4.5' : 'translate-x-1'
                                        }`}
                                      />
                                    </span>
                                    <span
                                      className={`text-[11px] font-semibold ${
                                        item.available ? 'text-emerald-700' : 'text-amber-700'
                                      }`}
                                    >
                                      {item.available ? 'Bật' : 'Đã tắt'}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="relative w-22 h-20 shrink-0 rounded-lg overflow-hidden border border-zinc-200/80 self-center bg-zinc-50">
                              <MenuThumbnail
                                src={item.imageUrl}
                                alt={item.name}
                                category={item.category}
                                className={`w-22 h-20 ${isOff ? 'grayscale opacity-50' : ''}`}
                              />
                              {isOff && (
                                <span className="absolute inset-x-1 bottom-1 py-0.5 text-center rounded bg-amber-600/95 text-white text-[10px] font-bold uppercase tracking-wide">
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

        {/* ================= RIGHT PERSISTENT ORDER TICKET PANEL ================= */}
        <aside className="w-full lg:w-[372px] xl:w-[408px] max-h-[42vh] lg:max-h-none shrink-0 flex flex-col bg-white border-t lg:border-t-0 lg:border-l border-zinc-200 overflow-hidden">
          {/* Top Clean 4-Action Navigation Strip */}
          <div className="bg-zinc-50 grid grid-cols-4 border-b border-zinc-200 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('floor')}
              className={`py-2.5 px-1.5 flex flex-col items-center justify-center gap-1 border-r border-zinc-200/80 transition-colors ${
                viewMode === 'floor'
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-white hover:text-zinc-950'
              }`}
            >
              <Home className="w-4 h-4" />
              <span className="text-[11px] font-semibold leading-none">Khu bàn</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('customers')}
              className="py-2.5 px-1.5 flex flex-col items-center justify-center gap-1 border-r border-zinc-200/80 text-zinc-600 hover:bg-white hover:text-zinc-950 transition-colors"
            >
              <UserCheck className="w-4 h-4" />
              <span className="text-[11px] font-semibold leading-none">Khách hàng</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('reports')}
              className="py-2.5 px-1.5 flex flex-col items-center justify-center gap-1 border-r border-zinc-200/80 text-zinc-600 hover:bg-white hover:text-zinc-950 transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="text-[11px] font-semibold leading-none">Báo cáo</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFunctionsDrawer(true)}
              className="py-2.5 px-1.5 flex flex-col items-center justify-center gap-1 text-zinc-700 hover:bg-white hover:text-zinc-950 transition-colors"
            >
              <MenuIcon className="w-4 h-4" />
              <span className="text-[11px] font-semibold leading-none">Chức năng</span>
            </button>
          </div>

          {/* Ticket Context Header */}
          <div className="bg-white px-4 py-3 border-b border-zinc-200 shrink-0 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-zinc-950 truncate">
                {selectedTable ? `${selectedTable.zone} · ${selectedTable.name}` : 'Khách Mang về'}
              </div>
              {activeOpenOrder ? (
                <span className="text-[11px] font-semibold text-amber-700 inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Đang treo bill
                </span>
              ) : cartItems.length > 0 ? (
                <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  Chưa lưu bàn
                </span>
              ) : (
                <span className="text-[11px] text-zinc-400 whitespace-nowrap">Bàn trống</span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 font-mono tabular-nums">
              <span className="truncate">
                {activeOpenOrder?.orderNumber || 'Đơn mới'}
              </span>
              <span className="whitespace-nowrap">{clockText}</span>
            </div>
          </div>

          {/* Subtle Financial Breakdown Strip */}
          {cartItems.length > 0 && (
            <div className="bg-zinc-50 px-4 py-1.5 text-[11px] font-mono tabular-nums border-b border-zinc-200/80 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-zinc-600 shrink-0">
              <span>Tạm tính: {formatDotNumber(totals.subtotal) || '0'} ₫</span>
              {totalDiscountCombined > 0 && (
                <span className="text-amber-700 font-semibold">
                  Chiết khấu: -{formatDotNumber(totalDiscountCombined)} ₫
                </span>
              )}
              {totals.vatAmount > 0 && (
                <span className="text-zinc-700">
                  VAT {vatRate}%: +{formatDotNumber(totals.vatAmount)} ₫
                </span>
              )}
            </div>
          )}

          {/* Itemized Ticket List */}
          <div className="flex-1 overflow-y-auto pos-scroll bg-white divide-y divide-zinc-100">
            {cartItems.length === 0 ? (
              <div className="h-full min-h-[140px] flex flex-col items-center justify-center p-6 text-center text-zinc-400">
                <div className="w-11 h-11 rounded-2xl bg-zinc-100 flex items-center justify-center mb-2.5">
                  <UtensilsCrossed className="w-5 h-5 text-zinc-400" />
                </div>
                <div className="text-xs font-semibold text-zinc-600">Chưa có món nào trong đơn</div>
                <p className="text-[11px] mt-1 max-w-[220px] leading-relaxed">
                  Chọn bàn bên trái hoặc nhấn <strong className="text-zinc-700">Gọi món</strong> để bắt đầu lên đơn.
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
                    className="px-4 py-2.5 hover:bg-zinc-50/80 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setModalItemState({ mode: 'edit', index: idx, item })}
                        className={`text-left text-sm font-semibold leading-snug hover:underline ${
                          isUnsavedStyle ? 'text-zinc-950' : 'text-zinc-900'
                        }`}
                      >
                        {item.name}
                      </button>

                      <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setModalItemState({ mode: 'edit', index: idx, item })}
                          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 hover:underline"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCartItem(idx)}
                          className="text-[11px] font-semibold text-zinc-400 hover:text-rose-600 hover:underline"
                        >
                          Xóa
                        </button>
                      </div>
                    </div>

                    {item.note && (
                      <div className="text-[11px] italic text-zinc-500 mt-0.5">
                        Ghi chú: {item.note}
                      </div>
                    )}

                    <div className="mt-2 flex items-center justify-between gap-2 text-xs tabular-nums">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              item.qty <= 1 ? removeCartItem(idx) : adjustCartItemQty(idx, -1)
                            }
                            className="w-7 h-7 flex items-center justify-center text-zinc-600 hover:bg-zinc-200/80 transition-colors"
                            aria-label={`Giảm số lượng ${item.name}`}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="min-w-[26px] text-center font-mono font-bold text-zinc-950 px-1">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustCartItemQty(idx, 1)}
                            className="w-7 h-7 flex items-center justify-center text-zinc-600 hover:bg-zinc-200/80 transition-colors"
                            aria-label={`Tăng số lượng ${item.name}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </span>
                        <span className="text-zinc-500 font-mono text-[11px]">
                          × {formatDotNumber(item.price)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 font-mono">
                        {lineDiscount > 0 && (
                          <span className="text-[11px] text-zinc-400 line-through">
                            {formatDotNumber(lineGross)}
                          </span>
                        )}
                        <span className="font-bold text-zinc-950">
                          {formatDotNumber(lineNet)} ₫
                        </span>
                      </div>
                    </div>

                    {lineDiscount > 0 && (
                      <div className="mt-1 text-[11px] font-medium text-amber-700 font-mono tabular-nums">
                        Giảm món:{' '}
                        {item.discountType === 'percent' && (item.discountValue ?? 0) > 0
                          ? `${item.discountValue}% (-${formatDotNumber(lineDiscount)} ₫)`
                          : `-${formatDotNumber(lineDiscount)} ₫`}
                      </div>
                    )}

                    {item.toppings && item.toppings.length > 0 && (
                      <div className="mt-1.5 pl-3 space-y-0.5 text-[11px] text-zinc-600">
                        {item.toppings.map((tp) => (
                          <div key={tp.id} className="flex items-center justify-between gap-2">
                            <span className="truncate">+ {tp.name}</span>
                            {tp.price > 0 && (
                              <span className="font-mono tabular-nums text-zinc-500 shrink-0">
                                +{formatDotNumber(tp.price * item.qty)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {item.toppings && item.toppings.length > 0 && unitPrice !== item.price && (
                      <div className="mt-1 text-[10px] text-emerald-700 font-mono tabular-nums text-right">
                        Đơn giá gồm topping: {formatDotNumber(unitPrice)} ₫
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Total + Cancel / Save or Pay Actions */}
          <div className="border-t border-zinc-200 bg-zinc-50 px-4 pt-3 pb-3.5 space-y-3 shrink-0">
            <div className="flex items-baseline justify-between text-zinc-950">
              <span className="text-xs font-semibold text-zinc-500 tabular-nums">
                Tổng cộng · <strong className="text-zinc-800">{totalQty}</strong> món
              </span>
              <span className="text-xl font-extrabold font-mono tabular-nums text-zinc-950">
                {formatDotNumber(totals.total) || '0'} ₫
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isSubmitting || (cartItems.length === 0 && !activeOpenOrder)}
                onClick={handleCancelOrderAction}
                className="h-11 rounded-xl bg-white hover:bg-rose-50 disabled:opacity-40 border border-rose-200 text-rose-600 font-semibold text-xs flex items-center justify-center transition-colors"
              >
                {activeOpenOrder ? 'Hủy bill' : 'Hủy order'}
              </button>

              {viewMode === 'payment' ? (
                <button
                  type="button"
                  onClick={() => setViewMode('menu')}
                  className="h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Thêm món
                </button>
              ) : primaryMenuIsSave ? (
                <button
                  type="button"
                  disabled={isSubmitting || cartItems.length === 0}
                  onClick={handleSaveOpenTab}
                  className="h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
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
                  className="h-11 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:bg-zinc-300 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  Thanh toán
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ================= MINIMAL ARCHITECTURAL STORE FOOTER BAR ================= */}
      <footer className="bg-white text-zinc-600 px-4 py-1.5 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs shrink-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
          <span className="font-bold text-zinc-900 tracking-tight">{storeTitle}</span>
          {settings?.address && (
            <span className="text-zinc-400 truncate max-w-[300px] hidden sm:inline">
              · {settings.address}
            </span>
          )}
          <span className="text-zinc-500 truncate">· Thu ngân: {cashierName}</span>
        </div>

        <div className="flex items-center gap-4 font-mono tabular-nums ml-auto">
          <button
            type="button"
            onClick={() => onNavigateTab('reports')}
            className="text-zinc-600 hover:text-emerald-700 transition-colors"
          >
            Hôm nay: <strong className="text-emerald-700">{formatVND(todayRevenue)}</strong> ·{' '}
            {todayOrderCount} đơn
          </button>
          <span className="text-amber-700 font-semibold hidden sm:inline">
            {occupiedCountByZone['Tất cả'] || 0} bàn đang mở
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
            className="fixed inset-0 bg-zinc-950/40 backdrop-blur-[1px]"
            onClick={() => setShowFunctionsDrawer(false)}
          />
          <div className="relative z-10 w-80 max-w-[90vw] bg-white h-full flex flex-col justify-between shadow-2xl border-l border-zinc-200">
            <div>
              <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
                <div>
                  <div className="text-base font-bold text-zinc-950">{storeTitle}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Bảng chức năng quản lý</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFunctionsDrawer(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-800 rounded-lg"
                  aria-label="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    setViewMode('floor');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-900 font-semibold text-sm hover:bg-emerald-100/80 transition-colors"
                >
                  <Home className="w-4 h-4 text-emerald-700" />
                  Khu vực bàn & Bán hàng POS
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('tables');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                >
                  <LayoutGrid className="w-4 h-4 text-zinc-500" />
                  Quản lý bàn ({tables.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('menu');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                >
                  <UtensilsCrossed className="w-4 h-4 text-zinc-500" />
                  Quản lý Thực đơn & Topping
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('customers');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                >
                  <UserCheck className="w-4 h-4 text-zinc-500" />
                  Quản lý Khách hàng ({customers.length})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('orders');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                >
                  <ReceiptText className="w-4 h-4 text-zinc-500" />
                  Lịch sử Hóa đơn
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('reports');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                >
                  <BarChart3 className="w-4 h-4 text-zinc-500" />
                  Báo cáo Doanh thu & Xuất Excel
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFunctionsDrawer(false);
                    onNavigateTab('settings');
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                >
                  <Settings className="w-4 h-4 text-zinc-500" />
                  Cài đặt quán, Khổ in & Mã QR
                </button>

                <div className="pt-2 mt-2 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFunctionsDrawer(false);
                      onOpenCreateAccount();
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-zinc-700 font-semibold text-sm hover:bg-zinc-100 transition-colors"
                  >
                    <UserPlus className="w-4 h-4 text-emerald-700" />
                    Tạo tài khoản mới
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-zinc-200 bg-zinc-50 space-y-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-900 truncate">{cashierName}</div>
                <div className="text-[11px] text-zinc-500 truncate">{userEmail}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowFunctionsDrawer(false);
                  onSignOut();
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-rose-50 hover:text-rose-700 border border-zinc-200 hover:border-rose-200 text-zinc-700 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Đăng xuất tài khoản
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
