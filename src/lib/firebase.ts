import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const ACCOUNT_DOMAIN = 'somobistro.local';
const LOGIN_ID_PATTERN = /^[a-z0-9._-]{3,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Converts a user-entered login ID (e.g. "admin", "thungan01") or email into
 * a normalized Firebase Auth email identifier. Returns null if invalid.
 */
export function idToFirebaseEmail(rawId: string): string | null {
  const cleaned = rawId.trim().toLowerCase();
  if (!cleaned || cleaned.length > 120) return null;
  if (cleaned.includes('@')) {
    return EMAIL_PATTERN.test(cleaned) ? cleaned : null;
  }
  if (!LOGIN_ID_PATTERN.test(cleaned)) return null;
  return `${cleaned}@${ACCOUNT_DOMAIN}`;
}

/**
 * Strips the internal synthetic domain so the UI displays the clean login ID.
 */
export function formatAccountId(email?: string | null): string {
  if (!email) return '';
  const suffix = `@${ACCOUNT_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function reportFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): string {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (errInfo.error.includes('permission') || errInfo.error.includes('PERMISSION_DENIED')) {
    return 'Không có quyền thực hiện thao tác này. Vui lòng kiểm tra lại dữ liệu hoặc đăng nhập lại.';
  }
  return 'Lưu dữ liệu chưa thành công. Vui lòng thử lại.';
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
