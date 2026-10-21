import {NextRequest,NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(r:NextRequest){
 const q=(r.nextUrl.searchParams.get('q')||'').trim().slice(0,100);
 const project=(r.nextUrl.searchParams.get('project')||process.env.JIRA_PROJECT_KEY||'CW').toUpperCase();
 if(!/^[A-Z][A-Z0-9_]{1,19}$/.test(project))return NextResponse.json({error:'Espacio Jira inválido'},{status:400});
 const base=(process.env.JIRA_BASE_URL||'').replace(/\/$/,'');
 const email=process.env.JIRA_EMAIL||'', token=process.env.JIRA_API_TOKEN||'';
 if(!base.startsWith('https://')||!email||!token)return NextResponse.json({error:'Jira no configurado'},{status:503});
 const clean=q.replace(/[^a-zA-Z0-9 _-]/g,' ').trim();
 const qpart=new RegExp('^'+project+'-[0-9]+$','i').test(clean)?` AND key = "${clean.toUpperCase()}"`:(clean?` AND summary ~ "${clean.replace(/\s+/g,' ')}"`:``);
 const jql=`project = "${project.replace(/[^A-Za-z0-9_-]/g,'')}" AND issuetype NOT IN subTaskIssueTypes()${qpart} ORDER BY created DESC`;
 try{const params=new URLSearchParams({jql,maxResults:'35',fields:'summary,issuetype'});
 const res=await fetch(base+'/rest/api/3/search/jql?'+params,{headers:{Authorization:'Basic '+Buffer.from(email+':'+token).toString('base64'),Accept:'application/json'},signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!res.ok)return NextResponse.json({error:'Jira no pudo consultar los tickets (HTTP '+res.status+')'},{status:502});
 const data=await res.json();return NextResponse.json((data.issues||[]).map((x:{key:string;fields?:{summary?:string}})=>({key:x.key,summary:x.fields?.summary||'Sin título'})),{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Jira no está disponible'},{status:503});}
}
