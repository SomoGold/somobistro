import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, QrCode, Save, Trash2, Upload, X } from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import { purgeAllOrdersAndResetTables } from '../lib/seedData';
import {
  clampNumber,
  DiningTable,
  LIMITS,
  Order,
  ReceiptPaperSize,
  sanitizeText,
  StoreSettings,
} from '../types/pos';

interface SettingsViewProps {
  ownerId: string;
  settings: StoreSettings | null;
  orders: Order[];
  tables: DiningTable[];
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

function compressQrImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Tệp tải lên không phải ảnh hợp lệ.'));
      img.onload = () => {
        const maxSide = 760;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width > maxSide || height > maxSide) {
          const ratio = Math.min(maxSide / width, maxSide / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        if (dataUrl.length > LIMITS.QR_IMAGE_MAX) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        }
        if (dataUrl.length > LIMITS.QR_IMAGE_MAX) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.55);
        }
        if (dataUrl.length > LIMITS.QR_IMAGE_MAX) {
          reject(new Error('Ảnh QR quá lớn. Vui lòng chọn ảnh gọn hơn.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function compressLogoImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh logo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Tệp tải lên không phải ảnh hợp lệ.'));
      img.onload = () => {
        const renderAtSize = (maxSide: number, mime: 'image/png' | 'image/jpeg', quality?: number) => {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          if (width > maxSide || height > maxSide) {
            const ratio = Math.min(maxSide / width, maxSide / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
          }
          if (mime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
          } else {
            ctx.clearRect(0, 0, width, height);
          }
          ctx.drawImage(img, 0, 0, width, height);
          return canvas.toDataURL(mime, quality);
        };

        try {
          // Prefer transparent PNG first so logos look sharp on both splash screen and receipts
          let dataUrl = renderAtSize(480, 'image/png');
          if (dataUrl.length > LIMITS.LOGO_IMAGE_MAX) {
            dataUrl = renderAtSize(320, 'image/png');
          }
          if (dataUrl.length > LIMITS.LOGO_IMAGE_MAX) {
            dataUrl = renderAtSize(480, 'image/jpeg', 0.88);
          }
          if (dataUrl.length > LIMITS.LOGO_IMAGE_MAX) {
            dataUrl = renderAtSize(360, 'image/jpeg', 0.72);
          }
          if (dataUrl.length > LIMITS.LOGO_IMAGE_MAX) {
            reject(new Error('Ảnh logo quá lớn. Vui lòng chọn ảnh gọn hơn.'));
            return;
          }
          resolve(dataUrl);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Không thể xử lý ảnh logo.'));
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function SettingsView({ ownerId, settings, orders, tables, onNotify }: SettingsViewProps) {
  const [storeName, setStoreName] = useState('Somo Bistro');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [wifiInfo, setWifiInfo] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [defaultVatRate, setDefaultVatRate] = useState(8);
  const [defaultPrintSize, setDefaultPrintSize] = useState<ReceiptPaperSize>('a5');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankOwner, setBankOwner] = useState('');
  const [logoImageUrl, setLogoImageUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [uploadingQr, setUploadingQr] = useState(false);
  const [saving, setSaving] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!settings) return;
    setStoreName(settings.storeName || 'Somo Bistro');
    setAddress(settings.address || '');
    setPhone(settings.phone || '');
    setWifiInfo(settings.wifiInfo || '');
    setReceiptFooter(settings.receiptFooter || '');
    setDefaultVatRate(settings.defaultVatRate ?? 8);
    setDefaultPrintSize(settings.defaultPrintSize === '80mm' ? '80mm' : 'a5');
    setBankName(settings.bankName || '');
    setBankAccount(settings.bankAccount || '');
    setBankOwner(settings.bankOwner || '');
    setLogoImageUrl(settings.logoImageUrl || '');
    setQrImageUrl(settings.qrImageUrl || '');
  }, [settings]);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotify('Vui lòng chọn tệp hình ảnh (PNG, JPG, WebP...).', 'error');
      return;
    }

    setUploadingLogo(true);
    try {
      const compressed = await compressLogoImage(file);
      setLogoImageUrl(compressed);
      onNotify('Đã tải logo lên. Nhấn "Lưu cài đặt" để áp dụng lên màn hình khởi động và hóa đơn.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể xử lý ảnh logo.';
      onNotify(msg, 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleQrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotify('Vui lòng chọn tệp hình ảnh (PNG, JPG, WebP...).', 'error');
      return;
    }

    setUploadingQr(true);
    try {
      const compressed = await compressQrImage(file);
      setQrImageUrl(compressed);
      onNotify('Đã tải ảnh QR lên. Nhấn "Lưu cài đặt" để áp dụng.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể xử lý ảnh QR.';
      onNotify(msg, 'error');
    } finally {
      setUploadingQr(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeText(storeName, LIMITS.STORE_NAME_MAX);
    if (!cleanName) {
      onNotify('Tên quán không được để trống.', 'error');
      return;
    }

    setSaving(true);
    const ref = doc(db, 'storeSettings', ownerId);
    const fields = {
      storeName: cleanName,
      address: sanitizeText(address, LIMITS.ADDRESS_MAX),
      phone: sanitizeText(phone, LIMITS.PHONE_MAX),
      wifiInfo: sanitizeText(wifiInfo, LIMITS.WIFI_MAX),
      receiptFooter: sanitizeText(receiptFooter, LIMITS.FOOTER_MAX),
      defaultVatRate: clampNumber(defaultVatRate, 0, 30),
      bankName: sanitizeText(bankName, LIMITS.BANK_NAME_MAX),
      bankAccount: sanitizeText(bankAccount, LIMITS.BANK_ACCOUNT_MAX),
      bankOwner: sanitizeText(bankOwner, LIMITS.BANK_OWNER_MAX),
      logoImageUrl: logoImageUrl.slice(0, LIMITS.LOGO_IMAGE_MAX),
      qrImageUrl: qrImageUrl.slice(0, LIMITS.QR_IMAGE_MAX),
      defaultPrintSize,
      updatedAt: serverTimestamp(),
    };

    try {
      if (settings) {
        await updateDoc(ref, fields);
      } else {
        await setDoc(ref, {
          ownerId,
          ...fields,
          seeded: true,
          createdAt: serverTimestamp(),
        });
      }
      try {
        if (fields.logoImageUrl) {
          window.localStorage.setItem('somo_pos_store_logo', fields.logoImageUrl);
        } else {
          window.localStorage.removeItem('somo_pos_store_logo');
        }
      } catch {
        // Ignore storage errors in restricted environments
      }
      onNotify('Đã lưu cấu hình Somo Bistro, logo quán, ảnh mã QR và khổ giấy in hóa đơn.');
    } catch (error) {
      const msg = reportFirestoreError(
        error,
        settings ? OperationType.UPDATE : OperationType.CREATE,
        `storeSettings/${ownerId}`,
      );
      onNotify(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePurgeOrders = async () => {
    setResetting(true);
    try {
      await purgeAllOrdersAndResetTables(orders, tables);
      setConfirmReset(false);
      onNotify('Đã xóa toàn bộ hóa đơn và đặt lại tất cả bàn về trạng thái trống.');
    } catch {
      onNotify('Không thể xóa dữ liệu hóa đơn lúc này. Vui lòng thử lại.', 'error');
    } finally {
      setResetting(false);
    }
  };

  const openTablesCount = tables.filter((t) => t.status === 'occupied').length;

  return (
    <div className="p-5 sm:p-6 max-w-3xl mx-auto space-y-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-zinc-200 rounded-xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-zinc-200">
          <h2 className="text-base font-bold text-zinc-950">
            Thông tin quán & mẫu hóa đơn (A5 / 80mm)
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Các thông tin dưới đây sẽ in trực tiếp trên hóa đơn thanh toán và phiếu tạm tính khổ A5 / 80mm.
          </p>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Tên quán cà phê / nhà hàng <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value.slice(0, LIMITS.STORE_NAME_MAX))}
                className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Số điện thoại / Hotline
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value.slice(0, LIMITS.PHONE_MAX))}
                placeholder="0908 456 789"
                className="w-full px-3 py-2 text-sm tabular-nums bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Địa chỉ quán</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value.slice(0, LIMITS.ADDRESS_MAX))}
              placeholder="42 Nguyễn Đình Chiểu, Quận 1, TP. Hồ Chí Minh"
              className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Tên ngân hàng</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value.slice(0, LIMITS.BANK_NAME_MAX))}
                placeholder="VD: Techcombank, VCB..."
                className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Số tài khoản (STK)</label>
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value.slice(0, LIMITS.BANK_ACCOUNT_MAX))}
                placeholder="VD: 1903xxxxxxxxxx"
                className="w-full px-3 py-2 text-sm tabular-nums bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Chủ tài khoản (Họ tên)</label>
              <input
                type="text"
                value={bankOwner}
                onChange={(e) => setBankOwner(e.target.value.slice(0, LIMITS.BANK_OWNER_MAX))}
                placeholder="VD: NGUYEN VAN A"
                className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Thuế VAT mặc định
              </label>
              <select
                value={defaultVatRate}
                onChange={(e) => setDefaultVatRate(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm tabular-nums bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              >
                <option value={0}>0% (Không VAT)</option>
                <option value={8}>8% (Giảm thuế VAT)</option>
                <option value={10}>10% (VAT tiêu chuẩn)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Thông tin Wi-Fi in trên bill
              </label>
              <input
                type="text"
                value={wifiInfo}
                onChange={(e) => setWifiInfo(e.target.value.slice(0, LIMITS.WIFI_MAX))}
                placeholder="SomoBistro_5G / Pass: somobistro"
                className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Khổ giấy in hóa đơn mặc định
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDefaultPrintSize('a5')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  defaultPrintSize === 'a5'
                    ? 'bg-emerald-50/80 border-emerald-600 text-emerald-950 ring-1 ring-emerald-600/20'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <div className="text-sm font-bold">Khổ A5 (148 × 210 mm)</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Hóa đơn chi tiết dạng bảng đầy đủ, phù hợp máy in văn phòng
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDefaultPrintSize('80mm')}
                className={`p-3.5 rounded-xl border text-left transition-colors ${
                  defaultPrintSize === '80mm'
                    ? 'bg-emerald-50/80 border-emerald-600 text-emerald-950 ring-1 ring-emerald-600/20'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <div className="text-sm font-bold">Khổ 80mm (Máy in bill nhiệt K80)</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Khổ cuộn 80mm gọn gàng, in nhanh trực tiếp tại quầy thu ngân
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Lời chào cuối hóa đơn
            </label>
            <input
              type="text"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value.slice(0, LIMITS.FOOTER_MAX))}
              placeholder="Cảm ơn quý khách đã ghé thăm Somo Bistro! Hẹn gặp lại."
              className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:bg-white focus:border-emerald-700"
            />
          </div>

          {/* Store Logo Upload (Startup Splash & Receipts) */}
          <div className="pt-4 border-t border-zinc-200 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-zinc-950">
                Logo Somo Bistro (Màn hình khởi động & Hóa đơn)
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tải lên ảnh logo của quán (khuyên dùng PNG nền trong hoặc nền trắng). Logo sẽ hiển
                thị trên màn hình khởi động và thay thế chữ tên quán ở đầu hóa đơn in.
              </p>
            </div>

            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoFileChange}
              className="hidden"
            />

            {logoImageUrl ? (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-36 h-24 rounded-xl bg-white border border-zinc-200 p-2.5 flex items-center justify-center shrink-0">
                  <img
                    src={logoImageUrl}
                    alt="Logo quán đã tải lên"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="space-y-2.5 flex-1">
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0a2268]">
                    <ImageIcon className="w-4 h-4" />
                    Đã sẵn sàng ảnh logo quán
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Nhấn <strong>Lưu cài đặt</strong> bên dưới để áp dụng logo lên màn hình khởi
                    động và mẫu in hóa đơn.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={uploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-100 rounded-lg transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingLogo ? 'Đang xử lý...' : 'Đổi ảnh logo khác'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogoImageUrl('')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Gỡ logo
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploadingLogo}
                onClick={() => logoInputRef.current?.click()}
                className="w-full p-6 border-2 border-dashed border-zinc-300 hover:border-[#0a2268] hover:bg-blue-50/40 rounded-xl flex flex-col items-center justify-center gap-2 text-center transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-blue-50 text-[#0a2268] flex items-center justify-center">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-zinc-900">
                  {uploadingLogo ? 'Đang xử lý ảnh logo...' : 'Nhấn để tải ảnh Logo Somo Bistro lên'}
                </div>
                <div className="text-xs text-zinc-500">
                  Hỗ trợ PNG, JPG, WebP (giữ nguyên nền trong suốt và tự động tối ưu cho in hóa đơn)
                </div>
              </button>
            )}
          </div>

          {/* Custom Payment QR Upload */}
          <div className="pt-4 border-t border-zinc-200 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-zinc-950">
                Ảnh mã QR thanh toán in trên hóa đơn
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tải lên ảnh mã QR chuyển khoản của quán (từ ứng dụng ngân hàng, ví điện tử...). Ảnh
                này sẽ được in trực tiếp ở phần chuyển khoản trên hóa đơn.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleQrFileChange}
              className="hidden"
            />

            {qrImageUrl ? (
              <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-36 h-36 rounded-xl bg-white border border-zinc-200 p-2 flex items-center justify-center shrink-0">
                  <img
                    src={qrImageUrl}
                    alt="Mã QR thanh toán đã tải lên"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="space-y-2.5 flex-1">
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                    <QrCode className="w-4 h-4" />
                    Đã sẵn sàng ảnh mã QR
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Nhấn <strong>Lưu cài đặt</strong> bên dưới để lưu vĩnh viễn ảnh QR này cho mẫu
                    in hóa đơn.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={uploadingQr}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-100 rounded-lg transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingQr ? 'Đang xử lý...' : 'Đổi ảnh QR khác'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrImageUrl('')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Gỡ ảnh QR
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploadingQr}
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-6 border-2 border-dashed border-zinc-300 hover:border-emerald-600 hover:bg-emerald-50/40 rounded-xl flex flex-col items-center justify-center gap-2 text-center transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-zinc-900">
                  {uploadingQr ? 'Đang xử lý ảnh QR...' : 'Nhấn để tải ảnh mã QR của bạn lên'}
                </div>
                <div className="text-xs text-zinc-500">
                  Hỗ trợ ảnh PNG, JPG, WebP (tự động tối ưu dung lượng để in sắc nét)
                </div>
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 bg-zinc-50 flex justify-end">
          <button
            type="submit"
            disabled={saving || uploadingQr || uploadingLogo}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#091d4f] hover:bg-[#132f7a] disabled:opacity-50 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
          </button>
        </div>
      </form>

      {/* Data Reset Utility */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200">
          <h2 className="text-base font-bold text-zinc-950">Quản lý dữ liệu bán hàng</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Xóa toàn bộ hóa đơn hiện có và đưa tất cả bàn về trạng thái trống. Thực đơn và cấu hình
            quán được giữ nguyên.
          </p>
        </div>
        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs text-zinc-600">
            Hiện có <span className="tabular-nums font-bold text-zinc-950">{orders.length}</span> đơn hàng
            và <span className="tabular-nums font-bold text-zinc-950">{openTablesCount}</span> bàn đang treo
            bill.
          </div>

          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={orders.length === 0 && openTablesCount === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed border border-rose-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa toàn bộ hóa đơn & đặt lại bàn trống
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                disabled={resetting}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handlePurgeOrders}
                disabled={resetting}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                {resetting ? 'Đang xóa...' : 'Xác nhận xóa toàn bộ'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
