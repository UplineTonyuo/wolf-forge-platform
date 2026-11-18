/** SPP references have an eight-character base and may have a numeric suffix. */
export function parseSppOrderReference(value: string): string | null {
  const reference = value.trim().replace(/^(?:#\s*)+/, "").toUpperCase();
  return /^[0-9A-F]{8}(?:_[0-9]{1,16})?$/.test(reference) ? reference : null;
}

export function orderReference(order: {
  order_number: number;
  spp_order_reference?: string | null;
}): string {
  return order.spp_order_reference ?? String(order.order_number);
}
