// SPDX-License-Identifier: MulanPSL-2.0
import logo from "../assets/fortuna-logo.webp";

export function Logo({ size, alt = "" }: { size: number; alt?: string }) {
  return (
    <img
      src={logo}
      alt={alt}
      width={size}
      height={size}
      style={{ borderRadius: "22%", verticalAlign: "middle" }}
    />
  );
}
