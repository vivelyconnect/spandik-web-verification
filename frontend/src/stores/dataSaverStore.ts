// src/stores/dataSaverStore.ts — SP-11-08: Data Saver preference. Device-
// local only (same zustand+persist pattern authStore.ts already uses for
// theme) — data consumption is a property of the current device/network,
// not the account, so this deliberately does NOT sync across devices and
// needs no migration. Default OFF.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DataSaverState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useDataSaverStore = create<DataSaverState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: 'spandik_data_saver' }
  )
)
