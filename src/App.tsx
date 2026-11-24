import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  UtensilsCrossed,
  UserCheck,
  ReceiptText,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  LayoutGrid,
  Eye,
  EyeOff,
  Lock,
  User as UserIcon,
  UserPlus,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  auth,
  createPosAccount,
  db,
  formatAccountId,
  idToFirebaseEmail,
  OperationType,
  reportFirestoreError,
} from './lib/firebase';
import { formatVND, getDateKey, resolveAssetUrl } from './lib/format';
import {
  cleanupSampleOrders,
  initializeStoreWithSeedData,
  migrateLegacyStoreToSomoBistro,
} from './lib/seedData';
import {
  Customer,
  DiningTable,
  MenuItem,
  NavTab,
  Order,
  StoreSettings,
  Topping,
} from './types/pos';
import { PosTerminal } from './components/PosTerminal';
import { TablesView } from './components/TablesView';
import { MenuManagerView } from './components/MenuManagerView';
import { CustomersView } from './components/CustomersView';
import { OrdersHistoryView } from './components/OrdersHistoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { ReceiptModal } from './components/ReceiptModal';
import { OfflineIndicator } from './components/OfflineIndicator';

const MANAGEMENT_NAV_ITEMS: { id: NavTab; label: string; icon: typeof UtensilsCrossed }[] = [
  { id: 'tables' as NavTab, label: 'Quản lý bàn', icon: LayoutGrid },
  { id: 'menu' as NavTab, label: 'Thực đơn & Topping', icon: UtensilsCrossed },
  { id: 'customers' as NavTab, label: 'Khách hàng', icon: UserCheck },
  { id: 'orders' as NavTab, label: 'Hóa đơn', icon: ReceiptText },
  { id: 'reports' as NavTab, label: 'Báo cáo', icon: BarChart3 },
  { id: 'settings' as NavTab, label: 'Cài đặt quán', icon: Settings },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

  // In-app account creation modal (moved inside Functions menu) & safe sign-out confirm
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccId, setNewAccId] = useState('');
  const [newAccPassword, setNewAccPassword] = useState('');
  const [newAccConfirm, setNewAccConfirm] = useState('');
  const [showNewAccPassword, setShowNewAccPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createAccError, setCreateAccError] = useState('');
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<string>('pos');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string>('');

  // Firestore real-time state
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [toppings, setToppings] = useState<Topping[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  // Receipt modal state
  const [receiptState, setReceiptState] = useState<{
    order: Order;
    isProvisional: boolean;
  } | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const seededAttemptRef = useRef<string | null>(null);
  const migrationAttemptRef = useRef<string | null>(null);
  const sampleCleanupRef = useRef<string | null>(null);

  const notify = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setSettings(null);
        setMenuItems([]);
        setToppings([]);
        setCustomers([]);
        setMenuLoaded(false);
        setTables([]);
        setOrders([]);
        setOrdersLoaded(false);
        setDataLoading(false);
        seededAttemptRef.current = null;
        migrationAttemptRef.current = null;
        sampleCleanupRef.current = null;
      }
    });
    return () => unsub();
  }, []);

  // Attach real-time Firestore listeners only when authenticated
  useEffect(() => {
    if (!authReady || !user) return;
    setDataLoading(true);
    setMenuLoaded(false);
    setOrdersLoaded(false);
    const uid = user.uid;

    const unsubSettings = onSnapshot(
      doc(db, 'storeSettings', uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Omit<StoreSettings, 'id'>;
          setSettings({ id: snap.id, ...data });
          if (!data.seeded && seededAttemptRef.current !== uid) {
            seededAttemptRef.current = uid;
            setSeeding(true);
            initializeStoreWithSeedData(uid, true)
              .catch(() => {})
              .finally(() => setSeeding(false));
          }
        } else {
          setSettings(null);
          if (seededAttemptRef.current !== uid) {
            seededAttemptRef.current = uid;
            setSeeding(true);
            initializeStoreWithSeedData(uid, false)
              .catch(() => {})
              .finally(() => setSeeding(false));
          }
        }
        setDataLoading(false);
      },
      (err) => {
        reportFirestoreError(err, OperationType.GET, `storeSettings/${uid}`);
        setDataLoading(false);
      },
    );

    const unsubMenu = onSnapshot(
      query(collection(db, 'menuItems'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<MenuItem, 'id'>),
        }));
        setMenuItems(list);
        setMenuLoaded(true);
      },
      (err) => {
        reportFirestoreError(err, OperationType.LIST, 'menuItems');
      },
    );

    const unsubTables = onSnapshot(
      query(collection(db, 'diningTables'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<DiningTable, 'id'>),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
        setTables(list);
      },
      (err) => {
        reportFirestoreError(err, OperationType.LIST, 'diningTables');
      },
    );

    const unsubToppings = onSnapshot(
      query(collection(db, 'toppings'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Topping, 'id'>),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        setToppings(list);
      },
      (err) => {
        reportFirestoreError(err, OperationType.LIST, 'toppings');
      },
    );

    const unsubCustomers = onSnapshot(
      query(collection(db, 'customers'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Customer, 'id'>),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        setCustomers(list);
      },
      (err) => {
        reportFirestoreError(err, OperationType.LIST, 'customers');
      },
    );

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Order, 'id'>),
        }));
        setOrders(list);
        setOrdersLoaded(true);
      },
      (err) => {
        reportFirestoreError(err, OperationType.LIST, 'orders');
      },
    );

    return () => {
      unsubSettings();
      unsubMenu();
      unsubToppings();
      unsubCustomers();
      unsubTables();
      unsubOrders();
    };
  }, [authReady, user]);

  // Automatic one-time migration from legacy Mộc menu/store name to Somo Bistro's 12 items
  useEffect(() => {
    if (!user || !menuLoaded || dataLoading || seeding) return;
    if (migrationAttemptRef.current === user.uid) return;
    migrationAttemptRef.current = user.uid;

    migrateLegacyStoreToSomoBistro(user.uid, menuItems, settings)
      .then((migrated) => {
        if (migrated) {
          notify('Đã cập nhật thực đơn 12 món mới của Somo Bistro.');
        }
      })
      .catch(() => {});
  }, [user, menuLoaded, dataLoading, seeding, menuItems, settings]);

  // Automatic one-time purge of any legacy sample orders (`seedord*`)
  useEffect(() => {
    if (!user || !ordersLoaded || dataLoading || seeding) return;
    if (sampleCleanupRef.current === user.uid) return;
    sampleCleanupRef.current = user.uid;

    cleanupSampleOrders(orders)
      .then((removed) => {
        if (removed > 0) {
          notify(`Đã xóa sạch ${removed} hóa đơn dữ liệu mẫu.`);
        }
      })
      .catch(() => {});
  }, [user, ordersLoaded, dataLoading, seeding, orders]);

  const mapAuthErrorMessage = (err: unknown): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'ID đăng nhập hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.';
      case 'auth/invalid-email':
        return 'ID đăng nhập không hợp lệ. Chỉ dùng chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.';
      case 'auth/email-already-in-use':
        return 'ID đăng nhập này đã tồn tại. Vui lòng chọn ID khác hoặc chuyển sang Đăng nhập.';
      case 'auth/weak-password':
        return 'Mật khẩu quá yếu. Vui lòng nhập ít nhất 6 ký tự.';
      case 'auth/too-many-requests':
        return 'Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
      case 'auth/operation-not-allowed':
        return 'Phương thức đăng nhập Email/Mật khẩu chưa được bật trên Firebase Console. Vui lòng vào Authentication → Sign-in method để bật Email/Password.';
      case 'auth/network-request-failed':
        return 'Không thể kết nối mạng. Vui lòng kiểm tra Internet và thử lại.';
      default:
        return 'Đăng nhập chưa thành công. Vui lòng thử lại.';
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const mappedEmail = idToFirebaseEmail(loginId);
    if (!mappedEmail) {
      setAuthError(
        'ID đăng nhập cần dài 3–40 ký tự (chữ không dấu, số, ".", "_", "-") hoặc đúng định dạng email.',
      );
      return;
    }

    if (password.length < 6) {
      setAuthError('Mật khẩu cần có ít nhất 6 ký tự.');
      return;
    }

    setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, mappedEmail, password);
      setPassword('');
    } catch (err) {
      setAuthError(mapAuthErrorMessage(err));
    } finally {
      setSigningIn(false);
    }
  };

  const openCreateAccountModal = () => {
    setNewAccName('');
    setNewAccId('');
    setNewAccPassword('');
    setNewAccConfirm('');
    setShowNewAccPassword(false);
    setCreateAccError('');
    setAccountMenuOpen(false);
    setMobileNavOpen(false);
    setShowCreateAccountModal(true);
  };

  const handleCreateAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateAccError('');

    const mappedEmail = idToFirebaseEmail(newAccId);
    if (!mappedEmail) {
      setCreateAccError(
        'ID đăng nhập cần dài 3–40 ký tự (chữ không dấu, số, ".", "_", "-") hoặc đúng định dạng email.',
      );
      return;
    }
    if (newAccPassword.length < 6) {
      setCreateAccError('Mật khẩu cần có ít nhất 6 ký tự.');
      return;
    }
    if (newAccPassword !== newAccConfirm) {
      setCreateAccError('Mật khẩu nhập lại không khớp.');
      return;
    }

    setCreatingAccount(true);
    try {
      await createPosAccount(mappedEmail, newAccPassword, newAccName);
      const cleanId = formatAccountId(mappedEmail);
      setShowCreateAccountModal(false);
      notify(`Đã tạo tài khoản mới "${cleanId}" thành công.`);
    } catch (err) {
      setCreateAccError(mapAuthErrorMessage(err));
    } finally {
      setCreatingAccount(false);
    }
  };

  const requestSignOut = () => {
    setAccountMenuOpen(false);
    setMobileNavOpen(false);
    setConfirmSignOutOpen(true);
  };

  const handleConfirmSignOut = async () => {
    setConfirmSignOutOpen(false);
    await signOut(auth);
  };

  const todayStats = useMemo(() => {
    const todayKey = getDateKey(new Date());
    const todayCompleted = orders.filter(
      (o) => o.status === 'completed' && o.dateKey === todayKey && !o.id.startsWith('seedord'),
    );
    const revenue = todayCompleted.reduce((s, o) => s + o.total, 0);
    const openTables = tables.filter((t) => t.status === 'occupied').length;
    return {
      revenue,
      count: todayCompleted.length,
      openTables,
    };
  }, [orders, tables]);

  // ---------------- LOADING AUTH ----------------
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#071a42] flex items-center justify-center">
        <div className="text-sm font-semibold text-cyan-200">Đang khởi động Somo Bistro POS...</div>
      </div>
    );
  }

  // ---------------- SIGN-IN GATE (ID & PASSWORD) ----------------
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-5xl w-full bg-white border-2 border-[#0a2268] rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch shadow-xl">
          <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div className="text-lg font-extrabold tracking-tight text-cyan-700">Somo Bistro</div>

              <div className="space-y-2">
                <h1
                  className="text-2xl sm:text-3xl font-bold tracking-tight text-[#091d4f] leading-tight"
                  style={{ textWrap: 'balance' }}
                >
                  Hệ thống máy POS thu ngân chuyên nghiệp cho Somo Bistro
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-xl">
                  Đăng nhập trực tiếp bằng ID và mật khẩu để mở quầy thu ngân, quản lý bàn, in hóa đơn A5 / 80mm và đồng bộ dữ liệu quán.
                </p>
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-200">
              <div className="text-sm font-bold text-[#091d4f]">Đăng nhập tài khoản</div>

              <form onSubmit={handleAuthSubmit} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="auth-login-id"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    ID đăng nhập <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="auth-login-id"
                      type="text"
                      required
                      autoFocus
                      autoComplete="username"
                      value={loginId}
                      onChange={(e) => setLoginId(e.target.value.slice(0, 120))}
                      placeholder="VD: somobistro hoặc admin"
                      className="w-full h-10 pl-9 pr-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600 bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mật khẩu <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      className="w-full h-10 pl-9 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {authError && (
                  <div
                    role="alert"
                    className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 leading-relaxed"
                  >
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={signingIn}
                  className="w-full h-11 inline-flex items-center justify-center gap-2 px-6 text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {signingIn ? 'Đang đăng nhập...' : 'Đăng nhập vào quầy POS'}
                </button>
              </form>

              <p className="text-xs text-slate-400">
                Dữ liệu thực đơn, bàn, hóa đơn và báo cáo được bảo mật riêng theo từng tài khoản ID.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 relative min-h-[240px] lg:min-h-full bg-slate-100">
            <img
              src={resolveAssetUrl('/src/assets/images/menu_ca_phe_sua_da_1795166207066.jpg')}
              alt="Quầy pha chế Somo Bistro"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#091d4f]/90 via-[#091d4f]/25 to-transparent flex items-end p-6">
              <div className="text-white space-y-1">
                <div className="text-sm font-bold">Sẵn sàng vận hành ngay</div>
                <div className="text-xs text-slate-200 leading-relaxed">
                  Tối ưu thao tác thu ngân cảm ứng, sơ đồ bàn trực quan và in hóa đơn khổ 80mm / A5 sắc nét.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- LOADING STORE DATA ----------------
  if (dataLoading || seeding) {
    return (
      <div className="min-h-screen bg-[#071a42] flex flex-col items-center justify-center p-6 text-center space-y-3">
        <div className="text-base font-bold text-cyan-300">{settings?.storeName || 'Somo Bistro'}</div>
        <div className="text-sm text-slate-200">
          {seeding
            ? 'Đang khởi tạo thực đơn Somo Bistro và sơ đồ bàn...'
            : 'Đang tải dữ liệu cửa hàng...'}
        </div>
      </div>
    );
  }

  const accountLabel = formatAccountId(user.email);
  const isPosScreen = activeTab === 'pos';

  return (
    <>
      <OfflineIndicator />
      <div className={receiptState ? 'no-print' : undefined}>
        {isPosScreen ? (
        /* ================= FULL-SCREEN KAS POS TERMINAL ================= */
        <PosTerminal
          ownerId={user.uid}
          cashierName={user.displayName || accountLabel || 'Thu ngân'}
          userEmail={accountLabel}
          menuItems={menuItems}
          toppings={toppings}
          customers={customers}
          tables={tables}
          orders={orders}
          settings={settings}
          selectedTableId={selectedTableId}
          todayRevenue={todayStats.revenue}
          todayOrderCount={todayStats.count}
          onSelectTableId={setSelectedTableId}
          onNavigateTab={(tab) => setActiveTab(tab)}
          onPrintReceipt={(order, isProvisional) => setReceiptState({ order, isProvisional })}
          onOpenCreateAccount={openCreateAccountModal}
          onSignOut={requestSignOut}
          onNotify={notify}
        />
      ) : (
        /* ================= MANAGEMENT SCREENS WITH COHESIVE KAS TOP BAR ================= */
        <div className="min-h-screen bg-slate-50 flex flex-col">
          <header className="h-14 bg-[#091d4f] text-white border-b border-blue-950 px-4 sm:px-5 flex items-center justify-between gap-4 sticky top-0 z-30 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-extrabold transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                Quay về quầy POS
              </button>

              <span className="text-sm font-extrabold text-cyan-200 hidden md:inline whitespace-nowrap truncate">
                {settings?.storeName || 'Somo Bistro'}
              </span>

              {/* Desktop Management Tabs */}
              <nav className="hidden lg:flex items-center gap-1 ml-2" aria-label="Quản lý cửa hàng">
                {MANAGEMENT_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-orange-500 text-white'
                          : 'text-slate-200 hover:bg-[#132f7a] hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-[11px] text-slate-300">Doanh thu hôm nay</div>
                <div className="text-xs font-extrabold tabular-nums text-amber-300">
                  {formatVND(todayStats.revenue)} ({todayStats.count} đơn)
                </div>
              </div>

              {/* Account Menu Dropdown (prevents accidental 1-tap logout on right side) */}
              <div className="hidden lg:block relative">
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#132f7a] hover:bg-[#193d99] text-xs font-semibold text-slate-100 transition-colors whitespace-nowrap"
                  aria-expanded={accountMenuOpen}
                  aria-haspopup="menu"
                >
                  <UserIcon className="w-3.5 h-3.5 text-cyan-300" />
                  <span className="max-w-[110px] truncate">{accountLabel || 'Tài khoản'}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-300" />
                </button>

                {accountMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAccountMenuOpen(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 mt-1.5 w-56 rounded-lg bg-white text-slate-800 shadow-xl border border-slate-200 py-1.5 z-50"
                    >
                      <div className="px-3.5 py-2 border-b border-slate-100">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {user.displayName || accountLabel || 'Thu ngân'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{accountLabel}</div>
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openCreateAccountModal}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-cyan-700" />
                        Tạo tài khoản mới
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={requestSignOut}
                        className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Đăng xuất tài khoản
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden p-2 rounded-md bg-[#132f7a] text-cyan-200"
                aria-label="Mở menu quản lý"
              >
                <Menu className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Mobile Drawer for Management Screens */}
          {mobileNavOpen && (
            <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
              <div
                className="fixed inset-0 bg-slate-950/50"
                onClick={() => setMobileNavOpen(false)}
              />
              <div className="relative z-10 w-72 bg-white h-full flex flex-col justify-between shadow-2xl border-l-2 border-[#0a2268]">
                <div>
                  <div className="h-14 px-4 bg-[#091d4f] text-white flex items-center justify-between">
                    <span className="font-bold text-sm text-cyan-200">
                      {settings?.storeName || 'Somo Bistro'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMobileNavOpen(false)}
                      className="p-1.5 text-slate-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-3 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('pos');
                        setMobileNavOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-cyan-50 text-cyan-800 text-sm font-bold"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Quay về quầy POS
                    </button>
                    {MANAGEMENT_NAV_ITEMS.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(item.id);
                            setMobileNavOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold ${
                            active ? 'bg-orange-500 text-white' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {item.label}
                        </button>
                      );
                    })}
                    <div className="pt-1.5 mt-1.5 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={openCreateAccountModal}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <UserPlus className="w-4 h-4 text-cyan-700" />
                        Tạo tài khoản mới
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-600 truncate">{accountLabel}</span>
                  <button
                    type="button"
                    onClick={requestSignOut}
                    className="px-2.5 py-1.5 rounded-md border border-red-200 bg-red-50 text-xs font-bold text-red-600 whitespace-nowrap"
                  >
                    Đăng xuất
                  </button>
                </div>
              </div>
            </div>
          )}

          <main className="flex-1 min-w-0">
            {activeTab === 'tables' && (
              <TablesView
                ownerId={user.uid}
                tables={tables}
                orders={orders}
                onOpenTableInPos={(tableId) => {
                  setSelectedTableId(tableId);
                  setActiveTab('pos');
                }}
                onNotify={notify}
              />
            )}

            {activeTab === 'menu' && (
              <MenuManagerView
                ownerId={user.uid}
                menuItems={menuItems}
                toppings={toppings}
                onNotify={notify}
              />
            )}

            {activeTab === 'customers' && (
              <CustomersView
                ownerId={user.uid}
                customers={customers}
                orders={orders}
                onPrintReceipt={(order, isProvisional) =>
                  setReceiptState({ order, isProvisional })
                }
                onNotify={notify}
              />
            )}

            {activeTab === 'orders' && (
              <OrdersHistoryView
                orders={orders}
                onPrintReceipt={(order, isProvisional) =>
                  setReceiptState({ order, isProvisional })
                }
                onNotify={notify}
              />
            )}

            {activeTab === 'reports' && (
              <ReportsView
                orders={orders}
                storeName={settings?.storeName || 'Somo Bistro'}
                onNotify={notify}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                ownerId={user.uid}
                settings={settings}
                orders={orders}
                tables={tables}
                onNotify={notify}
              />
            )}
          </main>
        </div>
        )}
      </div>

      {/* Receipt Print Modal (A5 / 80mm) */}
      {receiptState && (
        <ReceiptModal
          order={receiptState.order}
          settings={settings}
          isProvisional={receiptState.isProvisional}
          onClose={() => setReceiptState(null)}
        />
      )}

      {/* Create New Account Modal (inside Functions menu, preserves active session) */}
      {showCreateAccountModal && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Tạo tài khoản mới"
        >
          <form
            onSubmit={handleCreateAccountSubmit}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 bg-[#091d4f] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-cyan-300" />
                <h3 className="text-sm font-bold">Tạo tài khoản mới</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateAccountModal(false)}
                className="p-1 text-slate-300 hover:text-white rounded"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <p className="text-xs text-slate-500">
                Tạo thêm tài khoản ID đăng nhập mới cho quán hoặc thu ngân. Phiên làm việc hiện tại của bạn vẫn giữ nguyên.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tên hiển thị (Quán / Thu ngân)
                </label>
                <input
                  type="text"
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value.slice(0, 60))}
                  placeholder="VD: Thu ngân ca chiều"
                  className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ID đăng nhập <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newAccId}
                  onChange={(e) => setNewAccId(e.target.value.slice(0, 120))}
                  placeholder="VD: thungan02 hoặc chi_nhanh_2"
                  className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewAccPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newAccPassword}
                    onChange={(e) => setNewAccPassword(e.target.value)}
                    placeholder="Tối thiểu 6 ký tự"
                    className="w-full h-10 pl-3 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewAccPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                    aria-label={showNewAccPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showNewAccPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nhập lại mật khẩu <span className="text-red-600">*</span>
                </label>
                <input
                  type={showNewAccPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newAccConfirm}
                  onChange={(e) => setNewAccConfirm(e.target.value)}
                  placeholder="Nhập lại mật khẩu giống ở trên"
                  className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-cyan-600"
                />
              </div>

              {createAccError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700"
                >
                  {createAccError}
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateAccountModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={creatingAccount}
                className="px-4 py-2 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded-lg"
              >
                {creatingAccount ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Safe Sign-Out Confirmation Modal */}
      {confirmSignOutOpen && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận đăng xuất"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Xác nhận đăng xuất?</h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Bạn sắp đăng xuất khỏi tài khoản <strong>{accountLabel}</strong>. Các đơn hàng đã lưu vẫn được giữ an toàn.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSignOutOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
              >
                Ở lại quầy
              </button>
              <button
                type="button"
                onClick={handleConfirmSignOut}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean Toast Banner */}
      {toast && (
        <div
          role="status"
          className={`no-print fixed bottom-10 right-5 z-50 px-4 py-2.5 rounded-lg text-xs font-semibold shadow-lg border transition-all ${
            toast.tone === 'error'
              ? 'bg-red-600 text-white border-red-700'
              : 'bg-[#091d4f] text-white border-cyan-500/60'
          }`}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
