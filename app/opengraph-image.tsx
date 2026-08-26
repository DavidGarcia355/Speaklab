import { ImageResponse } from "next/og";
import SocialCard from "@/app/_social/SocialCard";

export const alt = "TryHabla — speaking practice made simple";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<SocialCard />, size);
}
