import { Group, useDefaultLayout, type GroupProps, type LayoutStorage } from 'react-resizable-panels';

// localStorage can throw (blocked site data, some private modes); a layout that is not
// remembered is fine, a workspace that does not render is not.
const safeStorage: LayoutStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

/**
 * A panel Group whose layout survives reloads (react-resizable-panels v4 replacement for v2's
 * `autoSaveId`). The storage key is the same `react-resizable-panels:<id>` v2 used, and v4 reads
 * v2's stored format, so layouts saved before the upgrade are kept.
 */
export function PersistedGroup({ storageId, ...props }: Omit<GroupProps, 'defaultLayout' | 'onLayoutChanged'> & { storageId: string }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: storageId, storage: safeStorage });
  return <Group {...props} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} />;
}
