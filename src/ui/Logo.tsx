// The Blue Monday "BM" mark and wordmark, as on bluemondaystudios.co.za.
import mark from '../assets/bm-logo.png';
import { BRAND } from '../brand';

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`logo logo-${size}`}>
      <img className="logo-mark" src={mark} alt="" width={40} height={40} />
      <span className="logo-text">
        <span className="logo-name">{BRAND.wordmark}</span>
        <span className="logo-tag">ADMIN</span>
      </span>
    </span>
  );
}
