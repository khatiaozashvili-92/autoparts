const KEY = 'bf-manager'
export const getManager = () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }
export const setManager = (n: string) => { try { localStorage.setItem(KEY, n) } catch { /* ignore */ } }
