import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface CartMedicine { id: string; name: string; quantity: number }
export interface PrescriptionFile { id: string; uri: string; name: string; mimeType: string; sizeBytes?: number }

interface CartState {
  medicines: CartMedicine[];
  /** Local files only; they are uploaded to Cloudinary at submit time, so they are not persisted. */
  prescriptions: PrescriptionFile[];
  note: string;
  checkout: { id: string | null; date: string | null; slotId: string | null };
  idempotencyKey: string | null;
  kind: () => 'prescription' | 'medicines' | null;
  setMedicines: (m: CartMedicine[]) => void;
  setPrescriptions: (f: PrescriptionFile[]) => void;
  setNote: (n: string) => void;
  setAddress: (id: string) => void;
  setDate: (date: string) => void;
  /** One key per submission attempt so a retry after a network failure cannot create a duplicate order. */
  ensureKey: () => string;
  clear: () => void;
}

export const useCart = create<CartState>()(persist((set, get) => ({
  medicines: [],
  prescriptions: [],
  note: '',
  checkout: { id: null, date: null, slotId: null },
  idempotencyKey: null,
  kind: () => (get().prescriptions.length ? 'prescription' : get().medicines.length ? 'medicines' : null),
  setMedicines: (medicines) => set({ medicines, idempotencyKey: null }),
  setPrescriptions: (prescriptions) => set({ prescriptions, idempotencyKey: null }),
  setNote: (note) => set((s) => s.note === note ? s : { note, idempotencyKey: null }),
  setAddress: (id) => set((s) => s.checkout.id === id ? s : { checkout: { ...s.checkout, id }, idempotencyKey: null }),
  setDate: (date) => set((s) => s.checkout.date === date ? s : { checkout: { ...s.checkout, date }, idempotencyKey: null }),
  ensureKey: () => {
    const existing = get().idempotencyKey;
    if (existing) return existing;
    const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    set({ idempotencyKey: key });
    return key;
  },
  clear: () => set({ medicines: [], prescriptions: [], note: '', checkout: { id: null, date: null, slotId: null }, idempotencyKey: null }),
}), {
  name: 'kmh.cart.v2',
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ medicines: s.medicines, note: s.note }),
}));
