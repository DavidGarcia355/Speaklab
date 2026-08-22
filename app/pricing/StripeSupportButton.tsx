"use client";

import Script from "next/script";
import { createElement } from "react";

const BUY_BUTTON_ID = "buy_btn_1U77kC2NDCMZ5bDDuaAJenJu";
const PUBLISHABLE_KEY =
  "pk_live_51U71e92NDCMZ5bDDvA7BV0zqZgtM6jNyPHFdOMqRJEmePNWQkGrhcrkiypE6ow64rDoFXCsIBFFwpI2dKkE3KBXo0001rToBPY";

export default function StripeSupportButton() {
  return (
    <div id="support-habla" className="stripe-support-button">
      <Script
        src="https://js.stripe.com/v3/buy-button.js"
        strategy="afterInteractive"
      />
      {createElement("stripe-buy-button", {
        "buy-button-id": BUY_BUTTON_ID,
        "publishable-key": PUBLISHABLE_KEY,
      })}
    </div>
  );
}
