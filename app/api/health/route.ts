import { NextResponse } from 'next/server';
export const runtime='nodejs';
export async function GET(){return NextResponse.json({ok:true,whatsapp:'simulator-only',jiraRealEnabled:process.env.ENABLE_REAL_JIRA==='true',project:process.env.JIRA_PROJECT_KEY||'CW'});}
