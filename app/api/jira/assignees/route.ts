import {NextRequest,NextResponse} from 'next/server';
import {jiraAssignable} from '@/lib/jira';
export const runtime='nodejs';
export async function GET(r:NextRequest){
 const q=r.nextUrl.searchParams.get('q')||'';
 if(q.length>100)return NextResponse.json({error:'Consulta demasiado larga'},{status:400});
 try{return NextResponse.json(await jiraAssignable(q),{headers:{'Cache-Control':'no-store'}})}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Error Jira'},{status:502})}
}
