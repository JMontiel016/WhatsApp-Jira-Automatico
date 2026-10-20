import './globals.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'W-Ticket | Soporte TI',description:'Integración local de WhatsApp y tickets de soporte Jira CW'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
