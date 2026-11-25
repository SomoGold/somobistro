import { Timestamp } from 'firebase/firestore';

export type MenuCategory =
  | 'Combo'
  | 'Cà phê'
  | 'Trà & Matcha'
  | 'Giải khát'
  | 'Bia'
  | 'Món ăn'
  | 'Bánh ngọt';

export const MENU_CATEGORIES: MenuCategory[] = [
  'Combo',
  'Cà phê',
  'Trà & Matcha',
  'Giải khát',
  'Bia',
  'Món ăn',
  'Bánh ngọt',
];

export type TableZone = 'Trong nhà' | 'Sân vườn' | 'Tầng 2';

export const TABLE_ZONES: TableZone[] = ['Trong nhà', 'Sân vườn', 'Tầng 2'];

export type TableStatus = 'available' | 'occupied';
export type OrderType = 'dine_in' | 'takeaway';
export type OrderStatus = 'open' | 'completed' | 'cancelled';
export type DiscountType = 'percent' | 'fixed';
export type PaymentMethod = 'unpaid' | 'cash' | 'transfer' | 'card';

export type ReceiptPaperSize = 'a5' | '80mm';

export type NavTab = 'pos' | 'tables' | 'menu' | 'customers' | 'orders' | 'reports' | 'settings';

export interface StoreSettings {
  id: string;
  ownerId: string;
  storeName: string;
  address: string;
  phone: string;
  wifiInfo: string;
  receiptFooter: string;
  defaultVatRate: number;
  bankName: string;
  bankAccount: string;
  bankOwner: string;
  pinCode?: string;
  qrImageUrl?: string;
  logoImageUrl?: string;
  defaultPrintSize?: ReceiptPaperSize;
  seeded: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type ComboSelectionRule = 'all' | 'max' | 'exact';

export interface ComboTopping {
  id: string;
  name: string;
}

export interface MenuItem {
  id: string;
  ownerId: string;
  sku: string;
  name: string;
  category: MenuCategory;
  price: number;
  cost: number;
  unit: string;
  imageUrl: string;
  available: boolean;
  isCombo?: boolean;
  comboToppings?: ComboTopping[];
  comboMaxToppings?: number;
  comboRule?: ComboSelectionRule;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Topping {
  id: string;
  ownerId: string;
  name: string;
  price: number;
  available: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface OrderItemTopping {
  id: string;
  name: string;
  price: number;
}

export interface Customer {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  defaultDiscountType: DiscountType;
  defaultDiscountValue: number;
  note: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface DiningTable {
  id: string;
  ownerId: string;
  name: string;
  zone: TableZone;
  seats: number;
  status: TableStatus;
  activeOrderId: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface OrderItem {
  itemId: string;
  name: string;
  category: MenuCategory | string;
  price: number;
  cost: number;
  qty: number;
  note: string;
  toppings?: OrderItemTopping[];
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount?: number;
}

export interface Order {
  id: string;
  ownerId: string;
  orderNumber: string;
  orderType: OrderType;
  tableId: string;
  tableName: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  costTotal: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeAmount: number;
  customerId?: string;
  customerName: string;
  note: string;
  cancelReason: string;
  dateKey: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  hourOfDay: number; // 0..23
  displayTime: string;
  cashierName: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export const LIMITS = {
  STORE_NAME_MAX: 100,
  ADDRESS_MAX: 200,
  PHONE_MAX: 30,
  WIFI_MAX: 100,
  FOOTER_MAX: 200,
  BANK_NAME_MAX: 80,
  BANK_ACCOUNT_MAX: 50,
  BANK_OWNER_MAX: 100,
  QR_IMAGE_MAX: 300000,
  LOGO_IMAGE_MAX: 300000,
  SKU_MAX: 32,
  ITEM_NAME_MAX: 120,
  TOPPING_NAME_MAX: 80,
  UNIT_MAX: 24,
  IMAGE_URL_MAX: 500,
  TABLE_NAME_MAX: 60,
  CUSTOMER_NAME_MAX: 100,
  ORDER_NOTE_MAX: 300,
  ITEM_NOTE_MAX: 150,
  CANCEL_REASON_MAX: 200,
  MAX_ORDER_ITEMS: 50,
  MAX_ITEM_TOPPINGS: 15,
  MAX_COMBO_TOPPINGS: 15,
  MAX_PRICE: 100000000,
  SKU_PATTERN: /^[a-zA-Z0-9_-]+$/,
} as const;

export function sanitizeText(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const STUDIO_MENU_IMAGES: { label: string; url: string; category: MenuCategory }[] = [
  {
    label: 'Dừa tươi',
    url: '/src/assets/images/menu_dua_tuoi_1795167386581.jpg',
    category: 'Giải khát',
  },
  {
    label: 'Cà phê pha máy',
    url: '/src/assets/images/menu_ca_phe_sua_da_1795166207066.jpg',
    category: 'Cà phê',
  },
  {
    label: 'Bạc xỉu',
    url: '/src/assets/images/menu_bac_xiu_1795166205786.jpg',
    category: 'Cà phê',
  },
  {
    label: 'Cam vắt',
    url: '/src/assets/images/menu_cam_vat_1795167384252.jpg',
    category: 'Giải khát',
  },
  {
    label: 'Matcha Latte',
    url: '/src/assets/images/menu_matcha_latte_1795166208083.jpg',
    category: 'Trà & Matcha',
  },
  {
    label: 'Bình trà hoa cúc',
    url: '/src/assets/images/menu_tra_hoa_cuc_1795167384732.jpg',
    category: 'Trà & Matcha',
  },
  {
    label: 'Bia lạnh',
    url: '/src/assets/images/menu_bia_lanh_1795167385097.jpg',
    category: 'Bia',
  },
  {
    label: 'Croissant bơ Pháp',
    url: '/src/assets/images/menu_banh_croissant_1795166206609.jpg',
    category: 'Bánh ngọt',
  },
  {
    label: 'Mì Ý bò bằm',
    url: '/src/assets/images/menu_mi_y_bo_bam_1795166209002.jpg',
    category: 'Món ăn',
  },
];
