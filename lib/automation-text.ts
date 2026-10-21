/** Mensajes editables de TicketWhatsapp. Cambiar un texto no modifica la lógica ni los campos de Jira. */
export const AUTOMATION_TEXT_DEFAULTS = {
 welcome:'Bienvenido al servicio de Soporte TI. Esperamos que se encuentre muy bien. ¿En qué podemos ayudarle? Estamos disponibles para registrar su solicitud de Soporte TI.',
 menu:'¿En qué sistema necesitás Soporte TI? Seleccioná escribiendo 1, 2, 3 o 4:',
 ruc:'Indicá el RUC de la empresa, incluido el dígito verificador.',
 futuraIssue:'Describí el inconveniente que presenta Futura100.',
 talentName:'Indicá tu nombre y apellido.',
 talentId:'Indicá tu número de cédula.',
 talentEmail:'Indicá tu correo electrónico.',
 talentIssue:'Describí el inconveniente de Talento100.',
 otherSystem:'Indicá el nombre del sistema.',
 otherEmail:'Indicá tu correo electrónico.',
 otherIssue:'Describí el inconveniente que presenta el sistema.',
 tiIssue:'Contanos cuál es el inconveniente o consulta de TI.',
 tiHandoff:'Vamos a derivar tu solicitud al equipo de soporte TI.',
 evidence:'Si querés, enviá una imagen o documento. Cuando termines, escribí LISTO para confirmar y generar el ticket.',
 confirmPrompt:'¿Confirma que los datos son correctos y desea registrar su solicitud?',
 correctionPrompt:'¿Qué dato desea corregir?',
 invalidChoice:'Seleccione una opción válida para continuar con Soporte TI.',
 ticketReview:'Recibimos su solicitud, pero el número de Jira debe verificarse antes de continuar.',
 success:'Su solicitud fue registrada correctamente. El equipo de Soporte TI la atenderá en cuanto esté disponible.'
} as const;
export type AutomationTextKey = keyof typeof AUTOMATION_TEXT_DEFAULTS;
export const AUTOMATION_TEXT_FIELDS: Array<{key:AutomationTextKey;label:string;group:string}> = [
 {key:'welcome',label:'Saludo de bienvenida',group:'Bienvenida'},
 {key:'menu',label:'Pregunta para elegir sistema',group:'Bienvenida'},
 {key:'ruc',label:'Futura100: RUC',group:'Futura100'},
 {key:'futuraIssue',label:'Futura100: inconveniente',group:'Futura100'},
 {key:'talentName',label:'Talento100: nombre',group:'Talento100'},
 {key:'talentId',label:'Talento100: cédula',group:'Talento100'},
 {key:'talentEmail',label:'Talento100: correo',group:'Talento100'},
 {key:'talentIssue',label:'Talento100: inconveniente',group:'Talento100'},
 {key:'otherSystem',label:'Otro sistema: nombre',group:'Otros sistemas'},
 {key:'otherEmail',label:'Otro sistema: correo',group:'Otros sistemas'},
 {key:'otherIssue',label:'Otro sistema: inconveniente',group:'Otros sistemas'},
 {key:'tiIssue',label:'Consulta TI: inconveniente',group:'Consulta TI'},
 {key:'tiHandoff',label:'Consulta TI: derivación',group:'Consulta TI'},
 {key:'evidence',label:'Solicitud de evidencia',group:'Finalización'},
 {key:'confirmPrompt',label:'Pregunta de confirmación',group:'Finalización'},
 {key:'correctionPrompt',label:'Encabezado para corrección',group:'Finalización'},
 {key:'invalidChoice',label:'Respuesta ante opción inválida',group:'Finalización'},
 {key:'ticketReview',label:'Ticket sin confirmación de Jira',group:'Finalización'},
 {key:'success',label:'Mensaje de ticket confirmado',group:'Finalización'}
];
export const AUTOMATION_SYSTEM_OPTIONS = ['Futura100','Talento100','Consulta TI','Otro sistema'] as const;

/** Preguntas accesorias que el administrador puede desactivar. Sistema e inconveniente no están incluidos. */
export const AUTOMATION_OPTIONAL_QUESTIONS = ['welcome','ruc','talentName','talentId','talentEmail','otherSystem','otherEmail','tiHandoff','evidence'] as const;
