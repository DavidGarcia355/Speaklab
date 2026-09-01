import Link from "next/link";
import { APP_NAME } from "@/app/constants";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p><strong>{APP_NAME}</strong> &copy; {new Date().getFullYear()}</p>
        <nav className="site-footer-links" aria-label="Legal and support links">
          <Link href="/about">Our story</Link>
          <Link href="/faq">Help</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/feedback">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
