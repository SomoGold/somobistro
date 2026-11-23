import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../lib/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed top-2 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold shadow-lg border border-amber-600"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Đang mất kết nối mạng — dữ liệu sẽ tự đồng bộ khi có Internet trở lại</span>
    </div>
  );
}
