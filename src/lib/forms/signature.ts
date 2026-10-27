import { z } from "zod";

export const MAX_SIGNATURE_POINTS = 768;
export const MAX_SIGNATURE_STROKES = 32;
export const drawnSignatureSchema = z.array(z.array(z.tuple([
  z.number().int().min(0).max(1000),
  z.number().int().min(0).max(400),
])).min(2).max(MAX_SIGNATURE_POINTS)).min(1).max(MAX_SIGNATURE_STROKES)
  .refine((strokes) => strokes.reduce((total, stroke) => total + stroke.length, 0) <= MAX_SIGNATURE_POINTS)
  .refine((strokes) => strokes.some((stroke) => stroke.some((point) => point[0] !== stroke[0]![0] || point[1] !== stroke[0]![1])));

export type SignatureStrokes = z.infer<typeof drawnSignatureSchema>;

export function readSignatureStrokes(value: unknown): SignatureStrokes | null {
  const result = drawnSignatureSchema.safeParse(value);
  return result.success ? result.data : null;
}
