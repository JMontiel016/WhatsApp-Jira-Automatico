// El motor del simulador es CommonJS puro para probarse también con Node sin Next.js.
export type CloudField={id:string;label:string};
export type CloudOption={id:string;title:string;fields:CloudField[]};
export type CloudConfig={greeting:string;menuTitle:string;listButton:string;options:CloudOption[];confirmText:string;confirmedText:string;correctedText:string;handoffText:string};
export type CloudState={stage:string;branch:string;cursor:number;answers:Record<string,string>;confirmed:boolean;jiraKey:string|null;startedAt:string};
export type CloudEvent={kind:string;id?:string;text?:string;mediaId?:string};
export type OutputMessage={kind:string;text?:string};
const engine=require('./cloud-menu-core.cjs') as {
 DEFAULT_CONFIG:CloudConfig;
 validateConfig:(c:unknown)=>CloudConfig;
 listMessage:(c:CloudConfig,to:string)=>unknown;
 buttons:(c:CloudConfig,to:string)=>unknown;
 summarize:(c:CloudConfig,s:CloudState)=>string;
 newState:()=>CloudState;
 advance:(c:CloudConfig,s:CloudState|undefined,e:CloudEvent)=>{state:CloudState;messages:OutputMessage[];confirmation:boolean};
 parseMetaMessage:(m:unknown)=>CloudEvent|null;
};
export const DEFAULT_CONFIG=engine.DEFAULT_CONFIG;
export const validateConfig=engine.validateConfig;
export const listMessage=engine.listMessage;
export const buttons=engine.buttons;
export const summarize=engine.summarize;
export const newState=engine.newState;
export const advance=engine.advance;
export const parseMetaMessage=engine.parseMetaMessage;
