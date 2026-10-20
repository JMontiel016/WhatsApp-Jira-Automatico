import { DateTime } from 'luxon';
import { database } from './db';
export const ZONE = 'America/Asuncion';
export function evaluate(receivedAt:string) {
  const dt = DateTime.fromISO(receivedAt, {setZone:true}).setZone(ZONE);
  if (!dt.isValid) throw new Error('Fecha inválida');
  const d=database();
  const date=dt.toFormat('yyyy-MM-dd');
  const hour=dt.toFormat('HH:mm');
  const holiday=d.prepare('SELECT name FROM holidays WHERE date=?').get(date) as {name:string}|undefined;
  const start=(d.prepare("SELECT value FROM settings WHERE name='start'").get() as {value:string}).value;
  const end=(d.prepare("SELECT value FROM settings WHERE name='end'").get() as {value:string}).value;
  const weekend=dt.weekday>=6;
  const outside=Boolean(weekend||holiday||hour<start||hour>=end);
  const reason=holiday ? `Feriado: ${holiday.name}` : weekend ? 'Fin de semana' : outside ? 'Fuera del horario laboral' : 'Dentro del horario laboral';
  return {date,hour,weekend,holiday:holiday?.name??null,outside,reason,start,end};
}
