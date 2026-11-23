import { useState } from 'react';
import { Download, Smartphone, X, MoreVertical, Share } from 'lucide-react';
import { usePWAInstall } from '../lib/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'topbar' | 'drawer' | 'login';
  onAfterClick?: () => void;
}

export function PWAInstallButton({
  variant = 'topbar',
  onAfterClick,
}: PWAInstallButtonProps) {
  const { canPrompt, isInstalled, isIOS, triggerInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Auto-hide once installed and launched in standalone app mode
  if (isInstalled) return null;

  const handleClick = async () => {
    if (canPrompt) {
      const outcome = await triggerInstall();
      if (outcome !== 'manual') {
        onAfterClick?.();
        return;
      }
    }
    setShowGuide(true);
  };

  const buttonNode =
    variant === 'drawer' ? (
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-sm transition-colors border border-amber-200"
      >
        <Smartphone className="w-4 h-4 text-amber-700 shrink-0" />
        <span>Cài đặt App ra màn hình chính</span>
      </button>
    ) : variant === 'login' ? (
      <button
        type="button"
        onClick={handleClick}
        className="w-full h-10 inline-flex items-center justify-center gap-2 px-4 text-xs font-bold text-[#091d4f] bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors"
      >
        <Download className="w-4 h-4 text-amber-700 shrink-0" />
        <span>Cài đặt ứng dụng Somo POS ra màn hình chính</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={handleClick}
        className="h-9 px-2.5 rounded-md bg-amber-400 hover:bg-amber-300 text-slate-950 inline-flex items-center gap-1.5 text-xs font-extrabold shrink-0 transition-colors whitespace-nowrap shadow-xs"
        title="Cài đặt Somo POS ra màn hình chính"
        aria-label="Cài đặt App ra màn hình chính"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Cài App</span>
      </button>
    );

  return (
    <>
      {buttonNode}

      {showGuide && (
        <div
          className="no-print fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Hướng dẫn đưa Somo POS ra màn hình chính"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="bg-[#091d4f] text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-300 shrink-0" />
                <h3 className="text-sm font-bold">Đưa Somo POS ra màn hình chính</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 text-slate-300 hover:text-white rounded"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700 leading-relaxed">
              <p className="text-slate-600">
                Cài đặt <strong>Somo POS</strong> thành ứng dụng độc lập để mở toàn màn hình nhanh từ
                màn hình chính máy POS / điện thoại (không hiện thanh địa chỉ trình duyệt).
              </p>

              {isIOS ? (
                <ol className="space-y-2.5 list-decimal pl-4">
                  <li>
                    Mở đường dẫn ứng dụng này bằng trình duyệt <strong>Safari</strong>.
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span>
                      Nhấn nút <strong>Chia sẻ</strong>{' '}
                      <Share className="inline w-3.5 h-3.5 text-cyan-700 -mt-0.5" /> ở thanh dưới
                      cùng.
                    </span>
                  </li>
                  <li>
                    Chọn <strong>Thêm vào MH chính (Add to Home Screen)</strong> rồi nhấn{' '}
                    <strong>Thêm</strong>.
                  </li>
                </ol>
              ) : (
                <ol className="space-y-2.5 list-decimal pl-4">
                  <li>
                    Mở trực tiếp đường dẫn ứng dụng trên trình duyệt <strong>Google Chrome</strong>{' '}
                    của máy POS (iMin / Android).
                  </li>
                  <li>
                    Nhấn biểu tượng menu{' '}
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-slate-100 border border-slate-300 font-bold text-slate-900">
                      <MoreVertical className="w-3 h-3" />
                    </span>{' '}
                    ở góc trên bên phải Chrome.
                  </li>
                  <li>
                    Chọn <strong>Cài đặt ứng dụng</strong> (hoặc{' '}
                    <strong>Thêm vào màn hình chính</strong>) → xác nhận <strong>Cài đặt</strong>.
                  </li>
                </ol>
              )}

              <div className="p-3 rounded-lg bg-cyan-50 border border-cyan-200 text-[11px] text-cyan-900">
                Sau khi cài xong, biểu tượng <strong>Somo POS</strong> sẽ nằm ngay trên màn hình
                chính và tự động mở toàn màn hình khi chạm vào.
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowGuide(false);
                  onAfterClick?.();
                }}
                className="px-4 py-2 rounded-lg bg-[#091d4f] hover:bg-[#132f7a] text-white text-xs font-bold transition-colors"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
