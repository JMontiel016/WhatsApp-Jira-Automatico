/**
 * Formato compacto para descripciones de tickets creados a partir de chats.
 * Conserva el orden que recibe (la API ya ordena por received_at, id).
 * No altera los mensajes guardados ni las marcas de lectura.
 */
export type TicketChatMessage = {
  local_date: string;
  local_time: string;
  message: string;
  direction?: string | null;
};

export function formatTicketChatTranscript(messages: readonly TicketChatMessage[]): string {
  if (messages.length === 0) return '';

  const first = messages[0];
  const date = (first.local_date || '').trim();
  const time = (first.local_time || '').trim();
  const header = [date ? `Fecha: ${date}` : '', time ? `Hora: ${time}` : ''].filter(Boolean).join(' | ');
  const lines: string[] = header ? [header] : [];
  let previousRole = '';

  for (const entry of messages) {
    const role = entry.direction === 'out' ? 'Soporte TI' : 'Cliente';
    // Un encabezado solamente al cambiar el interlocutor.
    if (role !== previousRole) {
      if (lines.length) lines.push('');
      lines.push(`${role}:`);
      previousRole = role;
    }
    // Mantener el contenido del mensaje, incluidos saltos de línea y adjuntos.
    const content = (entry.message || '').replace(/\r\n?/g, '\n').trim();
    if (content) lines.push(content);
  }

  return lines.join('\n');
}
