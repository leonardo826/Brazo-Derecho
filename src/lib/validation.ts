import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200),
  organizationName: z.string().trim().min(2).max(120),
  rut: z.string().trim().max(20),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
});

export const organizationSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  rut: z.string().trim().max(20),
});

export const knowledgeSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(2000),
});

export const priceSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  unit: z.string().trim().min(1).max(40),
  priceClp: z.coerce.number().int().positive().max(100_000_000),
});

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const conversationSchema = z.object({
  customerLabel: z.string().trim().min(2).max(80),
});

export const brandSchema = z.object({
  voice: z.string().trim().min(2).max(200),
  audience: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(2).max(600),
});

export const recordIdSchema = z.string().trim().min(1).max(80);

export const quoteRequestSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1000),
  pedidoLibre: z.string().trim().max(2000),
});

export const quoteStatusSchema = z.object({
  id: recordIdSchema,
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const postBatchSchema = z.object({
  count: z.coerce.number().int().min(1).max(8),
});

export const phoneIdSchema = z.string().trim().regex(/^$|^\d{8,20}$/);

export const suspensionSchema = z.object({
  organizationId: recordIdSchema,
  suspended: z.enum(["0", "1"]),
});

export const agentFieldSchema = z.enum(["WHATSAPP", "QUOTES", "MARKETING"]);
