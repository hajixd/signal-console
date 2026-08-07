import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";

const USERS_COLLECTION = "tradingBotUsers";
const USERNAMES_COLLECTION = "tradingBotUsernames";
const AUTH_STATE_COLLECTION = "tradingBotAuthState";
const PRESENCE_COLLECTION = "tradingBotPresence";
const LOCAL_AUTH_PATH = path.join(process.cwd(), ".local", "trading-bot-users.json");
const PASSWORD_VERSION = "scrypt-v1";
const ONLINE_WINDOW_MS = 90_000;
const scrypt = promisify(scryptCallback);

export type AppUserRole = "admin" | "user";
export type AppTheme = "dark" | "light";

export type AppUser = {
  createdAt: string;
  id: string;
  role: AppUserRole;
  theme: AppTheme;
  username: string;
};

type StoredAppUser = AppUser & {
  normalizedUsername: string;
  passwordHash: string;
  updatedAt: string;
};

type LocalAuthStore = {
  users: Record<string, StoredAppUser>;
  usernames: Record<string, string>;
};

export type OnlineAppUser = Pick<AppUser, "id" | "role" | "username"> & {
  area: string;
  lastSeen: string;
};

let localWriteQueue: Promise<void> = Promise.resolve();

export function normalizeAppUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateAppUsername(value: unknown): string | null {
  const username = normalizeAppUsername(value);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return null;
  return username;
}

export function validateAppPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) return null;
  return value;
}

export async function hashAppPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${PASSWORD_VERSION}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyAppPassword(password: string, storedHash: string): Promise<boolean> {
  const [version, salt, encoded] = storedHash.split("$", 3);
  if (version !== PASSWORD_VERSION || !salt || !encoded) return false;
  try {
    const expected = Buffer.from(encoded, "base64url");
    const supplied = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}

function publicUser(user: StoredAppUser): AppUser {
  return {
    createdAt: user.createdAt,
    id: user.id,
    role: user.role,
    theme: user.theme,
    username: user.username
  };
}

function toStoredUser(value: Record<string, unknown> | undefined, fallbackId?: string): StoredAppUser | null {
  const id = typeof value?.id === "string" ? value.id : fallbackId;
  const normalizedUsername = normalizeAppUsername(value?.normalizedUsername ?? value?.username);
  const passwordHash = typeof value?.passwordHash === "string" ? value.passwordHash : "";
  if (!id || !validateAppUsername(normalizedUsername) || !passwordHash) return null;
  const createdAt = typeof value?.createdAt === "string" ? value.createdAt : new Date(0).toISOString();
  return {
    createdAt,
    id,
    normalizedUsername,
    passwordHash,
    role: value?.role === "admin" ? "admin" : "user",
    theme: value?.theme === "light" ? "light" : "dark",
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : createdAt,
    username: normalizedUsername
  };
}

async function readLocalStore(): Promise<LocalAuthStore> {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_AUTH_PATH, "utf8")) as Partial<LocalAuthStore>;
    return { users: parsed.users ?? {}, usernames: parsed.usernames ?? {} };
  } catch {
    return { users: {}, usernames: {} };
  }
}

