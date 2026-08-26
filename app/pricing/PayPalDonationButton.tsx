import { PAYPAL_DONATION_URL } from "@/app/constants";

export default function PayPalDonationButton() {
  return (
    <div id="paypal-donation" className="paypal-donation-button">
      <a
        className="btn btn-primary"
        href={PAYPAL_DONATION_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Donate via PayPal
      </a>
    </div>
  );
}
