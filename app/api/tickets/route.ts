import {NextResponse} from 'next/server';
import {database} from '@/lib/db';
import {linkedAccount} from '@/lib/active-account';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){const account=await linkedAccount();return NextResponse.json(account?database().prepare('SELECT * FROM cases WHERE account_id=? ORDER BY id DESC LIMIT 500').all(account):[],{headers:{'Cache-Control':'no-store, max-age=0'}});}
