import Link from "next/link";
import { APP_NAME, CONTACT_LINKS } from "@/app/constants";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>
          <strong>{APP_NAME}</strong> keeps the core classroom free forever. Optional AI starts
          with a lifetime allowance of 30 successful reviews.
        </p>
        <nav className="site-footer-links" aria-label="Legal and support links">
          <Link className="btn btn-sm btn-primary site-footer-support" href="/about">
            My story &amp; donations
          </Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/feedback">Contact</Link>
          <a href={CONTACT_LINKS.email}>Email support</a>
        </nav>
      </div>
    </footer>
  );
}
