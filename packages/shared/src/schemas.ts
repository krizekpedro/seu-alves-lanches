import { z } from 'zod';
import { CHANNELS, ORDER_STATUSES, ORDER_TYPES } from './order-status';

export const orderItemOptionInput = z.object({
  optionId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
});

export const orderItemInput = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  note: z.string().max(200).optional(),
  options: z.array(orderItemOptionInput).default([]),
});

export const createOrderInput = z.object({
  /** Gerado no aparelho de origem (UUID). Reenviar o mesmo id não duplica o pedido. */
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  channel: z.enum(CHANNELS),
  type: z.enum(ORDER_TYPES),
  externalId: z.string().optional(),
  customer: z
    .object({ name: z.string().min(1), phone: z.string().optional() })
    .optional(),
  items: z.array(orderItemInput).min(1),
  deliveryFeeCents: z.number().int().nonnegative().default(0),
  discountStoreCents: z.number().int().nonnegative().default(0),
  note: z.string().max(500).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderInput>;

export const changeStatusInput = z.object({
  to: z.enum(ORDER_STATUSES),
  reason: z.string().max(200).optional(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusInput>;

export const pinLoginInput = z.object({
  userId: z.string().uuid(),
  storeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
});

export const emailLoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
