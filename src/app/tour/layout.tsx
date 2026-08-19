import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FEATURE_AVAILABILITY } from "@/lib/feature-availability";

export const metadata: Metadata = {
  description:
    "A cinematic product tour of Korra's strategy research, backtesting, portfolio analytics, live execution, and monitoring platform.",
  metadataBase: new URL("https://korra.space"),
  openGraph: {
    description:
      "From market data to managed execution. Explore the complete Korra trading operating system.",
    images: ["/korra-product-tour-poster.jpg"],
    title: "Korra — Product Tour",
    type: "video.other",
    videos: ["/korra-product-tour.mp4"],
  },
  title: "Korra — Product Tour",
};

export default function TourLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!FEATURE_AVAILABILITY.productTour) redirect("/");

  return children;
}
