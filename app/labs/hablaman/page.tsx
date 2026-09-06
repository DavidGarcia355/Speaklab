import type { Metadata } from "next";
import HablaManLab from "./HablaManLab";

export const metadata: Metadata = {
  title: "HablaMan Speaking Studio | TryHabla Labs",
  description: "An experimental, interactive HablaMan speaking studio.",
  robots: { index: false, follow: false },
};

export default function HablaManLabPage() {
  return <HablaManLab />;
}
