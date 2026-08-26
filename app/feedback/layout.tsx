import { createPublicMetadata } from "@/lib/public-metadata";

export const metadata = createPublicMetadata({
  title: "Contact and Feedback",
  description: "Contact Habla with a question, pilot request, or product feedback.",
  path: "/feedback",
});

export default function FeedbackLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
