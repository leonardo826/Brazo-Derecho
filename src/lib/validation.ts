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
