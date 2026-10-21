export type TicketChatEntry={
 local_date?:string|null;
 received_at?:string|null;
 direction?:string|null;
 message?:string|null;
};

// Formato compartido por la vista previa del operador y la creación en Jira.
// Agrupa por autor, sin intercalar las respuestas, y coloca la fecha una sola vez.
export function formatManualTicketDescription(entries:readonly TicketChatEntry[]):string{
 const client:string[]=[];
 const support:string[]=[];
 const dates:string[]=[];
 for(const entry of entries){
  const date=(entry.local_date||'').trim()||(entry.received_at||'').slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!dates.includes(date))dates.push(date);
  const content=(entry.message||'').trim();
  if(!content)continue;
  if(entry.direction==='out')support.push(content);
  else client.push(content);
 }
 const label=(date:string)=>date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
 const dateHeader=dates.length?(dates.length===1?label(dates[0]):`${label(dates[0])} al ${label(dates[dates.length-1])}`):'Sin fecha registrada';
 return [`Fecha: ${dateHeader}`,'', 'CLIENTE:',client.join('\n')||'(Sin mensajes de cliente seleccionados)','', 'SOPORTE TI:',support.join('\n')||'(Sin mensajes de soporte seleccionados)'].join('\n');
}
