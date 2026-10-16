import {NextResponse} from 'next/server';
import {database} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json(database().prepare('SELECT * FROM cases ORDER BY id DESC LIMIT 500').all(),{headers:{'Cache-Control':'no-store, max-age=0'}});}
