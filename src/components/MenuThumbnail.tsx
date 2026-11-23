import { useState } from 'react';
import { Coffee, CupSoda, UtensilsCrossed, Croissant, Beer, GlassWater, Layers } from 'lucide-react';
import { MenuCategory } from '../types/pos';
import { resolveAssetUrl } from '../lib/format';

interface MenuThumbnailProps {
  src?: string;
  alt: string;
  category: MenuCategory | string;
  className?: string;
}

export function MenuThumbnail({
  src,
  alt,
  category,
  className = 'aspect-[4/3]',
}: MenuThumbnailProps) {
  const [failed, setFailed] = useState(false);

  const renderIcon = () => {
    switch (category) {
      case 'Combo':
        return <Layers className="w-6 h-6 text-orange-600" strokeWidth={1.75} />;
      case 'Cà phê':
        return <Coffee className="w-6 h-6 text-slate-500" strokeWidth={1.75} />;
      case 'Trà & Matcha':
        return <CupSoda className="w-6 h-6 text-cyan-700" strokeWidth={1.75} />;
      case 'Giải khát':
        return <GlassWater className="w-6 h-6 text-cyan-600" strokeWidth={1.75} />;
      case 'Bia':
        return <Beer className="w-6 h-6 text-amber-600" strokeWidth={1.75} />;
      case 'Món ăn':
        return <UtensilsCrossed className="w-6 h-6 text-amber-700" strokeWidth={1.75} />;
      case 'Bánh ngọt':
        return <Croissant className="w-6 h-6 text-amber-600" strokeWidth={1.75} />;
      default:
        return <GlassWater className="w-5 h-5 text-cyan-600" strokeWidth={1.75} />;
    }
  };

  const resolvedSrc = src ? resolveAssetUrl(src) : '';

  if (!resolvedSrc || failed) {
    return (
      <div
        className={`w-full ${className} bg-gradient-to-br from-cyan-50/70 to-slate-100 flex flex-col items-center justify-center gap-1.5 text-center px-3 select-none`}
      >
        {renderIcon()}
        <span className="text-[11px] font-medium text-slate-500 line-clamp-1">{category}</span>
      </div>
    );
  }

  return (
    <div className={`w-full ${className} bg-slate-100 overflow-hidden`}>
      <img
        src={resolvedSrc}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
      />
    </div>
  );
}
