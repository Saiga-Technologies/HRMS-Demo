import React from 'react';

/**
 * The agency's logo mark (public/brand). `auto` follows the theme (the near-black half is lightened in
 * dark mode); `onDark` always uses the light-on-dark version, for the dark sidebar.
 */
export function BrandMark({ size = 36, variant = 'auto', title = 'Saiga HR Services' }: { size?: number; variant?: 'auto' | 'onDark'; title?: string }) {
  const src = size <= 64 ? '-128' : '';
  return (
    <span className={`brand-mark brand-mark-${variant}`} style={{ width: size, height: size }} role="img" aria-label={title}>
      {variant === 'auto' ? <img className="brand-mark-light" src={`/brand/logo${src}.png`} alt="" width={size} height={size} /> : null}
      <img className="brand-mark-dark" src={`/brand/logo-dark${src}.png`} alt="" width={size} height={size} />
    </span>
  );
}
