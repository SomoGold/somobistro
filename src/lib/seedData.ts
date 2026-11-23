import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { generateDocId } from './format';
import {
  DiningTable,
  MenuCategory,
  MenuItem,
  Order,
  StoreSettings,
  TableZone,
} from '../types/pos';

export interface SeedMenuItem {
  sku: string;
  name: string;
  category: MenuCategory;
  price: number;
  cost: number;
  unit: string;
  imageUrl: string;
}

export const SOMO_BISTRO_MENU: SeedMenuItem[] = [
  {
    sku: 'SB01',
    name: 'Dừa tươi',
    category: 'Giải khát',
    price: 30000,
    cost: 12000,
    unit: 'Trái',
    imageUrl: '/src/assets/images/menu_dua_tuoi_1795167386581.jpg',
  },
  {
    sku: 'SB02',
    name: 'Cà phê sữa pha máy',
    category: 'Cà phê',
    price: 35000,
    cost: 11000,
    unit: 'Ly',
    imageUrl: '/src/assets/images/menu_ca_phe_sua_da_1795166207066.jpg',
  },
  {
    sku: 'SB03',
    name: 'Cà phê đá pha máy',
    category: 'Cà phê',
    price: 30000,
    cost: 9000,
    unit: 'Ly',
    imageUrl: '/src/assets/images/menu_ca_phe_sua_da_1795166207066.jpg',
  },
  {
    sku: 'SB04',
    name: 'Bạc xỉu',
    category: 'Cà phê',
    price: 35000,
    cost: 12000,
    unit: 'Ly',
    imageUrl: '/src/assets/images/menu_bac_xiu_1795166205786.jpg',
  },
  {
    sku: 'SB05',
    name: 'Chanh nóng/lạnh',
    category: 'Giải khát',
    price: 25000,
    cost: 6000,
    unit: 'Ly',
    imageUrl: '',
  },
  {
    sku: 'SB06',
    name: 'Cam vắt',
    category: 'Giải khát',
    price: 25000,
    cost: 10000,
    unit: 'Ly',
    imageUrl: '/src/assets/images/menu_cam_vat_1795167384252.jpg',
  },
  {
    sku: 'SB07',
    name: 'Matcha Latte',
    category: 'Trà & Matcha',
    price: 40000,
    cost: 16000,
    unit: 'Ly',
    imageUrl: '/src/assets/images/menu_matcha_latte_1795166208083.jpg',
  },
  {
    sku: 'SB08',
    name: 'Bình trà hoa cúc',
    category: 'Trà & Matcha',
    price: 60000,
    cost: 18000,
    unit: 'Bình',
    imageUrl: '/src/assets/images/menu_tra_hoa_cuc_1795167384732.jpg',
  },
  {
    sku: 'SB09',
    name: 'Coca Cola',
    category: 'Giải khát',
    price: 20000,
    cost: 9000,
    unit: 'Lon',
    imageUrl: '',
  },
  {
    sku: 'SB10',
    name: 'Nước suối',
    category: 'Giải khát',
    price: 15000,
    cost: 4500,
    unit: 'Chai',
    imageUrl: '',
  },
  {
    sku: 'SB11',
    name: 'Bia Heineken',
    category: 'Bia',
    price: 30000,
    cost: 19000,
    unit: 'Chai',
    imageUrl: '/src/assets/images/menu_bia_lanh_1795167385097.jpg',
  },
  {
    sku: 'SB12',
    name: 'Bia Tiger',
    category: 'Bia',
    price: 30000,
    cost: 16000,
    unit: 'Chai',
    imageUrl: '/src/assets/images/menu_bia_lanh_1795167385097.jpg',
  },
];

const LEGACY_SEED_SKUS = new Set([
  'CF01',
  'CF02',
  'CF03',
  'CF04',
  'TR01',
  'TR02',
  'TR03',
  'MA01',
  'MA02',
  'BN01',
  'BN02',
  'TP01',
]);

const DEFAULT_TABLES: { name: string; zone: TableZone; seats: number }[] = [
  { name: 'Bàn 01', zone: 'Trong nhà', seats: 2 },
  { name: 'Bàn 02', zone: 'Trong nhà', seats: 2 },
  { name: 'Bàn 03', zone: 'Trong nhà', seats: 4 },
  { name: 'Bàn 04', zone: 'Trong nhà', seats: 4 },
  { name: 'Bàn 05', zone: 'Trong nhà', seats: 6 },
  { name: 'Bàn 06', zone: 'Sân vườn', seats: 2 },
  { name: 'Bàn 07', zone: 'Sân vườn', seats: 4 },
  { name: 'Bàn 08', zone: 'Sân vườn', seats: 4 },
  { name: 'Bàn 09', zone: 'Tầng 2', seats: 4 },
  { name: 'Bàn 10', zone: 'Tầng 2', seats: 8 },
];

