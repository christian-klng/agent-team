import { z } from "zod";

export const mailAccountInputSchema = z.object({
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  imapTls: z.boolean().default(true),
  imapUser: z.string().min(1),
  imapPassword: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(465),
  smtpUser: z.string().min(1),
  smtpPassword: z.string().min(1),
  fromAddress: z.string().email(),
  fromName: z.string().optional(),
});
export type MailAccountInput = z.infer<typeof mailAccountInputSchema>;

export const caldavAccountInputSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type CaldavAccountInput = z.infer<typeof caldavAccountInputSchema>;

export const webdavStoreInputSchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  rootPath: z.string().default("/"),
});
export type WebdavStoreInput = z.infer<typeof webdavStoreInputSchema>;

export const createSourceInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("email"),
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    config: mailAccountInputSchema,
  }),
  z.object({
    type: z.literal("caldav"),
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    config: caldavAccountInputSchema,
  }),
  z.object({
    type: z.literal("webdav"),
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    config: webdavStoreInputSchema,
  }),
]);
export type CreateSourceInput = z.infer<typeof createSourceInputSchema>;

/** Update: Passwörter optional — leer bedeutet "unverändert lassen". */
export const updateSourceInputSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  enabled: z.boolean().optional(),
  config: z
    .object({
      imapHost: z.string().min(1).optional(),
      imapPort: z.coerce.number().int().optional(),
      imapTls: z.boolean().optional(),
      imapUser: z.string().min(1).optional(),
      imapPassword: z.string().optional(),
      smtpHost: z.string().min(1).optional(),
      smtpPort: z.coerce.number().int().optional(),
      smtpUser: z.string().min(1).optional(),
      smtpPassword: z.string().optional(),
      fromAddress: z.string().email().optional(),
      fromName: z.string().optional(),
      serverUrl: z.string().url().optional(),
      username: z.string().min(1).optional(),
      password: z.string().optional(),
      baseUrl: z.string().url().optional(),
      rootPath: z.string().optional(),
    })
    .optional(),
});
export type UpdateSourceInput = z.infer<typeof updateSourceInputSchema>;
