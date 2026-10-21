import {NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 const base=(process.env.JIRA_BASE_URL||'').replace(/\/$/,'');
 const email=process.env.JIRA_EMAIL||'',token=process.env.JIRA_API_TOKEN||'';
 if(!base.startsWith('https://')||!email||!token)return NextResponse.json({error:'Jira no configurado'},{status:503});
 try{
 const res=await fetch(base+'/rest/api/3/project/search?maxResults=100',{headers:{Authorization:'Basic '+Buffer.from(email+':'+token).toString('base64'),Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!res.ok)return NextResponse.json({error:'Jira respondió HTTP '+res.status},{status:502});
 const d=await res.json() as {values?:Array<{key:string;name:string}>};
 return NextResponse.json((d.values||[]).filter(p=>/^[A-Z][A-Z0-9_]{1,19}$/.test(p.key)).map(p=>({key:p.key,name:p.name})),{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'No se pudieron consultar los espacios'},{status:503});}
}
