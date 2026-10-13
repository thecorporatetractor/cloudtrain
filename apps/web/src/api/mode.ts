/**
 * `mock` (default): the whole API runs in the browser (MSW), no backend needed.
 * `real`: requests go to services/gateway (Vite proxies /api, including the terminal
 * WebSocket); only Team and Studio stay mocked. Set with VITE_API_MODE=real.
 */
export const API_MODE: 'mock' | 'real' = import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock';
export const isRealApi = API_MODE === 'real';
