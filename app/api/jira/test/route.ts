import {NextRequest,NextResponse} from 'next/server';
import {jiraTest} from '@/lib/jira';
import {rejectCrossOrigin} from '@/lib/security';
export const runtime='nodejs';
export async function POST(r:NextRequest){const denied=rejectCrossOrigin(r);if(denied)return denied;try{return NextResponse.json(await jiraTest());}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Error'}, {status:400});}}
