/**
 * Payload-First Security TDD specification for Mộc POS Firestore Security Rules.
 * Verifies all "Dirty Dozen" adversarial payloads are rejected with PERMISSION_DENIED
 * against firestore.rules when run with @firebase/rules-unit-testing and the Firestore Emulator.
 */

export interface AdversarialCase {
  id: number;
  name: string;
  collection: 'storeSettings' | 'menuItems' | 'diningTables' | 'orders';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  actor: { uid: string; email: string; email_verified: boolean };
  docId: string;
  payload?: Record<string, unknown>;
  reason: string;
}

export const DIRTY_DOZEN_CASES: AdversarialCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on MenuItem Create',
    collection: 'menuItems',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'attacker_1', email: 'attacker@example.com', email_verified: true },
    docId: 'item_spoof_1',
    payload: {
      ownerId: 'victim_uid',
      sku: 'CF01',
      name: 'Cà phê sữa đá',
      category: 'Cà phê',
      price: 35000,
      cost: 12000,
      unit: 'Ly',
      imageUrl: '',
      available: true,
    },
    reason: 'ownerId does not match request.auth.uid',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    collection: 'menuItems',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'unverified_1', email: 'u@example.com', email_verified: false },
    docId: 'item_unverified',
    payload: {
      ownerId: 'unverified_1',
      sku: 'CF02',
      name: 'Bạc xỉu',
      category: 'Cà phê',
      price: 39000,
      cost: 14000,
      unit: 'Ly',
      imageUrl: '',
      available: true,
    },
    reason: 'request.auth.token.email_verified must be true for all writes',
  },
  {
    id: 3,
    name: 'Shadow Field Injection',
    collection: 'menuItems',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'item_shadow',
    payload: {
      ownerId: 'owner_1',
      sku: 'CF03',
      name: 'Espresso',
      category: 'Cà phê',
      price: 32000,
      cost: 10000,
      unit: 'Ly',
      imageUrl: '',
      available: true,
      ghostAdminFlag: true,
    },
    reason: 'hasOnly() rejects undeclared shadow keys',
  },
  {
    id: 4,
    name: 'Path ID Poisoning',
    collection: 'menuItems',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'bad$id!'.repeat(30),
    payload: { ownerId: 'owner_1' },
    reason: 'isValidId() blocks >128 chars and non-alphanumeric symbols',
  },
  {
    id: 5,
    name: 'String Exhaustion Attack (DoW)',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'ord_dow_1',
    payload: {
      ownerId: 'owner_1',
      note: 'A'.repeat(5000),
    },
    reason: 'note exceeds maxLength 300',
  },
  {
    id: 6,
    name: 'Unbounded Array Bomb (>50 items)',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'ord_bomb_1',
    payload: {
      ownerId: 'owner_1',
      items: Array.from({ length: 55 }, (_, i) => ({
        itemId: `i_${i}`,
        name: 'Item',
        category: 'Cà phê',
        price: 30000,
        cost: 10000,
        qty: 1,
        note: '',
      })),
    },
    reason: 'items.size() <= 50 strictly enforced',
  },
  {
    id: 7,
    name: 'Array Element Type Poisoning',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'ord_poison_1',
    payload: {
      ownerId: 'owner_1',
      items: ['malicious-string-not-map'],
    },
    reason: 'First element of items must be a valid map with typed fields',
  },
  {
    id: 8,
    name: 'Client Timestamp Forgery',
    collection: 'diningTables',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'tbl_forge_1',
    payload: {
      ownerId: 'owner_1',
      name: 'Bàn 99',
      zone: 'Trong nhà',
      seats: 4,
      status: 'available',
      activeOrderId: '',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    reason: 'createdAt and updatedAt must strictly equal request.time',
  },
  {
    id: 9,
    name: 'Immutable Field Tampering on Update',
    collection: 'diningTables',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'tbl_01',
    payload: {
      ownerId: 'owner_2',
    },
    reason: 'ownerId and createdAt are immutable after creation',
  },
  {
    id: 10,
    name: 'Terminal State Mutation on Cancelled Order',
    collection: 'orders',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'ord_cancelled_1',
    payload: {
      status: 'completed',
    },
    reason: 'Cancelled orders are locked in terminal state',
  },
  {
    id: 11,
    name: 'Financial Tampering on Completed Order',
    collection: 'orders',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'owner_1', email: 'owner@example.com', email_verified: true },
    docId: 'ord_completed_1',
    payload: {
      total: 1000,
    },
    reason: 'Completed bills only permit void transition to cancelled with cancelReason',
  },
  {
    id: 12,
    name: 'Cross-Tenant PII Read on StoreSettings',
    collection: 'storeSettings',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    actor: { uid: 'attacker_1', email: 'attacker@example.com', email_verified: true },
    docId: 'victim_uid',
    reason: 'storeSettings contains PII (phone, address, bankAccount) isolated to owner',
  },
];
