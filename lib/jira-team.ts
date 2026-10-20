/** Jira permite un solo assignee. Los demás integrantes pueden recibir notificaciones como watchers,
 * si la instancia y los permisos de Jira lo permiten. No se envían WhatsApps privados sin números. */
export type TeamRole='level1'|'level2'|'manager';
export const TEAM_ROLES:Record<TeamRole,string>={level1:'Soporte Nivel 1',level2:'Soporte Nivel 2',manager:'Encargado/a de soporte'};
export type JiraPerson={id:string;name:string};
export type JiraTeam=Record<TeamRole,JiraPerson>;
export function emptyTeam():JiraTeam{return {level1:{id:'',name:''},level2:{id:'',name:''},manager:{id:'',name:''}};}
