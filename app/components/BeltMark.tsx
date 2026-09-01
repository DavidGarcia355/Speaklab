import Image from "next/image";

type BeltMarkProps = {
  className?: string;
  priority?: boolean;
};

export default function BeltMark({ className, priority = false }: BeltMarkProps) {
  return (
    <Image
      className={className}
      src="/tryhabla-belt-mark.png"
      alt=""
      width={178}
      height={181}
      preload={priority}
      loading={priority ? undefined : "eager"}
      unoptimized
      aria-hidden="true"
    />
  );
}