export async function migrateLegacyStoreToSomoBistro(
  ownerId: string,
  currentMenuItems: MenuItem[],
  settings: StoreSettings | null,
): Promise<boolean> {
  const hasLegacyMenu = currentMenuItems.some((item) => LEGACY_SEED_SKUS.has(item.sku));
  const hasLegacySettings = settings?.storeName === 'Mộc Coffee & Kitchen';

  if (!hasLegacyMenu && !hasLegacySettings) {
    return false;
  }

  const batch = writeBatch(db);
  const now = serverTimestamp();

  if (hasLegacySettings) {
    batch.update(doc(db, 'storeSettings', ownerId), {
      storeName: 'Somo Bistro',
      wifiInfo: 'SomoBistro_5G / Pass: somobistro',
      bankOwner: 'SOMO BISTRO',
      updatedAt: now,
    });
  }

  if (hasLegacyMenu) {
    currentMenuItems.forEach((item) => {
      batch.delete(doc(db, 'menuItems', item.id));
    });

    SOMO_BISTRO_MENU.forEach((item) => {
      const id = generateDocId('item');
      batch.set(doc(db, 'menuItems', id), {
        ownerId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        price: item.price,
        cost: item.cost,
        unit: item.unit,
        imageUrl: item.imageUrl,
        available: true,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  try {
    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'storeSettings/menuItems');
  }
}

/**
 * Automatically purges any previously seeded demo orders (`seedord...`) from Firestore.
 */
export async function cleanupSampleOrders(orders: Order[]): Promise<number> {
  const sampleOrders = orders.filter((o) => o.id.startsWith('seedord'));
  if (sampleOrders.length === 0) return 0;

  const batch = writeBatch(db);
  sampleOrders.forEach((ord) => {
    batch.delete(doc(db, 'orders', ord.id));
  });

  try {
    await batch.commit();
    return sampleOrders.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'orders');
  }
}

/**
 * Allows the store owner to clear all existing orders and reset all tables to available.
 */
export async function purgeAllOrdersAndResetTables(
  orders: Order[],
  tables: DiningTable[],
): Promise<void> {
  const now = serverTimestamp();
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  orders.forEach((ord) => {
    ops.push((batch) => batch.delete(doc(db, 'orders', ord.id)));
  });

  tables.forEach((tbl) => {
    if (tbl.status !== 'available' || tbl.activeOrderId) {
      ops.push((batch) =>
        batch.update(doc(db, 'diningTables', tbl.id), {
          status: 'available',
          activeOrderId: '',
          updatedAt: now,
        }),
      );
    }
  });

  if (ops.length === 0) return;

  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      ops.slice(i, i + CHUNK_SIZE).forEach((applyOp) => applyOp(batch));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'orders/diningTables');
  }
}

/**
 * Initializes a brand new Somo Bistro workspace with store settings, the 12 official menu items,
 * and 10 clean empty dining tables. Zero sample/fake orders are seeded.
 */
export async function initializeStoreWithSeedData(
  ownerId: string,
  settingsExists: boolean,
): Promise<void> {
  const now = serverTimestamp();
  const batch = writeBatch(db);
  const settingsRef = doc(db, 'storeSettings', ownerId);

  if (!settingsExists) {
    batch.set(settingsRef, {
      ownerId,
      storeName: 'Somo Bistro',
      address: '42 Nguyễn Đình Chiểu, Quận 1, TP. Hồ Chí Minh',
      phone: '0908 456 789',
      wifiInfo: 'SomoBistro_5G / Pass: somobistro',
      receiptFooter: 'Cảm ơn quý khách đã ghé thăm Somo Bistro! Hẹn gặp lại.',
      defaultVatRate: 8,
      bankName: '',
      bankAccount: '',
      bankOwner: '',
      qrImageUrl: '',
      defaultPrintSize: 'a5',
      seeded: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    batch.update(settingsRef, {
      seeded: true,
      updatedAt: now,
    });
  }

  for (const item of SOMO_BISTRO_MENU) {
    const id = generateDocId('item');
    batch.set(doc(db, 'menuItems', id), {
      ownerId,
      sku: item.sku,
      name: item.name,
      category: item.category,
      price: item.price,
      cost: item.cost,
      unit: item.unit,
      imageUrl: item.imageUrl,
      available: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const tbl of DEFAULT_TABLES) {
    const id = generateDocId('tbl');
    batch.set(doc(db, 'diningTables', id), {
      ownerId,
      name: tbl.name,
      zone: tbl.zone,
      seats: tbl.seats,
      status: 'available',
      activeOrderId: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'storeSettings/menuItems/diningTables');
  }
}
