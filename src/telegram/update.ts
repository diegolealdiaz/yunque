import { z } from "zod";

/**
 * Lo que Telegram manda al webhook (un `Update`). Solo los campos que se usan; el resto se
 * ignora. Todo es contenido no confiable: el texto del mensaje, el nombre del archivo y el
 * nombre de quien escribe solo se usan como datos.
 */

const FileSchema = z.object({
  file_id: z.string().min(1).max(300),
  file_size: z.number().int().nonnegative().optional(),
});

export const TelegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      message_id: z.number().int(),
      date: z.number().int(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z.object({ first_name: z.string().max(200).optional() }).optional(),
      text: z.string().max(4096).optional(),
      caption: z.string().max(1024).optional(),
      document: FileSchema.extend({
        file_name: z.string().max(255).optional(),
        mime_type: z.string().max(100).optional(),
      }).optional(),
      /** Una foto llega en varios tamaños, del más chico al más grande. */
      photo: z.array(FileSchema.extend({ width: z.number(), height: z.number() })).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
export type TelegramMessage = NonNullable<TelegramUpdate["message"]>;
