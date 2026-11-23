# Security Specification & Payload-First TDD (`Mộc POS`)

## 1. Data Invariants

1. **Tenant Isolation (`ownerId`)**: Every document in `storeSettings`, `menuItems`, `diningTables`, and `orders` MUST carry `ownerId == request.auth.uid`. Cross-user reads, list queries, updates, or deletes are strictly forbidden.
2. **Verified Identity**: All writes require an authenticated user with `request.auth.token.email_verified == true`.
3. **Path Variable Hardening**: Every single-document `get`, `create`, `update`, and `delete` enforces `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). `allow list` never invokes `get()` or `exists()` and strictly checks `resource.data.ownerId == request.auth.uid`.
4. **Strict Schema & No Shadow Fields**: Every create enforces `hasAll` + `hasOnly` with strict type checks and string `.size()` ceilings. Every update calls `isValid[Entity](incoming())` AND splits updates into named Action branches with `affectedKeys().hasOnly([...])`.
5. **Immutability & Temporal Integrity**: `ownerId` and `createdAt` are immutable after creation. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
6. **Terminal State Locking on Orders**:
   - Once `order.status == 'cancelled'`, NO further updates are allowed.
   - Once `order.status == 'completed'`, line items and monetary totals cannot be altered; the only valid transition is voiding (`status: 'cancelled'` with `cancelReason`).
7. **Bounded Array Guard**: `orders.items` MUST satisfy `size() >= 1 && size() <= 50` and validate the first element map structure and field types.
8. **PII Isolation**: `storeSettings/{userId}` (address, phone, bank details) is accessible only when `request.auth.uid == userId`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)

1. **Identity Spoofing on Create**: Creating a `menuItem` with `ownerId: "victim-uid"` while signed in as `"attacker-uid"`.
2. **Unverified Email Write**: Creating an `order` when `request.auth.token.email_verified == false`.
3. **Shadow Field Injection**: Creating a `menuItem` containing an unexpected ghost key `isFeaturedAdmin: true`.
4. **Path ID Poisoning**: Creating a `menuItems` doc with a 200-char or symbol-injected ID like `../../admin`.
5. **String Exhaustion (DoW)**: Submitting a `note` of 10,000 characters in `orders` (limit 300).
6. **Unbounded Array Bomb**: Creating an `order` with 55 items (exceeds `size() <= 50`).
7. **Array Element Type Poisoning**: Creating an `order` where `items: ["not-an-object"]`.
8. **Timestamp Forgery**: Creating an `order` with a client-forged `createdAt` instead of `request.time`.
9. **Immutable Field Tampering**: Updating a `diningTable` to change `ownerId` or `createdAt`.
10. **Terminal State Mutation**: Updating a `cancelled` order back to `completed` or editing its `total`.
11. **Completed Bill Tampering**: Updating a `completed` order's `total` or `items` instead of voiding.
12. **PII Cross-Tenant Read / Scrape**: Attempting `get` on `/storeSettings/otherUserId` or `list` on `/orders` without `ownerId == request.auth.uid`.