async function writeLocalStore(store: LocalAuthStore): Promise<void> {
  await mkdir(path.dirname(LOCAL_AUTH_PATH), { recursive: true });
  await writeFile(LOCAL_AUTH_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function mutateLocalStore<T>(mutation: (store: LocalAuthStore) => Promise<T> | T): Promise<T> {
  let result!: T;
  const run = localWriteQueue.then(async () => {
    const store = await readLocalStore();
    result = await mutation(store);
    await writeLocalStore(store);
  });
  localWriteQueue = run.catch(() => undefined);
  await run;
  return result;
}

async function createLocalUser(username: string, passwordHash: string): Promise<AppUser> {
  return mutateLocalStore((store) => {
    if (store.usernames[username]) throw new Error("That username is already taken.");
    const now = new Date().toISOString();
    const id = randomUUID();
    const user: StoredAppUser = {
      createdAt: now,
      id,
      normalizedUsername: username,
      passwordHash,
      role: Object.keys(store.users).length === 0 ? "admin" : "user",
      theme: "dark",
      updatedAt: now,
      username
    };
    store.users[id] = user;
    store.usernames[username] = id;
    return publicUser(user);
  });
}

export async function createAppUser(usernameValue: unknown, passwordValue: unknown): Promise<AppUser> {
  const username = validateAppUsername(usernameValue);
  const password = validateAppPassword(passwordValue);
  if (!username) throw new Error("Username must be 3–24 characters using letters, numbers, or underscores.");
  if (!password) throw new Error("Password must be between 8 and 128 characters.");
  const passwordHash = await hashAppPassword(password);

  if (hasFirebaseAdmin()) {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      const db = firebaseDb();
      const user = await withFirebaseTimeout(
        db.runTransaction(async (transaction) => {
          const usernameRef = db.collection(USERNAMES_COLLECTION).doc(username);
          const bootstrapRef = db.collection(AUTH_STATE_COLLECTION).doc("bootstrap");
          const userRef = db.collection(USERS_COLLECTION).doc(id);
          const [usernameSnapshot, bootstrapSnapshot] = await Promise.all([
            transaction.get(usernameRef),
            transaction.get(bootstrapRef)
          ]);
          if (usernameSnapshot.exists) throw new Error("That username is already taken.");
          const role: AppUserRole = bootstrapSnapshot.exists ? "user" : "admin";
          const stored: StoredAppUser = {
            createdAt: now,
            id,
            normalizedUsername: username,
            passwordHash,
            role,
            theme: "dark",
            updatedAt: now,
            username
          };
          transaction.create(usernameRef, { createdAt: now, userId: id });
          transaction.create(userRef, stored);
          if (!bootstrapSnapshot.exists) transaction.create(bootstrapRef, { adminUserId: id, createdAt: now });
          return publicUser(stored);
        }),
        "Firebase app user creation"
      );
      return user;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  return createLocalUser(username, passwordHash);
}

export async function getAppUserById(id: string): Promise<AppUser | null> {
  if (!id) return null;
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(USERS_COLLECTION).doc(id).get(), "Firebase app user read");
      const user = toStoredUser(snapshot.data() as Record<string, unknown> | undefined, snapshot.id);
      return user ? publicUser(user) : null;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  const user = (await readLocalStore()).users[id];
  return user ? publicUser(user) : null;
}

async function getStoredUserByUsername(username: string): Promise<StoredAppUser | null> {
  if (hasFirebaseAdmin()) {
    try {
      const db = firebaseDb();
      const usernameSnapshot = await withFirebaseTimeout(db.collection(USERNAMES_COLLECTION).doc(username).get(), "Firebase username read");
      const userId = usernameSnapshot.exists ? String(usernameSnapshot.data()?.userId ?? "") : "";
      if (!userId) return null;
      const userSnapshot = await withFirebaseTimeout(db.collection(USERS_COLLECTION).doc(userId).get(), "Firebase app user read");
      return toStoredUser(userSnapshot.data() as Record<string, unknown> | undefined, userId);
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  const store = await readLocalStore();
  const userId = store.usernames[username];
  return userId ? store.users[userId] ?? null : null;
}

export async function authenticateAppUser(usernameValue: unknown, passwordValue: unknown): Promise<AppUser | null> {
  const username = validateAppUsername(usernameValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  if (!username || !password) return null;
  const user = await getStoredUserByUsername(username);
  if (!user || !(await verifyAppPassword(password, user.passwordHash))) return null;
  return publicUser(user);
}

export async function updateAppUsername(userId: string, usernameValue: unknown): Promise<AppUser> {
  const username = validateAppUsername(usernameValue);
  if (!username) throw new Error("Username must be 3–24 characters using letters, numbers, or underscores.");
  if (hasFirebaseAdmin()) {
    try {
      const db = firebaseDb();
      return await withFirebaseTimeout(
        db.runTransaction(async (transaction) => {
          const userRef = db.collection(USERS_COLLECTION).doc(userId);
          const userSnapshot = await transaction.get(userRef);
          const current = toStoredUser(userSnapshot.data() as Record<string, unknown> | undefined, userId);
          if (!current) throw new Error("Account not found.");
          if (current.normalizedUsername === username) return publicUser(current);
          const nextUsernameRef = db.collection(USERNAMES_COLLECTION).doc(username);
          const nextSnapshot = await transaction.get(nextUsernameRef);
          if (nextSnapshot.exists) throw new Error("That username is already taken.");
          transaction.delete(db.collection(USERNAMES_COLLECTION).doc(current.normalizedUsername));
          transaction.create(nextUsernameRef, { createdAt: new Date().toISOString(), userId });
          transaction.update(userRef, { normalizedUsername: username, updatedAt: new Date().toISOString(), username });
          return publicUser({ ...current, normalizedUsername: username, username });
        }),
        "Firebase username update"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  return mutateLocalStore((store) => {
    const current = store.users[userId];
    if (!current) throw new Error("Account not found.");
    if (store.usernames[username] && store.usernames[username] !== userId) throw new Error("That username is already taken.");
    delete store.usernames[current.normalizedUsername];
    current.normalizedUsername = username;
    current.username = username;
    current.updatedAt = new Date().toISOString();
    store.usernames[username] = userId;
    return publicUser(current);
  });
}

export async function updateAppPassword(userId: string, currentPassword: unknown, newPasswordValue: unknown): Promise<void> {
  const newPassword = validateAppPassword(newPasswordValue);
  if (!newPassword) throw new Error("New password must be between 8 and 128 characters.");
  const user = await getStoredUserById(userId);
  if (!user || !(await verifyAppPassword(String(currentPassword ?? ""), user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }
  const passwordHash = await hashAppPassword(newPassword);
  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb().collection(USERS_COLLECTION).doc(userId).update({ passwordHash, updatedAt: new Date().toISOString() }),
        "Firebase password update"
      );
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  await mutateLocalStore((store) => {
    const current = store.users[userId];
    if (!current) throw new Error("Account not found.");
    current.passwordHash = passwordHash;
    current.updatedAt = new Date().toISOString();
  });
}

export async function updateAppTheme(userId: string, themeValue: unknown): Promise<AppUser> {
  const theme: AppTheme = themeValue === "light" ? "light" : "dark";
  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb().collection(USERS_COLLECTION).doc(userId).update({ theme, updatedAt: new Date().toISOString() }),
        "Firebase theme update"
      );
      const user = await getAppUserById(userId);
      if (!user) throw new Error("Account not found.");
      return user;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  return mutateLocalStore((store) => {
    const current = store.users[userId];
    if (!current) throw new Error("Account not found.");
    current.theme = theme;
    current.updatedAt = new Date().toISOString();
    return publicUser(current);
  });
}

async function getStoredUserById(id: string): Promise<StoredAppUser | null> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(USERS_COLLECTION).doc(id).get(), "Firebase app user read");
      return toStoredUser(snapshot.data() as Record<string, unknown> | undefined, id);
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  return (await readLocalStore()).users[id] ?? null;
}

function cleanPresenceArea(value: unknown): string {
  if (typeof value !== "string") return "Home";
  const cleaned = value.trim().replace(/[^a-zA-Z0-9 #/_-]/g, "").slice(0, 48);
  return cleaned || "Home";
}

export async function updateAppPresence(user: AppUser, areaValue: unknown): Promise<void> {
  if (!hasFirebaseAdmin()) return;
  const now = new Date().toISOString();
  await withFirebaseTimeout(
    firebaseDb().collection(PRESENCE_COLLECTION).doc(user.id).set({
      area: cleanPresenceArea(areaValue),
      lastSeen: now,
      role: user.role,
      updatedAt: FieldValue.serverTimestamp(),
      userId: user.id,
      username: user.username
    }, { merge: true }),
    "Firebase presence update"
  );
}

export async function removeAppPresence(userId: string): Promise<void> {
  if (!hasFirebaseAdmin() || !userId) return;
  await withFirebaseTimeout(firebaseDb().collection(PRESENCE_COLLECTION).doc(userId).delete(), "Firebase presence delete").catch(() => undefined);
}

export async function listOnlineAppUsers(now = Date.now()): Promise<OnlineAppUser[]> {
  if (!hasFirebaseAdmin()) return [];
  const cutoff = now - ONLINE_WINDOW_MS;
  const snapshot = await withFirebaseTimeout(firebaseDb().collection(PRESENCE_COLLECTION).get(), "Firebase presence list");
  return snapshot.docs
    .map((doc) => {
      const value = doc.data();
      const lastSeen = typeof value.lastSeen === "string" ? value.lastSeen : "";
      return {
        area: cleanPresenceArea(value.area),
        id: String(value.userId ?? doc.id),
        lastSeen,
        role: value.role === "admin" ? "admin" as const : "user" as const,
        username: normalizeAppUsername(value.username)
      };
    })
    .filter((user) => user.username && Date.parse(user.lastSeen) >= cutoff)
    .sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
}
