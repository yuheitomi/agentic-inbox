// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
  id: string;
  subject: string;
  sender: string;
  recipient: string;
  cc?: string | null;
  bcc?: string | null;
  date: string;
  read: boolean;
  starred: boolean;
  in_reply_to?: string | null;
  email_references?: string | null;
  thread_id?: string | null;
  folder_id?: string | null;
  snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
  body?: string | null;
  message_id?: string | null;
  raw_headers?: string | null;
  attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  content_id?: string | null;
  disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const recipientFieldSchema = z.union([z.email(), z.array(z.email()).min(1)]);

export const errorResponseSchema = z.object({
  error: z.string(),
});

/**
 * Mailbox settings. Mirrors `MailboxSettings` in `app/types`; unknown keys are
 * stripped rather than passed through, so the RPC client's request type stays
 * a closed object it can actually check.
 *
 * `agentSystemPrompt` is deliberately free text -- it goes straight to the AI.
 */
export const mailboxSettingsSchema = z.object({
  fromName: z.string().optional(),
  forwarding: z.object({ enabled: z.boolean(), email: z.string() }).optional(),
  signature: z
    .object({ enabled: z.boolean(), text: z.string(), html: z.string().optional() })
    .optional(),
  autoReply: z
    .object({ enabled: z.boolean(), subject: z.string(), message: z.string() })
    .optional(),
  agentSystemPrompt: z.string().optional(),
});

export const sendEmailRequestSchema = z
  .object({
    to: recipientFieldSchema,
    cc: recipientFieldSchema.optional(),
    bcc: recipientFieldSchema.optional(),
    from: z.union([z.email(), z.object({ email: z.email(), name: z.string() })]),
    subject: z.string(),
    html: z.string().optional(),
    text: z.string().optional(),
    attachments: z
      .array(
        z.object({
          content: z.string(), // base64 encoded
          filename: z.string(),
          type: z.string(),
          disposition: z.enum(["attachment", "inline"]),
          contentId: z.string().optional(),
        }),
      )
      .optional(),
    in_reply_to: z.string().optional(),
    references: z.array(z.string()).optional(),
    thread_id: z.string().optional(),
  })
  .refine((data) => data.html || data.text, {
    error: "Either 'html' or 'text' must be provided",
  });

export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;

export const sendEmailResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
});
