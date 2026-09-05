import Image from "next/image";

export function WolfForgeMark() {
  return (
    <Image
      src="/branding/wolf-head-mark.png"
      alt=""
      aria-hidden="true"
      width={96}
      height={72}
      loading="eager"
      decoding="auto"
      style={{
        width: 96,
        height: 72,
        display: "block",
        objectFit: "contain",
        flex: "0 0 auto",
        transform: "scale(1.45)",
        transformOrigin: "center",
      }}
    />
  );
}
