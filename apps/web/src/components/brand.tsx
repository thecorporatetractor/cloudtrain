import { DEFAULT_BRAND, useSite } from '@/api/public';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** The built-in cloud mark; a configured `brand.logo` replaces it (content/site.yaml). */
export function BrandMark({ className }: { className?: string }) {
  const site = useSite().data;
  const { theme } = useTheme();
  const logo = theme === 'dark' ? (site?.brand.logoDark ?? site?.brand.logo) : site?.brand.logo;
  if (logo) return <img className={cn('brand-logo', className)} src={logo} alt="" aria-hidden />;
  return (
    <span className={cn('brand-mark', className)} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 12.5h9.2a3.3 3.3 0 0 0 .4-6.57A4.6 4.6 0 0 0 4 7.6 2.5 2.5 0 0 0 3 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M6.5 15.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** The configured brand name (falls back to the default until the site configuration arrives). */
export function useBrandName(): string {
  return useSite().data?.brand.name ?? DEFAULT_BRAND;
}
