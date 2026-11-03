/**
 * `mock` (default): the whole API runs in the browser (MSW), no backend needed.
 * `real`: requests go to services/gateway (Vite proxies /api, including the terminal
 * WebSocket). Screens without a backend yet (Scenario Studio, global content) are hidden
 * and say so (ROUTE_ACCESS demoOnly in app/access.tsx). Set with VITE_API_MODE=real.
 */
export const API_MODE: 'mock' | 'real' = import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock';
export const isRealApi = API_MODE === 'real';
