import type { R2Config } from './r2sign'

export const useR2 = () => useRuntimeConfig().r2 as R2Config
